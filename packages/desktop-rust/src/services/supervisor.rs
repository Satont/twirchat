use crate::services::backend_ws::{BackendWsConfig, run_backend_ws_service};
use crate::services::bus::{
    BusConfig, BusConfigError, BusReceiver, BusSendError, BusSender, bounded,
};
use crate::services::commands::{LifecycleCommand, ServiceCommand};
use crate::services::events::{LifecycleEvent, ServiceEvent, ServiceKind};
use std::error::Error;
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const SERVICE_POLL_INTERVAL: Duration = Duration::from_millis(25);
const RECONNECT_INITIAL_DELAY: Duration = Duration::from_secs(3);
const RECONNECT_MAX_DELAY: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReconnectBackoff {
    initial_delay: Duration,
    max_delay: Duration,
}

impl ReconnectBackoff {
    pub fn new(initial_delay: Duration, max_delay: Duration) -> Self {
        Self {
            initial_delay,
            max_delay,
        }
    }

    pub fn delay_for_attempt(self, attempt: u32) -> Duration {
        let multiplier = 1_u32.checked_shl(attempt).map_or(u32::MAX, |value| value);
        self.initial_delay
            .saturating_mul(multiplier)
            .min(self.max_delay)
    }
}

impl Default for ReconnectBackoff {
    fn default() -> Self {
        Self {
            initial_delay: RECONNECT_INITIAL_DELAY,
            max_delay: RECONNECT_MAX_DELAY,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceRuntimeConfig {
    event_capacity: usize,
    command_capacity: usize,
    service_poll_interval: Duration,
    reconnect_backoff: ReconnectBackoff,
    backend_ws: BackendWsConfig,
}

impl ServiceRuntimeConfig {
    pub fn new(event_capacity: usize, command_capacity: usize) -> Result<Self, BusConfigError> {
        BusConfig::new(event_capacity)?;
        BusConfig::new(command_capacity)?;
        Ok(Self {
            event_capacity,
            command_capacity,
            service_poll_interval: SERVICE_POLL_INTERVAL,
            reconnect_backoff: ReconnectBackoff::default(),
            backend_ws: BackendWsConfig::default(),
        })
    }

    pub fn event_capacity(&self) -> usize {
        self.event_capacity
    }

    pub fn command_capacity(&self) -> usize {
        self.command_capacity
    }

    pub fn service_poll_interval(&self) -> Duration {
        self.service_poll_interval
    }

    pub fn reconnect_backoff(&self) -> ReconnectBackoff {
        self.reconnect_backoff
    }

    pub fn backend_ws(&self) -> &BackendWsConfig {
        &self.backend_ws
    }

    pub fn with_service_poll_interval(mut self, interval: Duration) -> Self {
        self.service_poll_interval = interval;
        self
    }

    pub fn with_reconnect_backoff(mut self, reconnect_backoff: ReconnectBackoff) -> Self {
        self.reconnect_backoff = reconnect_backoff;
        self.backend_ws = self.backend_ws.with_backoff(reconnect_backoff);
        self
    }

    pub fn with_backend_ws(mut self, backend_ws: BackendWsConfig) -> Self {
        self.backend_ws = backend_ws;
        self
    }
}

impl Default for ServiceRuntimeConfig {
    fn default() -> Self {
        Self {
            event_capacity: BusConfig::DEFAULT_CAPACITY,
            command_capacity: 32,
            service_poll_interval: SERVICE_POLL_INTERVAL,
            reconnect_backoff: ReconnectBackoff::default(),
            backend_ws: BackendWsConfig::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceExitReason {
    ShutdownCommand,
    Cancelled,
    CommandBusClosed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceStopReport {
    service: ServiceKind,
    reason: ServiceExitReason,
}

impl ServiceStopReport {
    pub fn new(service: ServiceKind, reason: ServiceExitReason) -> Self {
        Self { service, reason }
    }

    pub fn service(self) -> ServiceKind {
        self.service
    }

    pub fn reason(self) -> ServiceExitReason {
        self.reason
    }

    pub fn is_clean(self) -> bool {
        matches!(
            self.reason,
            ServiceExitReason::ShutdownCommand
                | ServiceExitReason::Cancelled
                | ServiceExitReason::CommandBusClosed
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShutdownReport {
    stopped_services: Vec<ServiceStopReport>,
    already_stopped: bool,
    cancelled: bool,
}

impl ShutdownReport {
    pub fn stopped_services(&self) -> &[ServiceStopReport] {
        &self.stopped_services
    }

    pub fn already_stopped(&self) -> bool {
        self.already_stopped
    }

    pub fn cancelled(&self) -> bool {
        self.cancelled
    }

    pub fn is_clean(&self) -> bool {
        self.stopped_services
            .iter()
            .all(|service| service.is_clean())
    }
}

#[derive(Debug)]
pub enum ServiceError {
    BusConfig(BusConfigError),
    AlreadyRunning,
    Stopped,
    EventBackpressure {
        capacity: usize,
    },
    EventBusClosed,
    CommandBackpressure {
        service: ServiceKind,
        capacity: usize,
    },
    CommandBusClosed {
        service: ServiceKind,
    },
    ServiceMissing {
        service: ServiceKind,
    },
    ThreadSpawn {
        service: ServiceKind,
        message: String,
    },
    ThreadPanicked {
        service: ServiceKind,
    },
}

impl fmt::Display for ServiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BusConfig(source) => write!(f, "invalid service runtime config: {source}"),
            Self::AlreadyRunning => write!(f, "service supervisor is already running"),
            Self::Stopped => write!(f, "service supervisor is stopped"),
            Self::EventBackpressure { capacity } => {
                write!(f, "service event bus reached capacity {capacity}")
            }
            Self::EventBusClosed => write!(f, "service event bus is closed"),
            Self::CommandBackpressure { service, capacity } => {
                write!(
                    f,
                    "{} command bus reached capacity {capacity}",
                    service.label()
                )
            }
            Self::CommandBusClosed { service } => {
                write!(f, "{} command bus is closed", service.label())
            }
            Self::ServiceMissing { service } => {
                write!(f, "{} service is not running", service.label())
            }
            Self::ThreadSpawn { service, message } => {
                write!(f, "failed to spawn {} service: {message}", service.label())
            }
            Self::ThreadPanicked { service } => {
                write!(f, "{} service thread panicked", service.label())
            }
        }
    }
}

impl Error for ServiceError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::BusConfig(source) => Some(source),
            _ => None,
        }
    }
}

impl From<BusConfigError> for ServiceError {
    fn from(value: BusConfigError) -> Self {
        Self::BusConfig(value)
    }
}

pub type ServiceResult<T> = Result<T, ServiceError>;

pub struct ServiceSupervisor {
    config: ServiceRuntimeConfig,
    events: BusSender<ServiceEvent>,
    event_receiver: Option<BusReceiver<ServiceEvent>>,
    cancellation: CancellationToken,
    handles: Vec<ServiceHandle>,
    stopped: bool,
}

impl ServiceSupervisor {
    pub fn new(config: ServiceRuntimeConfig) -> ServiceResult<Self> {
        let event_config = BusConfig::new(config.event_capacity())?;
        let (events, event_receiver) = bounded(event_config);
        Ok(Self {
            config,
            events,
            event_receiver: Some(event_receiver),
            cancellation: CancellationToken::new(),
            handles: Vec::new(),
            stopped: true,
        })
    }

    pub fn take_event_receiver(&mut self) -> Option<BusReceiver<ServiceEvent>> {
        self.event_receiver.take()
    }

    pub fn event_sender(&self) -> BusSender<ServiceEvent> {
        self.events.clone()
    }

    pub fn is_stopped(&self) -> bool {
        self.stopped
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }

    pub fn start(&mut self) -> ServiceResult<()> {
        if !self.stopped {
            return Err(ServiceError::AlreadyRunning);
        }

        self.cancellation = CancellationToken::new();
        self.stopped = false;
        self.publish_event(ServiceEvent::Lifecycle(LifecycleEvent::RuntimeStarting {
            sequence: ServiceKind::startup_sequence().to_vec(),
        }))?;

        for service in ServiceKind::startup_sequence() {
            if let Err(error) = self.start_service(*service) {
                self.cancel_started_services();
                return Err(error);
            }
        }

        self.publish_event(ServiceEvent::Lifecycle(LifecycleEvent::RuntimeStarted))
    }

    pub fn dispatch(&self, service: ServiceKind, command: ServiceCommand) -> ServiceResult<()> {
        if self.stopped || self.cancellation.is_cancelled() {
            return Err(ServiceError::Stopped);
        }

        let handle = self
            .handles
            .iter()
            .find(|handle| handle.service == service)
            .ok_or(ServiceError::ServiceMissing { service })?;
        handle
            .commands
            .try_publish(command)
            .map_err(|error| command_error(service, error))
    }

    pub fn stop(&mut self) -> ServiceResult<ShutdownReport> {
        if self.stopped {
            return Ok(ShutdownReport {
                stopped_services: Vec::new(),
                already_stopped: true,
                cancelled: self.cancellation.is_cancelled(),
            });
        }

        self.stopped = true;
        self.publish_event(ServiceEvent::Lifecycle(LifecycleEvent::RuntimeStopping))?;

        let mut handles = std::mem::take(&mut self.handles);
        handles.reverse();
        let mut stop_request_error = None;

        for handle in &handles {
            self.publish_event(ServiceEvent::Lifecycle(LifecycleEvent::ServiceStopping {
                service: handle.service,
            }))?;
            match handle
                .commands
                .try_publish(ServiceCommand::Lifecycle(LifecycleCommand::Shutdown))
            {
                Ok(()) | Err(BusSendError::Closed { .. }) => {}
                Err(error) => {
                    if stop_request_error.is_none() {
                        stop_request_error = Some(command_error(handle.service, error));
                    }
                }
            }
        }

        self.cancellation.cancel();
        self.publish_event(ServiceEvent::Lifecycle(LifecycleEvent::RuntimeCancelled))?;

        let mut stopped_services = Vec::with_capacity(handles.len());
        for handle in handles {
            let report = join_service(handle)?;
            self.publish_event(ServiceEvent::Lifecycle(LifecycleEvent::ServiceStopped {
                service: report.service(),
            }))?;
            stopped_services.push(report);
        }

        self.publish_event(ServiceEvent::Lifecycle(LifecycleEvent::RuntimeStopped {
            services: stopped_services
                .iter()
                .map(|report| report.service())
                .collect(),
        }))?;

        if let Some(error) = stop_request_error {
            return Err(error);
        }

        Ok(ShutdownReport {
            stopped_services,
            already_stopped: false,
            cancelled: self.cancellation.is_cancelled(),
        })
    }

    fn start_service(&mut self, service: ServiceKind) -> ServiceResult<()> {
        let command_config = BusConfig::new(self.config.command_capacity())?;
        let (commands, command_receiver) = bounded(command_config);
        let context = ServiceContext {
            service,
            cancellation: self.cancellation.clone(),
            poll_interval: self.config.service_poll_interval(),
        };
        let events = self.events.clone();
        let backend_ws = self.config.backend_ws().clone();
        let join = thread::Builder::new()
            .name(format!("twirchat-{}", service.label()))
            .spawn(move || match service {
                ServiceKind::BackendWs => run_backend_ws_service(
                    backend_ws,
                    context.cancellation,
                    context.poll_interval,
                    command_receiver,
                    events,
                ),
                _ => run_placeholder_service(context, command_receiver),
            })
            .map_err(|source| ServiceError::ThreadSpawn {
                service,
                message: source.to_string(),
            })?;

        self.handles.push(ServiceHandle {
            service,
            commands,
            join: Some(join),
        });
        self.publish_event(ServiceEvent::Lifecycle(LifecycleEvent::ServiceStarted {
            service,
        }))
    }

    fn publish_event(&self, event: ServiceEvent) -> ServiceResult<()> {
        self.events.try_publish(event).map_err(event_error)
    }

    fn cancel_started_services(&mut self) {
        self.cancellation.cancel();
        for handle in &self.handles {
            if handle
                .commands
                .try_publish(ServiceCommand::Lifecycle(LifecycleCommand::Shutdown))
                .is_err()
            {}
        }
        for handle in std::mem::take(&mut self.handles) {
            if join_service(handle).is_err() {}
        }
        self.stopped = true;
    }
}

impl Default for ServiceSupervisor {
    fn default() -> Self {
        let event_config = BusConfig::default();
        let (events, event_receiver) = bounded(event_config);
        Self {
            config: ServiceRuntimeConfig::default(),
            events,
            event_receiver: Some(event_receiver),
            cancellation: CancellationToken::new(),
            handles: Vec::new(),
            stopped: true,
        }
    }
}

struct ServiceHandle {
    service: ServiceKind,
    commands: BusSender<ServiceCommand>,
    join: Option<JoinHandle<ServiceStopReport>>,
}

struct ServiceContext {
    service: ServiceKind,
    cancellation: CancellationToken,
    poll_interval: Duration,
}

fn run_placeholder_service(
    context: ServiceContext,
    commands: BusReceiver<ServiceCommand>,
) -> ServiceStopReport {
    loop {
        if context.cancellation.is_cancelled() {
            return ServiceStopReport {
                service: context.service,
                reason: ServiceExitReason::Cancelled,
            };
        }

        match commands.recv_timeout(context.poll_interval) {
            Ok(ServiceCommand::Lifecycle(LifecycleCommand::Shutdown)) => {
                return ServiceStopReport {
                    service: context.service,
                    reason: ServiceExitReason::ShutdownCommand,
                };
            }
            Ok(_) => {}
            Err(crate::services::bus::BusRecvError::Timeout) => {}
            Err(crate::services::bus::BusRecvError::Closed) => {
                return ServiceStopReport {
                    service: context.service,
                    reason: ServiceExitReason::CommandBusClosed,
                };
            }
        }
    }
}

fn join_service(mut handle: ServiceHandle) -> ServiceResult<ServiceStopReport> {
    let service = handle.service;
    let Some(join) = handle.join.take() else {
        return Ok(ServiceStopReport {
            service,
            reason: ServiceExitReason::CommandBusClosed,
        });
    };
    join.join()
        .map_err(|_| ServiceError::ThreadPanicked { service })
}

fn event_error(error: BusSendError<ServiceEvent>) -> ServiceError {
    match error {
        BusSendError::Backpressure { capacity, .. } => ServiceError::EventBackpressure { capacity },
        BusSendError::Closed { .. } => ServiceError::EventBusClosed,
    }
}

fn command_error(service: ServiceKind, error: BusSendError<ServiceCommand>) -> ServiceError {
    match error {
        BusSendError::Backpressure { capacity, .. } => {
            ServiceError::CommandBackpressure { service, capacity }
        }
        BusSendError::Closed { .. } => ServiceError::CommandBusClosed { service },
    }
}
