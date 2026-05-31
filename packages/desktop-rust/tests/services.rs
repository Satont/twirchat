use std::time::Duration;
use twirchat::services::{
    BusConfig, BusSendError, BusTryRecvError, ChatEvent, LifecycleEvent, ServiceCommand,
    ServiceEvent, ServiceKind, ServiceRuntimeConfig, ServiceSupervisor, UpdateCheckSource,
    UpdateStateCommand, UpdateStateEvent, WatchedChannelsCommand, WatchedChannelsEvent, bounded,
};

#[test]
fn service_runtime_default_uses_twirchat_sqlite() {
    let config = ServiceRuntimeConfig::default();

    assert!(config.storage_path().ends_with("twirchat.sqlite"));
    assert!(
        config
            .backend_ws()
            .storage_path()
            .ends_with("twirchat.sqlite")
    );
}

#[test]
fn service_lifecycle_start_stop() -> Result<(), Box<dyn std::error::Error>> {
    let config =
        ServiceRuntimeConfig::new(64, 8)?.with_service_poll_interval(Duration::from_millis(5));
    let mut supervisor = ServiceSupervisor::new(config)?;
    let events = supervisor
        .take_event_receiver()
        .ok_or("service event receiver should be available")?;

    supervisor.start()?;
    assert!(!supervisor.is_stopped());
    assert!(!supervisor.is_cancelled());

    let report = supervisor.stop()?;
    assert!(supervisor.is_stopped());
    assert!(supervisor.is_cancelled());
    assert!(report.cancelled());
    assert!(report.is_clean());
    assert!(!report.already_stopped());
    assert_eq!(
        report.stopped_services().len(),
        ServiceKind::startup_sequence().len()
    );

    let mut received = Vec::new();
    while let Ok(event) = events.try_recv() {
        received.push(event);
    }

    let started_services = lifecycle_services(&received, |event| match event {
        LifecycleEvent::ServiceStarted { service } => Some(*service),
        _ => None,
    });
    assert_eq!(started_services, ServiceKind::startup_sequence());

    let mut shutdown_sequence = ServiceKind::startup_sequence().to_vec();
    shutdown_sequence.reverse();
    let stopped_services = lifecycle_services(&received, |event| match event {
        LifecycleEvent::ServiceStopped { service } => Some(*service),
        _ => None,
    });
    assert_eq!(stopped_services, shutdown_sequence);
    assert!(received.contains(&ServiceEvent::Lifecycle(LifecycleEvent::RuntimeStarted)));
    assert!(received.contains(&ServiceEvent::Lifecycle(LifecycleEvent::RuntimeCancelled)));

    Ok(())
}

#[test]
fn service_bus_preserves_event_order() -> Result<(), Box<dyn std::error::Error>> {
    let (sender, receiver) = bounded(BusConfig::new(4)?);
    let events = vec![
        chat_event("first"),
        chat_event("second"),
        chat_event("third"),
    ];

    for event in events.clone() {
        sender.try_publish(event)?;
    }

    for expected in events {
        let received = receiver.recv_timeout(Duration::from_millis(10))?;
        assert_eq!(received, expected);
    }

    Ok(())
}

#[test]
fn service_bus_backpressure_reports_error() -> Result<(), Box<dyn std::error::Error>> {
    let (sender, receiver) = bounded(BusConfig::new(2)?);
    let first = chat_event("first");
    let second = chat_event("second");
    let overflow = chat_event("overflow");

    sender.try_publish(first.clone())?;
    sender.try_publish(second.clone())?;

    match sender.try_publish(overflow.clone()) {
        Err(BusSendError::Backpressure { item, capacity }) => {
            assert_eq!(*item, overflow);
            assert_eq!(capacity, 2);
        }
        Err(other) => return Err(format!("expected backpressure error, got {other}").into()),
        Ok(()) => return Err("overflow publish should fail".into()),
    }

    assert_eq!(receiver.recv_timeout(Duration::from_millis(10))?, first);
    assert_eq!(receiver.recv_timeout(Duration::from_millis(10))?, second);
    assert_eq!(receiver.try_recv(), Err(BusTryRecvError::Empty));

    Ok(())
}

#[test]
fn watched_send_failure_event_carries_client_message_id() -> Result<(), Box<dyn std::error::Error>>
{
    let temp = tempfile::tempdir()?;
    let db_path = temp.path().join("service-events.sqlite");
    let config = ServiceRuntimeConfig::new(128, 16)?
        .with_service_poll_interval(Duration::from_millis(5))
        .with_storage_path(&db_path);
    let mut supervisor = ServiceSupervisor::new(config)?;
    let events = supervisor
        .take_event_receiver()
        .ok_or("service event receiver should be available")?;

    supervisor.start()?;
    let client_message_id = "client-msg-1".to_string();
    supervisor.dispatch(
        ServiceKind::WatchedChannels,
        ServiceCommand::WatchedChannels(WatchedChannelsCommand::SendMessage {
            channel_id: "missing-channel".to_string(),
            text: "hello".to_string(),
            reply_to_message_id: None,
            client_message_id: Some(client_message_id.clone()),
        }),
    )?;

    let mut saw_expected = false;
    for _ in 0..40 {
        match events.recv_timeout(Duration::from_millis(25)) {
            Ok(ServiceEvent::WatchedChannels(WatchedChannelsEvent::MessageSendFailed {
                channel_id,
                client_message_id: event_client_message_id,
                ..
            })) => {
                assert_eq!(channel_id, "missing-channel");
                assert_eq!(event_client_message_id, client_message_id);
                saw_expected = true;
                break;
            }
            Ok(_) => {}
            Err(_) => {}
        }
    }

    let _ = supervisor.stop();
    assert!(
        saw_expected,
        "expected watched-channel send failure event with matching client_message_id"
    );
    Ok(())
}

#[test]
fn update_state_service_emits_requested_and_snapshot_events()
-> Result<(), Box<dyn std::error::Error>> {
    let config =
        ServiceRuntimeConfig::new(128, 16)?.with_service_poll_interval(Duration::from_millis(5));
    let mut supervisor = ServiceSupervisor::new(config)?;
    let events = supervisor
        .take_event_receiver()
        .ok_or("service event receiver should be available")?;

    supervisor.start()?;
    supervisor.dispatch(
        ServiceKind::UpdateState,
        ServiceCommand::UpdateState(UpdateStateCommand::CheckForUpdates {
            source: UpdateCheckSource::Startup,
        }),
    )?;

    let mut saw_requested = false;
    let mut saw_snapshot = false;
    for _ in 0..60 {
        match events.recv_timeout(Duration::from_millis(25)) {
            Ok(ServiceEvent::UpdateState(UpdateStateEvent::CheckRequested { source })) => {
                assert_eq!(source, UpdateCheckSource::Startup);
                saw_requested = true;
            }
            Ok(ServiceEvent::UpdateState(UpdateStateEvent::StateChanged { snapshot })) => {
                saw_snapshot = true;
                assert!(snapshot.status.is_some());
                break;
            }
            Ok(_) => {}
            Err(_) => {}
        }
    }

    let _ = supervisor.stop();
    assert!(saw_requested);
    assert!(saw_snapshot);
    Ok(())
}

#[test]
fn update_state_service_does_not_republish_unchanged_periodic_no_update_snapshot()
-> Result<(), Box<dyn std::error::Error>> {
    let config =
        ServiceRuntimeConfig::new(128, 16)?.with_service_poll_interval(Duration::from_millis(5));
    let mut supervisor = ServiceSupervisor::new(config)?;
    let events = supervisor
        .take_event_receiver()
        .ok_or("service event receiver should be available")?;

    supervisor.start()?;
    supervisor.dispatch(
        ServiceKind::UpdateState,
        ServiceCommand::UpdateState(UpdateStateCommand::CheckForUpdates {
            source: UpdateCheckSource::Startup,
        }),
    )?;

    let mut saw_startup_snapshot = false;
    for _ in 0..60 {
        match events.recv_timeout(Duration::from_millis(25)) {
            Ok(ServiceEvent::UpdateState(UpdateStateEvent::StateChanged { snapshot })) => {
                assert!(snapshot.show);
                assert_eq!(snapshot.status.as_deref(), Some("no-update"));
                saw_startup_snapshot = true;
                break;
            }
            Ok(_) => {}
            Err(_) => {}
        }
    }
    assert!(saw_startup_snapshot);

    while events.try_recv().is_ok() {}

    supervisor.dispatch(
        ServiceKind::UpdateState,
        ServiceCommand::UpdateState(UpdateStateCommand::CheckForUpdates {
            source: UpdateCheckSource::Periodic,
        }),
    )?;

    let mut saw_periodic_requested = false;
    let mut saw_periodic_snapshot = false;
    for _ in 0..20 {
        match events.recv_timeout(Duration::from_millis(25)) {
            Ok(ServiceEvent::UpdateState(UpdateStateEvent::CheckRequested { source })) => {
                if source == UpdateCheckSource::Periodic {
                    saw_periodic_requested = true;
                }
            }
            Ok(ServiceEvent::UpdateState(UpdateStateEvent::StateChanged { .. })) => {
                saw_periodic_snapshot = true;
                break;
            }
            Ok(_) => {}
            Err(_) => {}
        }
    }

    let _ = supervisor.stop();
    assert!(saw_periodic_requested);
    assert!(
        !saw_periodic_snapshot,
        "periodic no-update must not republish the startup no-update snapshot"
    );
    Ok(())
}

fn chat_event(message_id: &str) -> ServiceEvent {
    ServiceEvent::Chat(ChatEvent::MessageQueued {
        message_id: message_id.into(),
    })
}

fn lifecycle_services(
    events: &[ServiceEvent],
    pick: impl Fn(&LifecycleEvent) -> Option<ServiceKind>,
) -> Vec<ServiceKind> {
    events
        .iter()
        .filter_map(|event| match event {
            ServiceEvent::Lifecycle(event) => pick(event),
            _ => None,
        })
        .collect()
}
