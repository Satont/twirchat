use twirchat_desktop_rust::app_state::{AppState, UserCardLoadState};
use twirchat_desktop_rust::protocol::messages::{
    UserCardAccountAgeField, UserCardFieldStatus, UserCardFollowAgeField, UserCardMetadataPlatform,
    UserCardMetadataResponse, UserCardSubAgeField, UserCardSubscriptionDurationField,
};
use twirchat_desktop_rust::ui::components::user_card::{HistoryState, MetadataState};
use twirchat_desktop_rust::ui::shell::app::{
    account_age_text, follow_age_text, history_state_from_app_state, metadata_state_from_app_state,
    sub_age_text, subscription_duration_text,
};

#[test]
fn user_card_formats_metadata_text() {
    let mut response = UserCardMetadataResponse {
        platform: UserCardMetadataPlatform::Twitch,
        platform_user_id: "123".to_string(),
        fetched_at: 0,
        account_age: UserCardAccountAgeField {
            status: UserCardFieldStatus::Available,
            created_at: Some("2020-01-01".to_string()),
            message: None,
        },
        follow_age: UserCardFollowAgeField {
            status: UserCardFieldStatus::Available,
            followed_at: Some("2021-01-01".to_string()),
            message: Some("1 year".to_string()),
        },
        subscription_duration: UserCardSubscriptionDurationField {
            status: UserCardFieldStatus::Available,
            currently_subscribed: Some(true),
            tier: Some("1".to_string()),
            is_gift: Some(true),
            gifter_display_name: Some("GiftGiver".to_string()),
            message: Some("Test message".to_string()),
        },
        sub_age: UserCardSubAgeField {
            status: UserCardFieldStatus::Available,
            months: Some(5),
            message: None,
        },
    };

    assert_eq!(account_age_text(&response), "Created 2020-01-01");
    assert_eq!(
        follow_age_text(&response),
        "Following since 2021-01-01 · 1 year"
    );
    assert_eq!(
        subscription_duration_text(&response),
        "Currently subscribed · Tier 1 · Gifted by GiftGiver · Test message"
    );
    assert_eq!(sub_age_text(&response), "5 months");

    response.subscription_duration.is_gift = Some(false);
    assert_eq!(
        subscription_duration_text(&response),
        "Currently subscribed · Tier 1 · Test message"
    );

    response.sub_age.months = Some(1);
    assert_eq!(sub_age_text(&response), "1 month");
}

#[test]
fn user_card_empty_error_states() {
    let error_state: UserCardLoadState<UserCardMetadataResponse> = UserCardLoadState::Error {
        error: "Failed to load".to_string(),
        generation: 1,
    };

    let metadata_state = metadata_state_from_app_state(&error_state);
    assert_eq!(
        metadata_state,
        MetadataState::Error("Failed to load".into())
    );

    let loading_state: UserCardLoadState<UserCardMetadataResponse> =
        UserCardLoadState::Loading { generation: 1 };
    assert_eq!(
        metadata_state_from_app_state(&loading_state),
        MetadataState::Loading
    );

    assert_eq!(
        metadata_state_from_app_state(&UserCardLoadState::Idle),
        MetadataState::Unsupported
    );
}

#[test]
fn user_card_metadata_error_shows_retry() {
    let error_state: UserCardLoadState<UserCardMetadataResponse> = UserCardLoadState::Error {
        error: "Some API error".to_string(),
        generation: 1,
    };
    assert_eq!(
        metadata_state_from_app_state(&error_state),
        MetadataState::Error("Some API error".into())
    );
}

#[test]
fn user_card_empty_history_state() {
    let mut state = AppState::default();
    state.user_card.history = UserCardLoadState::Loaded {
        value: vec![],
        generation: 1,
    };

    assert_eq!(history_state_from_app_state(&state), HistoryState::Empty);
}

use twirchat_desktop_rust::protocol::types::{
    ChatAuthor, ChatMessageType, NormalizedChatMessage, Platform as ProtocolPlatform,
};

#[test]
fn user_card_load_older_ui_contract() {
    let source = include_str!("../src/ui/components/user_card.rs");
    assert!(source.contains("\"Load older\""));
    assert!(!source.contains("\"Scroll up to load older messages\""));
}

#[test]
fn user_card_load_older() {
    let mut state = AppState::default();
    state.user_card.has_more = true;
    state.user_card.loading_older = true;
    state.user_card.history = UserCardLoadState::Loaded {
        value: vec![NormalizedChatMessage {
            id: "msg1".to_string(),
            channel_id: "ch1".to_string(),
            platform: ProtocolPlatform::Twitch,
            text: "Hello".to_string(),
            author: ChatAuthor {
                id: "user1".to_string(),
                username: Some("user1".to_string()),
                display_name: "User1".to_string(),
                avatar_url: None,
                badges: vec![],
                color: None,
            },
            timestamp: "0".to_string(),
            message_type: ChatMessageType::Message,
            reply: None,
            emotes: vec![],
        }],
        generation: 1,
    };

    let history_state = history_state_from_app_state(&state);

    if let HistoryState::Loaded {
        messages,
        loading_older,
        has_more,
    } = history_state
    {
        assert_eq!(messages.len(), 1);
        assert!(loading_older);
        assert!(has_more);
    } else {
        panic!("Expected HistoryState::Loaded");
    }
}

#[test]
fn animated_emote_render_contract_avoids_io_and_handles_failed_cache() {
    let animated_emote_rs = include_str!("../src/ui/components/animated_emote.rs");

    assert!(
        animated_emote_rs
            .contains("Some(CachedAnimatedEmote::Failed) => self.render_remote_fallback()")
    );
    assert!(
        animated_emote_rs
            .contains("Some(CachedAnimatedEmote::Loading) | None => self.render_loading(cx)")
    );
    assert!(!animated_emote_rs.contains("fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl gpui::IntoElement {\n        let mut response ="));
}
