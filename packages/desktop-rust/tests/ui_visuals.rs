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
fn visual_user_card_responsiveness() {
    let app_rs = fs::read_to_string("src/ui/shell/app.rs").expect("should read shell app.rs");
    let user_card_rs =
        fs::read_to_string("src/ui/components/user_card.rs").expect("should read user_card.rs");

    assert!(app_rs.contains(".p(px(24.0))"));
    assert!(app_rs.contains(".max_w(px(760.0))"));
    assert!(app_rs.contains(".max_h(px(820.0))"));
    assert!(app_rs.contains(".h_full()"));
    assert!(app_rs.contains(".overflow_hidden()"));

    assert!(user_card_rs.contains(".w_full()"));
    assert!(user_card_rs.contains(".h_full()"));
    assert!(user_card_rs.contains(".flex_1()"));
    assert!(user_card_rs.contains(".min_h_0()"));

    assert!(!user_card_rs.contains(".h(px(360.0))"));
    assert!(user_card_rs.contains("user-card-body-scroll"));
    assert!(user_card_rs.contains(".overflow_y_scroll()"));
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

#[test]
fn alias_editor_and_mention_autocomplete_source_contract() {
    let app_rs = fs::read_to_string("src/ui/shell/app.rs").expect("should read shell app.rs");
    let chat_rs = fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");
    let user_card_rs =
        fs::read_to_string("src/ui/components/user_card.rs").expect("should read user_card.rs");
    let popup_rs = fs::read_to_string("src/ui/components/autocomplete_popup.rs")
        .expect("should read autocomplete_popup.rs");

    assert!(user_card_rs.contains("user-card-alias-editor"));
    assert!(user_card_rs.contains("user-card-alias-input"));
    assert!(user_card_rs.contains("user-card-save-alias"));
    assert!(user_card_rs.contains("user-card-remove-alias"));
    assert!(app_rs.contains("fn save_user_alias"));
    assert!(app_rs.contains("fn remove_user_alias"));

    assert!(popup_rs.contains("mention-autocomplete-popup"));
    assert!(popup_rs.contains("mention-autocomplete-item-"));
    assert!(chat_rs.contains("MentionAutocompletePopup::new"));
    assert!(app_rs.contains("parse_mention_token"));
    assert!(app_rs.contains("replace_mention_token"));
}

#[test]
fn watched_mention_autocomplete_matches_visible_panel_fallback_scope() {
    let app_rs = fs::read_to_string("src/ui/shell/app.rs").expect("should read shell app.rs");
    let watched_layout_rs = fs::read_to_string("src/ui/components/watched_layout.rs")
        .expect("should read watched_layout.rs");

    assert!(watched_layout_rs.contains("message.platform == channel.platform"));
    assert!(watched_layout_rs.contains("message.channel_id == channel.id"));
    assert!(watched_layout_rs.contains("eq_ignore_ascii_case(&channel.channel_slug)"));

    assert!(app_rs.contains("message.platform == channel.platform"));
    assert!(app_rs.contains("message.channel_id == channel.id"));
    assert!(app_rs.contains("eq_ignore_ascii_case(&channel.channel_slug)"));
    assert!(app_rs.contains("user_card_alias_input"));
    assert!(app_rs.contains("is_focused(window)"));
}
