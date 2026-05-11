mod support;

use support::new_state;
use twirchat_desktop_rust::app_state::MainSection;

#[test]
fn changing_active_section_updates_state() {
    let mut state = new_state();
    state.select_section(MainSection::Platforms);

    assert_eq!(state.active_section(), MainSection::Platforms);
}

#[test]
fn app_state_section_change_notifies_ui() {
    let mut state = new_state();
    state.select_section(MainSection::Settings);

    assert_eq!(state.active_section(), MainSection::Settings);
}
