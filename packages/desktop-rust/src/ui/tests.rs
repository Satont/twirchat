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
    let selectable_message_rs = fs::read_to_string("src/ui/components/selectable_message.rs")
        .expect("should read selectable_message.rs");

    // Header
    assert!(chat_rs.contains("LIVE CHAT"));
    assert!(chat_rs.contains("header_chip"));
    assert!(chat_rs.contains("HomeChipTooltip"));
    assert!(chat_rs.contains("format_compact_viewers"));
    assert!(chat_rs.contains("format_exact_viewers"));
    assert!(chat_rs.contains("Viewers"));
    assert!(chat_rs.contains("messages"));

    // Message List (Modern)
    assert!(chat_rs.contains("message_row"));
    assert!(chat_rs.contains("avatar-{}"));
    assert!(chat_rs.contains("badge-{}-{}-{}"));
    assert!(selectable_message_rs.contains("emote-{}-{}-{}"));
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
    let chat_rs = fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");
    let input_rs = fs::read_to_string("src/ui/components/input.rs").expect("should read input.rs");

    assert!(chat_rs.contains("Enter ↵ to send"));
    assert!(chat_rs.contains("Shift+Enter for newline"));
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

    assert!(chat_rs.contains("vertical_scrollbar_for(props.scroll_ui.list_state, window, cx)"));
    assert!(settings_rs.contains("vertical_scrollbar_for(scroll_handle, window, cx)"));
    assert!(platforms_rs.contains("vertical_scrollbar_for(scroll_handle, window, cx)"));
    assert!(chat_rs.contains("ChatScrollUi"));
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
fn animated_emote_component_drives_unfocused_redraw_contract() {
    let animated_emote_rs = fs::read_to_string("src/ui/components/animated_emote.rs")
        .expect("should read animated_emote.rs");
    let selectable_message_rs = fs::read_to_string("src/ui/components/selectable_message.rs")
        .expect("should read selectable_message.rs");
    let watched_layout_rs = fs::read_to_string("src/ui/components/watched_layout.rs")
        .expect("should read watched_layout.rs");

    assert!(animated_emote_rs.contains("window.request_animation_frame()"));
    assert!(animated_emote_rs.contains("ImageSource::Render"));
    assert!(animated_emote_rs.contains("animated_emote_cache"));
    assert!(selectable_message_rs.contains("animated_emote("));
    assert!(watched_layout_rs.contains("MessageRowOptions::watched()"));
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
    assert!(tabs_rs.contains(".visible_watched_channels()"));
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

    assert!(watched_layout_rs.contains("add_chat_pane_for_active_tab"));
    assert!(watched_layout_rs.contains("open_add_channel_modal_for_panel"));
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

#[test]
fn watched_tab_header_has_appearance_popover_contract() {
    let watched_layout_rs = std::fs::read_to_string("src/ui/components/watched_layout.rs")
        .expect("should read watched_layout.rs");

    assert!(watched_layout_rs.contains("toggle_chat_appearance_popover"));
    assert!(watched_layout_rs.contains("render_appearance_popover"));
}

#[test]
fn chat_appearance_toggles_apply_to_all_scopes() {
    let chat_rs = std::fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");
    let switch_rs =
        std::fs::read_to_string("src/ui/components/switch.rs").expect("should read switch.rs");

    for (label, switch_id, setter) in [
        ("Show Avatars", "chat-show-avatars", "set_show_avatars"),
        ("Show Badges", "chat-show-badges", "set_show_badges"),
        (
            "Platform Icon",
            "chat-show-platform-icon",
            "set_show_platform_icon",
        ),
        ("Timestamp", "chat-show-timestamp", "set_show_timestamp"),
        (
            "Platform Stripe",
            "chat-show-platform-stripe",
            "set_show_platform_color_stripe",
        ),
    ] {
        assert!(chat_rs.contains(label));
        assert!(chat_rs.contains(switch_id));
        assert!(chat_rs.contains(setter));
    }

    for gate in [
        "settings.show_avatars",
        "settings.show_badges",
        "settings.show_platform_icon",
        "settings.show_timestamp",
        "settings.show_platform_color_stripe",
    ] {
        assert!(chat_rs.contains(gate));
    }

    // Verify MessageRowOptions doesn't have stripe/icon gating.
    assert!(!chat_rs.contains("show_platform_stripe: false"));
    assert!(!chat_rs.contains("show_platform_icon: false"));

    // Verify popover interactions persist without changing global settings-page semantics.
    assert!(chat_rs.contains("state_entity.persist_settings(cx);"));

    // Switch instances are rendered repeatedly in the appearance popover and must not share identity.
    assert!(!switch_rs.contains(".id(\"switch\")"));
}

#[test]
fn compact_chat_uses_distinct_layout_without_avatar_branch() {
    let chat_rs = std::fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");

    assert!(chat_rs.contains("if is_compact {"));
    assert!(chat_rs.contains("return compact_message_row("));

    let compact_fn_start = chat_rs.find("fn compact_message_row").unwrap();
    let message_fn_start = chat_rs.find("pub(crate) fn message_row").unwrap();
    let compact_body = &chat_rs[compact_fn_start..message_fn_start];

    assert!(!compact_body.contains("settings.show_avatars"));
    assert!(!compact_body.contains("avatar_url"));
    assert!(!compact_body.contains("flex_col()"));

    assert!(compact_body.contains("SelectableMessagePart::Custom"));
}

#[test]
fn user_card_right_click_trigger() {
    let chat_rs = std::fs::read_to_string("src/ui/chat.rs").expect("should read chat.rs");

    // Modern avatar right-click
    assert!(chat_rs.contains("avatar_url.clone()"));
    assert!(chat_rs.contains("gpui::MouseButton::Right"));
    assert!(chat_rs.contains("state.open_user_card"));

    // Modern label right-click
    assert!(chat_rs.contains("author_label_text"));
    assert!(chat_rs.contains("gpui::MouseButton::Right"));

    // Compact label right-click
    let compact_fn_start = chat_rs.find("fn compact_message_row").unwrap();
    let message_fn_start = chat_rs.find("pub(crate) fn message_row").unwrap();
    let compact_body = &chat_rs[compact_fn_start..message_fn_start];
    assert!(compact_body.contains("SelectableMessagePart::Custom"));
    assert!(compact_body.contains("gpui::MouseButton::Right"));
    assert!(compact_body.contains("state.open_user_card"));

    // System messages exclude user card logic
    let message_fn_body = &chat_rs[message_fn_start..];
    let system_check = message_fn_body
        .find("if message.message_type == ChatMessageType::System")
        .unwrap();
    let early_return = message_fn_body[system_check..].find("return").unwrap();
    let system_block = &message_fn_body[system_check..system_check + early_return + 50];
    assert!(!system_block.contains("gpui::MouseButton::Right"));
}
