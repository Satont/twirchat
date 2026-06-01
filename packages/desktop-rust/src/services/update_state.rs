use crate::runtime::{UpdateRuntime, UpdateState};
use crate::services::bus::{BusReceiver, BusRecvError, BusSender};
use crate::services::commands::{LifecycleCommand, ServiceCommand, UpdateStateCommand};
use crate::services::events::{ServiceEvent, UpdateStateEvent};
use crate::services::supervisor::{CancellationToken, ServiceExitReason, ServiceStopReport};
use std::path::PathBuf;
use std::time::Duration;

pub fn run_update_state_service(
    _storage_path: PathBuf,
    cancellation: CancellationToken,
    poll_interval: Duration,
    commands: BusReceiver<ServiceCommand>,
    events: BusSender<ServiceEvent>,
) -> ServiceStopReport {
    let mut runtime = UpdateRuntime::new(UpdateState::default());

    loop {
        if cancellation.is_cancelled() {
            return ServiceStopReport::new(
                crate::services::ServiceKind::UpdateState,
                ServiceExitReason::Cancelled,
            );
        }

        match commands.recv_timeout(poll_interval) {
            Ok(ServiceCommand::Lifecycle(LifecycleCommand::Shutdown)) => {
                return ServiceStopReport::new(
                    crate::services::ServiceKind::UpdateState,
                    ServiceExitReason::ShutdownCommand,
                );
            }
            Ok(ServiceCommand::UpdateState(command)) => {
                let requested = match command.clone() {
                    UpdateStateCommand::CheckForUpdates { source } => {
                        UpdateStateEvent::CheckRequested { source }
                    }
                    UpdateStateCommand::DownloadUpdate => UpdateStateEvent::DownloadRequested,
                    UpdateStateCommand::ApplyUpdate => UpdateStateEvent::ApplyRequested,
                    UpdateStateCommand::SkipUpdate { hash } => {
                        UpdateStateEvent::SkipRequested { hash }
                    }
                };
                let _ = events.try_publish(ServiceEvent::UpdateState(requested));
                let previous_snapshot = runtime.snapshot();
                runtime.dispatch_command(command);
                let snapshot = runtime.snapshot();
                if snapshot != previous_snapshot {
                    let _ = events.try_publish(ServiceEvent::UpdateState(
                        UpdateStateEvent::StateChanged { snapshot },
                    ));
                }
            }
            Ok(_) => {}
            Err(BusRecvError::Timeout) => {}
            Err(BusRecvError::Closed) => {
                return ServiceStopReport::new(
                    crate::services::ServiceKind::UpdateState,
                    ServiceExitReason::CommandBusClosed,
                );
            }
        }
    }
}
