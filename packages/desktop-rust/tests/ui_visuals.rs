// Test file for Task 19
use std::fs;

#[test]
fn visual_user_card_and_popovers_match_vue() {
    let user_card_rs =
        fs::read_to_string("src/ui/components/user_card.rs").expect("should read user_card.rs");

    // We are testing that the GPUI slice structurally mirrors the Vue behavior
    assert!(user_card_rs.contains("user-card-modal"));
    assert!(user_card_rs.contains("user-card-refresh-metadata"));
    assert!(user_card_rs.contains("user-card-refresh-history"));
    assert!(user_card_rs.contains("user-card-load-older"));
    assert!(user_card_rs.contains("Loading metadata"));
    assert!(user_card_rs.contains("No stored messages for this user yet."));
    assert!(user_card_rs.contains("Metadata is not supported for this platform yet."));
    assert!(user_card_rs.contains("Loading older messages…"));
    assert!(user_card_rs.contains("Load older"));
    assert!(!user_card_rs.contains("Scroll up to load older messages"));

    // Also test header text structure logic mirror
    assert!(user_card_rs.contains("Alias:"));
    assert!(user_card_rs.contains("Account metadata"));
    assert!(user_card_rs.contains("Chat logs"));
}

#[test]
fn modal_focus_and_escape_contract() {
    let app_rs = fs::read_to_string("src/ui/shell/app.rs").expect("should read shell app.rs");

    let escape_guard = app_rs
        .find("event.keystroke.key.as_str() == \"escape\" && self.state.read(cx).user_card.open")
        .expect("Escape should close user-card before other shortcut handling");
    let tab_selector_guard = app_rs
        .find("if self.tab_selector_open")
        .expect("tab selector Escape handling should still exist");
    let shortcuts_guard = app_rs
        .find("if self.shortcuts_blocked(window, cx)")
        .expect("normal shortcuts should still be guarded");
    assert!(escape_guard < tab_selector_guard);
    assert!(escape_guard < shortcuts_guard);

    let user_card_layer = app_rs
        .find("self.render_user_card_modal(&state, cx)")
        .expect("shell should render the user-card modal");
    let tab_selector_layer = app_rs
        .find("self.render_tab_selector_modal(&state, cx)")
        .expect("shell should keep rendering the tab selector modal");
    let toast_layer = app_rs
        .find("UpdateToast::new(self.state.clone())")
        .expect("shell should keep rendering the update toast");
    assert!(user_card_layer < tab_selector_layer);
    assert!(user_card_layer < toast_layer);
    assert!(app_rs.contains("id(\"user-card-close\")"));
}

#[test]
fn user_card_async_shell_contract() {
    let app_rs = fs::read_to_string("src/ui/shell/app.rs").expect("should read shell app.rs");

    assert!(app_rs.contains("_user_card_history_task: Option<Task<()>>"));
    assert!(app_rs.contains("_user_card_metadata_task: Option<Task<()>>"));
    assert!(app_rs.contains("fn start_user_card_loads"));
    assert!(app_rs.contains("fn refresh_user_card_metadata"));
    assert!(app_rs.contains("fn refresh_user_card_history"));
    assert!(app_rs.contains("fn load_older_user_card_history"));
    assert!(app_rs.contains("fn close_user_card"));
    assert!(app_rs.contains(".fetch_user_card_metadata(request)"));
    assert!(app_rs.contains(".load_user_chat_history(params)"));
    assert!(app_rs.contains(".background_executor()"));
    assert!(app_rs.contains("state.apply_user_card_metadata_result(generation, result)"));
    assert!(app_rs.contains("state.apply_user_card_history_result(request, result)"));
    assert!(app_rs.contains("if self.user_card_load_generation != Some(generation)"));
    assert_no_user_card_service_call_inside_this_update(&app_rs, "fetch_user_card_metadata");
    assert_no_user_card_service_call_inside_this_update(&app_rs, "load_user_chat_history");
}

#[test]
fn user_card_unsupported_youtube_metadata_is_not_mapped_to_kick() {
    let app_rs = fs::read_to_string("src/ui/shell/app.rs").expect("should read shell app.rs");
    let user_card_rs =
        fs::read_to_string("src/ui/components/user_card.rs").expect("should read user_card.rs");

    assert!(app_rs.contains("fn metadata_platform(platform: Platform) -> Option"));
    assert!(app_rs.contains("Platform::Youtube => None"));
    let forbidden_mapping = [
        "Platform::Kick | Platform::Youtube",
        " => UserCardMetadataPlatform::Kick",
    ]
    .concat();
    assert!(!app_rs.contains(&forbidden_mapping));
    assert!(user_card_rs.contains("Metadata is not supported for this platform yet."));
}

fn assert_no_user_card_service_call_inside_this_update(app_rs: &str, call: &str) {
    let mut search_start = 0;
    while let Some(relative_start) = app_rs[search_start..].find("this.update(cx, |this, _cx|") {
        let start = search_start + relative_start;
        let end = app_rs[start..]
            .find(";\n")
            .map(|relative_end| start + relative_end)
            .unwrap_or(app_rs.len());
        let update_block = &app_rs[start..end];
        assert!(
            !update_block.contains(call),
            "{call} must not execute inside a GPUI this.update closure"
        );
        search_start = start + "this.update(cx, |this, _cx|".len();
    }
}
