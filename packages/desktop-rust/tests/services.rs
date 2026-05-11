use std::time::Duration;
use twirchat_desktop_rust::services::{
    BusConfig, BusSendError, BusTryRecvError, ChatEvent, LifecycleEvent, ServiceEvent, ServiceKind,
    ServiceRuntimeConfig, ServiceSupervisor, bounded,
};

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
