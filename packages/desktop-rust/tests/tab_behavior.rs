use twirchat_desktop_rust::app_state::AppState;
use twirchat_desktop_rust::protocol::messages::DesktopToBackendMessage;
use twirchat_desktop_rust::protocol::types::{LayoutNode, PanelContent, Platform};
use twirchat_desktop_rust::services::{ServiceEvent, WatchedChannelsEvent};
use twirchat_desktop_rust::storage::Storage;

#[test]
fn top_level_add_creates_and_selects_a_watched_tab() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("top-level-tab.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for top-level tab test");
    let mut state = AppState::from_storage(&storage);

    let changed = state
        .add_watched_channel_tab_from_slug(&storage, Platform::Twitch, "satont")
        .expect("adding watched tab should persist");

    assert!(changed);
    assert_eq!(state.watched_channels.len(), 1);
    assert_eq!(state.active_channel_tab_id(), state.watched_channels[0].id);
    assert!(
        state
            .watched_layout(&state.watched_channels[0].id)
            .is_some()
    );
}

#[test]
fn watched_tab_inner_add_creates_an_empty_split_pane() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("inner-pane.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for inner pane test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Twitch, "satont")
        .expect("adding watched tab should persist");

    let changed = state
        .add_chat_pane_for_active_tab(&storage)
        .expect("adding watched pane should persist");

    assert!(changed);
    let layout = state
        .watched_layout(state.active_channel_tab_id())
        .expect("layout should exist for active watched tab");
    assert_eq!(count_panels(&layout.root), 2);
    assert!(has_empty_panel(&layout.root));
}

#[test]
fn watched_tab_uses_buffered_messages_for_channel_specific_rendering() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("watched-messages.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for watched message test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "satont")
        .expect("adding watched tab should persist");
    let watched_id = state.active_channel_tab_id().to_string();

    state.apply_service_event(ServiceEvent::WatchedChannels(
        WatchedChannelsEvent::MessageBuffered {
            channel_id: watched_id.clone(),
            message: Box::new(
                twirchat_desktop_rust::protocol::types::NormalizedChatMessage {
                    id: "kick-msg-1".into(),
                    platform: Platform::Kick,
                    channel_id: "424242".into(),
                    author: twirchat_desktop_rust::protocol::types::ChatAuthor {
                        id: "viewer-1".into(),
                        username: Some("viewerone".into()),
                        display_name: "Viewer One".into(),
                        color: None,
                        avatar_url: None,
                        badges: vec![],
                    },
                    text: "hello from kick".into(),
                    emotes: vec![],
                    timestamp: "1700000000".into(),
                    message_type: twirchat_desktop_rust::protocol::types::ChatMessageType::Message,
                    reply: None,
                },
            ),
        },
    ));

    let buffered = state
        .watched_channel_messages
        .get(&watched_id)
        .expect("watched channel buffer should be tracked by watched entry id");
    assert_eq!(buffered.len(), 1);
    assert_eq!(buffered[0].id, "kick-msg-1");
    assert_eq!(buffered[0].channel_id, "424242");
    assert!(state.messages.is_empty());
}

#[test]
fn removing_active_watched_tab_returns_to_home() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("remove-tab.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for remove tab test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "suhodolskiy")
        .expect("adding watched tab should persist");
    let active_id = state.active_channel_tab_id().to_string();

    let removed = state.remove_watched_channel(&active_id);

    assert!(removed);
    assert_eq!(state.active_channel_tab_id(), "home");
    assert!(state.watched_channels.is_empty());
}

#[test]
fn watched_pane_send_queue_targets_only_requested_channel() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("watched-send.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for watched send test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Twitch, "satont")
        .expect("first watched tab should persist");
    let first_id = state.active_channel_tab_id().to_string();
    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "suhodolskiy")
        .expect("second watched tab should persist");
    let second_id = state.active_channel_tab_id().to_string();

    assert!(state.queue_watched_channel_send(&second_id, "hello"));

    let pending = state.take_pending_watched_channel_messages();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].channel_id, second_id);
    assert_ne!(pending[0].channel_id, first_id);
    assert_eq!(pending[0].text, "hello");
}

#[test]
fn empty_pane_can_be_assigned_via_modal_target() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("empty-assign.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for empty assign test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "suhodolskiy")
        .expect("base watched tab should persist");
    let active_tab = state.active_channel_tab_id().to_string();
    state
        .add_chat_pane_for_active_tab(&storage)
        .expect("empty pane should be added");
    let layout = state
        .watched_layout(&active_tab)
        .expect("layout should exist after split");
    let empty_panel_id = find_empty_panel_id(&layout.root).expect("empty panel should exist");

    state.open_add_channel_modal_for_panel(empty_panel_id.clone());
    let assigned = state
        .submit_add_channel_modal(&storage, Platform::Twitch, "stray228")
        .expect("modal assignment should persist");

    assert!(assigned);
    let updated = state
        .watched_layout(&active_tab)
        .expect("layout should still exist after assignment");
    let assigned_channel_id = state
        .watched_channels
        .iter()
        .find(|channel| channel.channel_slug == "stray228")
        .map(|channel| channel.id.clone())
        .expect("assigned watched channel should exist");
    assert!(layout_contains_channel(&updated.root, &assigned_channel_id));
    assert_eq!(state.active_channel_tab_id(), active_tab);
}

#[test]
fn empty_pane_can_be_removed_and_layout_collapses() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("empty-remove.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for empty remove test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "suhodolskiy")
        .expect("base watched tab should persist");
    let active_tab = state.active_channel_tab_id().to_string();
    state
        .add_chat_pane_for_active_tab(&storage)
        .expect("empty pane should be added");
    let layout = state
        .watched_layout(&active_tab)
        .expect("layout should exist after split");
    let empty_panel_id = find_empty_panel_id(&layout.root).expect("empty panel should exist");

    let removed = state
        .remove_chat_pane_for_active_tab(&storage, &empty_panel_id)
        .expect("empty pane remove should persist");

    assert!(removed);
    let updated = state
        .watched_layout(&active_tab)
        .expect("layout should still exist after remove");
    assert_eq!(count_panels(&updated.root), 1);
    assert!(!has_empty_panel(&updated.root));
}

#[test]
fn home_composer_queues_backend_messages_not_watched_channel_messages() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("home-send.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for home send test");
    let mut state = AppState::from_storage(&storage);

    state.platforms_panel.statuses.insert(
        Platform::Twitch,
        twirchat_desktop_rust::protocol::types::PlatformStatusInfo {
            platform: Platform::Twitch,
            status: twirchat_desktop_rust::protocol::types::PlatformStatus::Connected,
            error: None,
            mode: twirchat_desktop_rust::protocol::types::PlatformStatusMode::Authenticated,
            channel_login: Some("stray228".into()),
        },
    );
    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "suhodolskiy")
        .expect("watched tab should persist");
    state.select_channel_tab("home");

    assert!(state.queue_composer_send("test message"));

    let watched_pending = state.take_pending_watched_channel_messages();
    let backend_pending = state.take_pending_backend_messages();
    assert!(watched_pending.is_empty());
    assert_eq!(backend_pending.len(), 1);
    assert!(matches!(
        &backend_pending[0],
        DesktopToBackendMessage::SendMessage {
            platform: Platform::Twitch,
            channel,
            message,
        } if channel == "stray228" && message == "test message"
    ));
}

fn count_panels(node: &LayoutNode) -> usize {
    match node {
        LayoutNode::Panel { .. } => 1,
        LayoutNode::Split { children, .. } => children.iter().map(count_panels).sum(),
    }
}

fn has_empty_panel(node: &LayoutNode) -> bool {
    match node {
        LayoutNode::Panel { content, .. } => matches!(content, PanelContent::Empty),
        LayoutNode::Split { children, .. } => children.iter().any(has_empty_panel),
    }
}

fn find_empty_panel_id(node: &LayoutNode) -> Option<String> {
    match node {
        LayoutNode::Panel { id, content, .. } => {
            matches!(content, PanelContent::Empty).then(|| id.clone())
        }
        LayoutNode::Split { children, .. } => children.iter().find_map(find_empty_panel_id),
    }
}

fn layout_contains_channel(node: &LayoutNode, channel_id: &str) -> bool {
    match node {
        LayoutNode::Panel { content, .. } => {
            matches!(content, PanelContent::Watched { channel_id: id } if id == channel_id)
        }
        LayoutNode::Split { children, .. } => children
            .iter()
            .any(|child| layout_contains_channel(child, channel_id)),
    }
}
