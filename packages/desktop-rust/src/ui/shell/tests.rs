use crate::app_state::{AppState, MainSection};
use crate::runtime::update::UpdateStatusSnapshot;

#[test]
fn visual_main_shell_matches_vue_reference() {
    let mut state = AppState::new();

    // Initial state: Chat selected, sidebar not collapsed, unread events = 3
    assert_eq!(state.active_section(), MainSection::Chat);
    assert!(!state.sidebar_collapsed());
    assert_eq!(state.unread_events(), 3);

    // Test toggle sidebar
    state.toggle_sidebar();
    assert!(state.sidebar_collapsed());

    // Test section switches (nav order)
    state.select_section(MainSection::Events);
    assert_eq!(state.active_section(), MainSection::Events);
    assert_eq!(state.unread_events(), 0); // clears unread

    state.select_section(MainSection::Platforms);
    assert_eq!(state.active_section(), MainSection::Platforms);

    state.select_section(MainSection::Settings);
    assert_eq!(state.active_section(), MainSection::Settings);
}

#[test]
fn visual_update_toast_states() {
    let mut state = AppState::new();

    // Default hidden
    let toast = state.update_state();
    assert!(!toast.show);

    // Show "update-available" with hash
    state.set_update_state(UpdateStatusSnapshot {
        show: true,
        status: Some("update-available".to_string()),
        message: "v1.2.3".to_string(),
        progress: None,
        hash: Some("abcd".to_string()),
        skipped_hash: None,
        auto_check_updates: true,
        auto_dismiss_after_ms: None,
    });
    let toast = state.update_state();
    assert!(toast.show);
    assert_eq!(toast.status.as_deref(), Some("update-available"));
    assert_eq!(toast.message, "v1.2.3");

    // Dismiss
    state.dismiss_update_toast();
    assert!(!state.update_state().show);

    // Show progress
    state.set_update_state(UpdateStatusSnapshot {
        show: true,
        status: Some("downloading-patch".to_string()),
        message: "Downloading...".to_string(),
        progress: Some(42.0),
        hash: None,
        skipped_hash: None,
        auto_check_updates: true,
        auto_dismiss_after_ms: None,
    });
    assert_eq!(state.update_state().progress, Some(42.0));

    // Show download-complete
    state.set_update_state(UpdateStatusSnapshot {
        show: true,
        status: Some("download-complete".to_string()),
        message: "Ready to restart".to_string(),
        progress: None,
        hash: Some("abcd".to_string()),
        skipped_hash: None,
        auto_check_updates: true,
        auto_dismiss_after_ms: None,
    });
    assert_eq!(
        state.update_state().status.as_deref(),
        Some("download-complete")
    );
}
