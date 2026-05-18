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
    assert!(chat_rs.contains("avatar-{}"));
    assert!(chat_rs.contains("badge-{}-{}-{}"));
    assert!(chat_rs.contains("emote-{}-{}-{}"));
    assert!(chat_rs.contains("ChatMessageType::System"));
    assert!(chat_rs.contains("rgba(0xffffff06)")); // Hover
    assert!(chat_rs.contains("theme::platform_color(to_model_platform(message.platform))")); // Stripe

    // Composer
    assert!(chat_rs.contains("composer"));
    assert!(chat_rs.contains("status_chip"));
    let app_rs = fs::read_to_string("src/ui/shell/app.rs").expect("should read app.rs");
    assert!(app_rs.contains("Send a message"));

    // Autocomplete & Emote picker buttons
    assert!(chat_rs.contains("☺"));
    assert!(chat_rs.contains("➤"));
}

#[test]
fn chat_input_keyboard_contract() {
    let app_rs = fs::read_to_string("src/ui/shell/app.rs").expect("should read app.rs");
    let input_rs = fs::read_to_string("src/ui/components/input.rs").expect("should read input.rs");

    assert!(app_rs.contains("Enter ↵ to send"));
    assert!(app_rs.contains("Shift+Enter for newline"));
    assert!(input_rs.contains("impl EntityInputHandler for Input"));
    assert!(input_rs.contains("window.handle_input"));
    assert!(input_rs.contains("ctrl-a"));
    assert!(input_rs.contains("left"));
    assert!(input_rs.contains("right"));
    assert!(input_rs.contains("ctrl-left"));
    assert!(input_rs.contains("ctrl-right"));
    assert!(input_rs.contains("ctrl-c"));
    assert!(input_rs.contains("ctrl-v"));
    assert!(input_rs.contains("ctrl-x"));
}

#[test]
fn scrollable_sections_reserve_visible_scrollbar_space() {
    let chat_rs = fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");
    let settings_rs = fs::read_to_string("src/ui/settings.rs").expect("should read settings.rs");
    let platforms_rs = fs::read_to_string("src/ui/platforms.rs").expect("should read platforms.rs");

    assert!(chat_rs.contains("vertical_scrollbar_for(props.scroll_ui.handle, window, cx)"));
    assert!(settings_rs.contains("vertical_scrollbar_for(scroll_handle, window, cx)"));
    assert!(platforms_rs.contains("vertical_scrollbar_for(scroll_handle, window, cx)"));
    assert!(chat_rs.contains("track_scroll(props.scroll_ui.handle)"));
    assert!(settings_rs.contains("track_scroll(scroll_handle)"));
    assert!(platforms_rs.contains("track_scroll(scroll_handle)"));
    assert!(platforms_rs.contains("platforms-scroll"));
}

#[test]
fn gpui_images_use_loading_and_fallback_contracts() {
    let chat_rs = fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");
    let platforms_rs = fs::read_to_string("src/ui/platforms.rs").expect("should read platforms.rs");
    let app_rs = fs::read_to_string("src/ui/shell/app.rs").expect("should read app.rs");

    assert!(chat_rs.contains("ImageSource::from"));
    assert!(chat_rs.contains("ObjectFit::Cover"));
    assert!(chat_rs.contains("with_loading"));
    assert!(chat_rs.contains("with_fallback"));
    assert!(chat_rs.contains("Path::new(url).is_absolute()"));
    assert!(platforms_rs.contains("ImageSource::from"));
    assert!(platforms_rs.contains("ObjectFit::Cover"));
    assert!(app_rs.contains("retain_all"));
}

#[test]
fn chat_platform_icons_and_badges_match_parity_contract() {
    let chat_rs = fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");
    let adapter_rs =
        fs::read_to_string("src/platforms/kick/adapter.rs").expect("should read adapter.rs");
    let platform_icon_rs = fs::read_to_string("src/ui/components/platform_icon.rs")
        .expect("should read platform_icon.rs");

    assert!(chat_rs.contains("PlatformIcon::new(to_model_platform(message.platform))"));
    assert!(chat_rs.contains("theme::platform_color(to_model_platform("));
    assert!(adapter_rs.contains("generated_kick_badge_path"));
    assert!(platform_icon_rs.contains("svg()"));
    assert!(platform_icon_rs.contains("external_path"));
}

#[test]
fn chat_section_routes_home_and_watched_tabs() {
    let content_rs = fs::read_to_string("src/ui/shell/content.rs").expect("should read content.rs");
    let tabs_rs = fs::read_to_string("src/ui/shell/tabs.rs").expect("should read tabs.rs");

    assert!(content_rs.contains("chat::panel("));
    assert!(content_rs.contains("state.active_channel_tab_id() == \"home\""));
    assert!(content_rs.contains("watched_layout::tab_panel"));
    assert!(tabs_rs.contains("state\n            .watched_channels"));
}

#[test]
fn home_chat_header_buttons_have_visible_popover_contracts() {
    let chat_rs = fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");

    assert!(chat_rs.contains("toggle_chat_appearance_popover"));
    assert!(chat_rs.contains("Appearance"));
    assert!(chat_rs.contains("toggle_chat_options_menu"));
    assert!(chat_rs.contains("Clear chat history"));
}

#[test]
fn watched_tab_header_has_pane_add_contract() {
    let watched_layout_rs = fs::read_to_string("src/ui/components/watched_layout.rs")
        .expect("should read watched_layout.rs");

    assert!(watched_layout_rs.contains("toggle_chat_add_menu"));
    assert!(watched_layout_rs.contains("Add chat pane (Split)"));
    assert!(watched_layout_rs.contains("PanelContent::Empty"));
}

#[test]
fn tab_add_button_has_visible_menu_contract() {
    let tabs_rs = fs::read_to_string("src/ui/shell/tabs.rs").expect("should read tabs.rs");
    let chat_rs = fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");

    assert!(tabs_rs.contains("open_add_channel_modal"));
    assert!(chat_rs.contains("Add Channel"));
    assert!(chat_rs.contains("Twitch channel name"));
    assert!(chat_rs.contains("Kick channel name"));
    assert!(chat_rs.contains("YouTube channel handle or ID"));
}

#[test]
fn gpui_http_client_is_wired_for_remote_avatars() {
    let main_rs = fs::read_to_string("src/main.rs").expect("should read main.rs");
    let cargo_toml = fs::read_to_string("Cargo.toml").expect("should read Cargo.toml");

    // The GPUI-provided ReqwestClient must be configured with a stable user agent
    assert!(main_rs.contains("reqwest_client::ReqwestClient"));
    assert!(main_rs.contains("proxy_and_user_agent(None, \"TwirChat/0.1.0\")"));
    assert!(main_rs.contains("cx.set_http_client(std::sync::Arc::new("));

    // Ensure the correct Zed-provided crate is declared
    assert!(cargo_toml.contains("reqwest_client"));
}
