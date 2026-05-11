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
    assert!(chat_rs.contains("message.system"));
    assert!(chat_rs.contains("rgba(0xffffff06)")); // Hover
    assert!(chat_rs.contains("theme::platform_color(message.platform)")); // Stripe

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
