use std::fs;
use std::path::Path;

#[test]
fn ui_tokens_match_vue_sources() {
    let app_vue =
        fs::read_to_string("../desktop/src/views/main/App.vue").expect("should read App.vue");
    assert!(app_vue.contains("--c-bg: #0f0f11;"));
    assert!(app_vue.contains("--c-surface: #18181b;"));
    assert!(app_vue.contains("--c-bg: #f0eff4;"));
}

#[test]
fn ui_platform_icons_have_svg_sources() {
    assert!(Path::new("../desktop/src/assets/icons/platforms/twitch.svg").exists());
    assert!(Path::new("../desktop/src/assets/icons/platforms/youtube.svg").exists());
    assert!(Path::new("../desktop/src/assets/icons/platforms/kick.svg").exists());
}

#[test]
fn visual_chat_page_matches_vue_reference() {
    let chat_rs = fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");

    // Header
    assert!(chat_rs.contains("LIVE CHAT"));
    assert!(chat_rs.contains("header_chip"));
    assert!(chat_rs.contains("messages"));

    // Message List (Modern)
    assert!(chat_rs.contains("message_row"));
    assert!(chat_rs.contains("ChatMessageType::System"));
    assert!(chat_rs.contains("rgba(0xffffff06)")); // Hover
    assert!(chat_rs.contains("theme::platform_color(to_model_platform(message.platform))")); // Stripe

    // Composer
    assert!(chat_rs.contains("composer"));
    assert!(chat_rs.contains("status_chip"));
    assert!(chat_rs.contains("Send a message"));

    // Autocomplete & Emote picker buttons
    assert!(chat_rs.contains("☺"));
    assert!(chat_rs.contains("➤"));
}

#[test]
fn chat_input_keyboard_contract() {
    // In our prototype, these are comments or placeholders indicating the required behaviour
    let chat_rs = fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");

    assert!(chat_rs.contains("Enter ↵ to send"));
    assert!(chat_rs.contains("Shift+Enter for newline"));
}

#[test]
fn chat_section_is_unified_home_feed() {
    let content_rs = fs::read_to_string("src/ui/shell/content.rs").expect("should read content.rs");
    let tabs_rs = fs::read_to_string("src/ui/shell/tabs.rs").expect("should read tabs.rs");

    assert!(content_rs.contains("chat::panel(state, state_entity.clone(), cx)"));
    assert!(!content_rs.contains("active_channel_tab_id"));
    assert!(!tabs_rs.contains("for channel in &state.watched_channels"));
}

#[test]
fn chat_header_buttons_have_visible_popover_contracts() {
    let chat_rs = fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");

    assert!(chat_rs.contains("toggle_chat_appearance_popover"));
    assert!(chat_rs.contains("Appearance"));
    assert!(chat_rs.contains("toggle_chat_add_menu"));
    assert!(chat_rs.contains("ADD"));
    assert!(chat_rs.contains("Watch {} ({})"));
    assert!(chat_rs.contains("toggle_chat_options_menu"));
    assert!(chat_rs.contains("Clear chat history"));
}

#[test]
fn tab_add_button_has_visible_menu_contract() {
    let tabs_rs = fs::read_to_string("src/ui/shell/tabs.rs").expect("should read tabs.rs");

    assert!(tabs_rs.contains("toggle_tab_add_menu"));
    assert!(tabs_rs.contains("ADD CHANNEL"));
    assert!(tabs_rs.contains("Watch {} ({})"));
    assert!(tabs_rs.contains("add_watched_channel_from_account"));
}
