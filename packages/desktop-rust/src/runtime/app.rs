use crate::runtime::{RuntimeConfig, RuntimeConfigInput};
use crate::services::{
    BackendWsCommand, BackendWsConfig, BusReceiver, ServiceCommand, ServiceEvent, ServiceKind,
    ServiceRuntimeConfig, ServiceSupervisor,
};
use crate::storage::{Storage, StorageError};
use std::error::Error;
use std::fmt;

#[derive(Debug)]
pub enum AppRuntimeError {
    Storage(StorageError),
    Service(crate::services::ServiceError),
}

impl fmt::Display for AppRuntimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Storage(source) => write!(f, "failed to initialize app storage: {source}"),
            Self::Service(source) => write!(f, "failed to initialize app services: {source}"),
        }
    }
}

impl Error for AppRuntimeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Storage(source) => Some(source),
            Self::Service(source) => Some(source),
        }
    }
}

impl From<StorageError> for AppRuntimeError {
    fn from(value: StorageError) -> Self {
        Self::Storage(value)
    }
}

impl From<crate::services::ServiceError> for AppRuntimeError {
    fn from(value: crate::services::ServiceError) -> Self {
        Self::Service(value)
    }
}

pub struct AppRuntime {
    config: RuntimeConfig,
    storage: Storage,
    supervisor: ServiceSupervisor,
    events: BusReceiver<ServiceEvent>,
}

impl AppRuntime {
    pub fn start(input: RuntimeConfigInput) -> Result<Self, AppRuntimeError> {
        let config = RuntimeConfig::new(input);
        let storage = Storage::open_or_recover(config.db_path())?;
        let service_config = ServiceRuntimeConfig::default().with_backend_ws(BackendWsConfig::new(
            config.backend_ws_url(),
            config.db_path(),
        ));
        let mut supervisor = ServiceSupervisor::new(service_config)?;
        let events = supervisor.take_event_receiver().ok_or(
            crate::services::ServiceError::ServiceMissing {
                service: ServiceKind::Storage,
            },
        )?;

        supervisor.start()?;
        supervisor.dispatch(
            ServiceKind::BackendWs,
            ServiceCommand::BackendWs(BackendWsCommand::Connect),
        )?;

        Ok(Self {
            config,
            storage,
            supervisor,
            events,
        })
    }

    pub fn storage(&self) -> &Storage {
        &self.storage
    }

    pub fn config(&self) -> &RuntimeConfig {
        &self.config
    }

    pub fn drain_events(&self) -> Vec<ServiceEvent> {
        let mut events = Vec::new();
        loop {
            match self.events.try_recv() {
                Ok(event) => events.push(event),
                Err(crate::services::BusTryRecvError::Empty) => break,
                Err(crate::services::BusTryRecvError::Closed) => break,
            }
        }
        events
    }
}

impl Drop for AppRuntime {
    fn drop(&mut self) {
        if self.supervisor.stop().is_err() {}
    }
}
