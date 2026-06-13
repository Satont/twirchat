use crate::runtime::{
    UpdateCheckRequest, UpdateEngine, UpdateEvent, UpdateRuntime, UpdateState, UpdateStatus,
};
use crate::services::bus::{BusReceiver, BusRecvError, BusSender};
use crate::services::commands::{
    LifecycleCommand, ServiceCommand, UpdateCheckSource, UpdateStateCommand,
};
use crate::services::events::{ServiceEvent, UpdateStateEvent};
use crate::services::supervisor::{CancellationToken, ServiceExitReason, ServiceStopReport};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

pub fn run_update_state_service(
    _storage_path: PathBuf,
    cancellation: CancellationToken,
    poll_interval: Duration,
    commands: BusReceiver<ServiceCommand>,
    events: BusSender<ServiceEvent>,
) -> ServiceStopReport {
    let mut runtime = UpdateRuntime::new(UpdateState::default());
    let mut poll_interval = poll_interval;

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
            Ok(ServiceCommand::UpdateState(UpdateStateCommand::DownloadUpdate)) => {
                let _ = events.try_publish(ServiceEvent::UpdateState(
                    UpdateStateEvent::DownloadRequested,
                ));
                let previous_snapshot = runtime.snapshot();
                runtime.dispatch_command(UpdateStateCommand::DownloadUpdate);
                let snapshot = runtime.snapshot();
                if snapshot != previous_snapshot {
                    let _ = events.try_publish(ServiceEvent::UpdateState(
                        UpdateStateEvent::StateChanged { snapshot },
                    ));
                }
                spawn_download_task(
                    runtime.engine().clone(),
                    runtime.request().clone(),
                    events.clone(),
                );
            }
            Ok(ServiceCommand::UpdateState(command)) => {
                let requested = match command.clone() {
                    UpdateStateCommand::CheckForUpdates { source } => {
                        UpdateStateEvent::CheckRequested { source }
                    }
                    UpdateStateCommand::DownloadUpdate => unreachable!(),
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

        poll_interval = Duration::from_millis(runtime.snapshot().next_check_interval_ms);
    }
}

fn spawn_download_task(
    engine: Arc<dyn UpdateEngine>,
    request: UpdateCheckRequest,
    events: BusSender<ServiceEvent>,
) {
    thread::spawn(move || {
        let (progress_tx, progress_rx) = mpsc::channel::<i16>();

        let download_thread = {
            let engine = engine.clone();
            let request = request.clone();
            thread::spawn(move || engine.download_with_progress(&request, progress_tx))
        };

        loop {
            match progress_rx.try_recv() {
                Ok(percent) => {
                    let clamped = percent.clamp(0, 100);
                    let mut runtime = UpdateRuntime::new(UpdateState::default());
                    let _ = runtime.dispatch(UpdateEvent::Status {
                        status: UpdateStatus::DownloadProgress,
                        message: format!("Downloading: {clamped}%"),
                        progress: Some(clamped as f64),
                        hash: None,
                    });
                    let snapshot = runtime.snapshot();
                    let _ = events.try_publish(ServiceEvent::UpdateState(
                        UpdateStateEvent::StateChanged { snapshot },
                    ));
                }
                Err(mpsc::TryRecvError::Empty) => {
                    if download_thread.is_finished() {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                Err(mpsc::TryRecvError::Disconnected) => break,
            }
        }

        let result = download_thread.join().unwrap_or_else(|_| {
            Err(crate::runtime::UpdateEngineError::Failed(
                "Download thread panicked".to_string(),
            ))
        });

        let mut runtime = UpdateRuntime::new(UpdateState::default());
        match result {
            Ok(Some(update)) => {
                let hash = update.hash.clone().or_else(|| update.version.clone());
                let message = update.version.as_deref().map_or_else(
                    || "Download complete".to_string(),
                    |v| format!("Downloaded v{v}"),
                );
                let _ = runtime.dispatch(UpdateEvent::Status {
                    status: UpdateStatus::DownloadComplete,
                    message,
                    progress: Some(100.0),
                    hash,
                });
            }
            Ok(None) => {
                let _ = runtime.dispatch(UpdateEvent::NoUpdate {
                    source: UpdateCheckSource::Startup,
                    message: "No updates available".to_string(),
                });
            }
            Err(error) => {
                let _ = runtime.dispatch(UpdateEvent::Error {
                    message: error.to_string(),
                });
            }
        }
        let snapshot = runtime.snapshot();
        let _ = events.try_publish(ServiceEvent::UpdateState(UpdateStateEvent::StateChanged {
            snapshot,
        }));
    });
}
