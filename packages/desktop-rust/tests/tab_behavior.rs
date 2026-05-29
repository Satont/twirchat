use twirchat_desktop_rust::app_state::{AppState, PaneDropDirection};
use twirchat_desktop_rust::protocol::types::{ChatAuthor, ChatMessageType, NormalizedChatMessage};
use twirchat_desktop_rust::protocol::types::{LayoutNode, PanelContent, Platform, SplitDirection};
use twirchat_desktop_rust::services::{ServiceEvent, WatchedChannelsEvent};
use twirchat_desktop_rust::storage::Storage;
use twirchat_desktop_rust::storage::accounts::UpsertAccount;

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
    let visible_tabs_before = state
        .visible_watched_channels()
        .into_iter()
        .map(|channel| channel.id.clone())
        .collect::<Vec<_>>();
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
    assert_eq!(
        state
            .visible_watched_channels()
            .into_iter()
            .map(|channel| channel.id.clone())
            .collect::<Vec<_>>(),
        visible_tabs_before,
    );
    assert_eq!(
        storage
            .settings()
            .get_tab_channel_ids()
            .expect("tab order should reload"),
        Some(visible_tabs_before),
    );
}

#[test]
fn two_pane_tab_title_uses_both_channel_display_names() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("two-pane-title.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for title test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "base")
        .expect("base watched tab should persist");
    let active_tab = state.active_channel_tab_id().to_string();
    state
        .add_chat_pane_for_active_tab(&storage)
        .expect("second pane should persist");
    let empty_panel_id = find_empty_panel_id(
        &state
            .watched_layout(&active_tab)
            .expect("layout should exist")
            .root,
    )
    .expect("empty panel should exist");
    state.open_add_channel_modal_for_panel(empty_panel_id);
    state
        .submit_add_channel_modal(&storage, Platform::Twitch, "guest")
        .expect("guest pane should persist");

    assert_eq!(
        state.watched_tab_title(&active_tab).as_deref(),
        Some("base + guest"),
    );
}

#[test]
fn custom_watched_tab_name_overrides_generated_title_and_rehydrates() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("custom-tab-title.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for custom title test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "base")
        .expect("base watched tab should persist");
    let active_tab = state.active_channel_tab_id().to_string();

    assert!(
        state
            .rename_watched_tab(&storage, &active_tab, "Main + guests")
            .expect("custom title should persist")
    );
    assert_eq!(
        state.watched_tab_title(&active_tab).as_deref(),
        Some("Main + guests"),
    );

    let rehydrated = AppState::from_storage(&storage);
    assert_eq!(
        rehydrated.watched_tab_title(&active_tab).as_deref(),
        Some("Main + guests"),
    );
}

#[test]
fn removing_last_referenced_watched_pane_queues_channel_remove() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("orphan-pane-remove.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for orphan remove test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "base")
        .expect("base watched tab should persist");
    let active_tab = state.active_channel_tab_id().to_string();
    state
        .add_chat_pane_for_active_tab(&storage)
        .expect("second pane should persist");
    let empty_panel_id = find_empty_panel_id(
        &state
            .watched_layout(&active_tab)
            .expect("layout should exist")
            .root,
    )
    .expect("empty panel should exist");
    state.open_add_channel_modal_for_panel(empty_panel_id.clone());
    state
        .submit_add_channel_modal(&storage, Platform::Twitch, "guest")
        .expect("guest pane should persist");
    let guest_id = state
        .watched_channels
        .iter()
        .find(|channel| channel.channel_slug == "guest")
        .map(|channel| channel.id.clone())
        .expect("guest channel should exist");

    assert!(
        state
            .remove_chat_pane_for_active_tab(&storage, &empty_panel_id)
            .expect("pane remove should persist")
    );

    let pending = state.take_pending_watched_channel_removals();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].channel_id, guest_id);
    assert!(
        !state
            .watched_channels
            .iter()
            .any(|channel| channel.channel_slug == "guest")
    );
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
fn home_composer_routes_owned_kick_channel_through_watched_runtime() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("home-send.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for home send test");

    storage
        .accounts()
        .upsert(UpsertAccount {
            id: "kick-account-1",
            platform: Platform::Kick,
            platform_user_id: "kick-user-1",
            username: "satont",
            display_name: "Satont",
            avatar_url: None,
            access_token: "token",
            refresh_token: None,
            expires_at: None,
            scopes: &[],
        })
        .expect("kick account should persist");

    let mut state = AppState::from_storage(&storage);

    state.platforms_panel.statuses.insert(
        Platform::Kick,
        twirchat_desktop_rust::protocol::types::PlatformStatusInfo {
            platform: Platform::Kick,
            status: twirchat_desktop_rust::protocol::types::PlatformStatus::Connected,
            error: None,
            mode: twirchat_desktop_rust::protocol::types::PlatformStatusMode::Authenticated,
            channel_login: Some("satont".into()),
        },
    );
    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "satont")
        .expect("owned watched channel should persist");
    state.select_channel_tab("home");

    assert!(state.queue_composer_send("test message"));

    let watched_pending = state.take_pending_watched_channel_messages();
    let backend_pending = state.take_pending_backend_messages();
    assert_eq!(watched_pending.len(), 1);
    assert_eq!(watched_pending[0].channel_id, state.watched_channels[0].id);
    assert_eq!(watched_pending[0].text, "test message");
    assert!(backend_pending.is_empty());
}

#[test]
fn watched_history_persists_across_reload() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("watched-history.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for watched history test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "suhodolskiy")
        .expect("watched tab should persist");
    let watched_id = state.active_channel_tab_id().to_string();

    let message = NormalizedChatMessage {
        id: "kick-history-1".into(),
        platform: Platform::Kick,
        channel_id: "16992646".into(),
        author: ChatAuthor {
            id: "viewer-1".into(),
            username: Some("viewerone".into()),
            display_name: "Viewer One".into(),
            color: None,
            avatar_url: None,
            badges: vec![],
        },
        text: "persist me".into(),
        emotes: vec![],
        timestamp: "1700000000".into(),
        message_type: ChatMessageType::Message,
        reply: None,
    };

    storage
        .messages()
        .save(&message)
        .expect("message store save should work");
    storage
        .watched_history()
        .set(&watched_id, std::slice::from_ref(&message))
        .expect("watched history save should work");

    let reloaded = AppState::from_storage(&storage);
    let watched_history = reloaded
        .watched_channel_messages
        .get(&watched_id)
        .expect("watched history should reload by watched channel id");

    assert_eq!(watched_history.len(), 1);
    assert_eq!(watched_history[0].id, "kick-history-1");
    assert_eq!(watched_history[0].text, "persist me");
}

#[test]
fn own_account_watched_channel_is_not_exposed_as_tab() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("own-account-tab.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for own account tab test");

    storage
        .accounts()
        .upsert(UpsertAccount {
            id: "kick-account-1",
            platform: Platform::Kick,
            platform_user_id: "kick-user-1",
            username: "satont",
            display_name: "Satont",
            avatar_url: None,
            access_token: "token",
            refresh_token: None,
            expires_at: None,
            scopes: &[],
        })
        .expect("account should persist");

    let mut state = AppState::from_storage(&storage);
    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "satont")
        .expect("own account watched channel should persist");

    assert!(state.visible_watched_channels().is_empty());
}

#[test]
fn custom_watched_history_is_filtered_out_of_home_reload() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("custom-home-filter.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for custom home filter test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "suhodolskiy")
        .expect("custom watched tab should persist");
    let watched_id = state.active_channel_tab_id().to_string();
    let watched_message = NormalizedChatMessage {
        id: "custom-kick-1".into(),
        platform: Platform::Kick,
        channel_id: "16992646".into(),
        author: ChatAuthor {
            id: "viewer-1".into(),
            username: Some("viewerone".into()),
            display_name: "Viewer One".into(),
            color: None,
            avatar_url: None,
            badges: vec![],
        },
        text: "custom watched only".into(),
        emotes: vec![],
        timestamp: "1700000000".into(),
        message_type: ChatMessageType::Message,
        reply: None,
    };

    storage
        .messages()
        .save(&watched_message)
        .expect("global message save should work");
    storage
        .watched_history()
        .set(&watched_id, std::slice::from_ref(&watched_message))
        .expect("watched history save should work");

    let reloaded = AppState::from_storage(&storage);
    assert!(
        reloaded
            .messages
            .iter()
            .all(|message| message.id != "custom-kick-1")
    );
    assert_eq!(
        reloaded
            .watched_channel_messages
            .get(&watched_id)
            .map(|messages| messages.len()),
        Some(1)
    );
}

#[test]
fn watched_tab_order_rehydrates_from_persisted_ids_only() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("tab-order-rehydrate.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for tab order test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Twitch, "alpha")
        .expect("first watched tab should persist");
    let alpha_id = state.active_channel_tab_id().to_string();
    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "bravo")
        .expect("second watched tab should persist");
    let bravo_id = state.active_channel_tab_id().to_string();
    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Twitch, "charlie")
        .expect("third watched tab should persist");
    let charlie_id = state.active_channel_tab_id().to_string();

    storage
        .settings()
        .set_tab_channel_ids(&[bravo_id.clone(), alpha_id.clone()])
        .expect("persisted tab order should save");

    let reloaded = AppState::from_storage(&storage);
    let visible_ids = reloaded
        .visible_watched_channels()
        .into_iter()
        .map(|channel| channel.id.as_str())
        .collect::<Vec<_>>();

    assert_eq!(visible_ids, vec![bravo_id, alpha_id]);
    assert!(
        reloaded
            .watched_channels
            .iter()
            .any(|channel| channel.id == charlie_id)
    );
}

#[test]
fn reorder_watched_channel_tab_persists_insert_before_target_order() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("tab-reorder.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for tab reorder test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Twitch, "alpha")
        .expect("first watched tab should persist");
    let alpha_id = state.active_channel_tab_id().to_string();
    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "bravo")
        .expect("second watched tab should persist");
    let bravo_id = state.active_channel_tab_id().to_string();
    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Twitch, "charlie")
        .expect("third watched tab should persist");
    let charlie_id = state.active_channel_tab_id().to_string();

    let reordered = state
        .reorder_watched_channel_tab(&storage, &charlie_id, &alpha_id)
        .expect("tab reorder should persist");

    assert!(reordered);
    assert_eq!(
        storage
            .settings()
            .get_tab_channel_ids()
            .expect("tab order should reload"),
        Some(vec![charlie_id, alpha_id, bravo_id]),
    );
}

#[test]
fn remove_watched_channel_for_tab_persists_filtered_tab_ids_and_falls_back_home() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("tab-remove-persist.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for tab remove test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Twitch, "alpha")
        .expect("first watched tab should persist");
    let alpha_id = state.active_channel_tab_id().to_string();
    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "bravo")
        .expect("second watched tab should persist");
    let bravo_id = state.active_channel_tab_id().to_string();

    let removed = state
        .remove_watched_channel_for_tab(&storage, &bravo_id)
        .expect("tab removal should persist");

    assert!(removed);
    assert_eq!(state.active_channel_tab_id(), "home");
    assert_eq!(
        storage
            .settings()
            .get_tab_channel_ids()
            .expect("tab order should reload"),
        Some(vec![alpha_id]),
    );
}

#[test]
fn move_chat_pane_for_active_tab_moves_panel_right_and_persists() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("pane-move-right.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for pane move test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "base")
        .expect("base watched tab should persist");
    let active_tab = state.active_channel_tab_id().to_string();
    state
        .add_chat_pane_for_active_tab(&storage)
        .expect("second pane should persist");
    state
        .add_chat_pane_for_active_tab(&storage)
        .expect("third pane should persist");

    let layout = state
        .watched_layout(&active_tab)
        .expect("layout should exist before move");
    let before = panel_ids_in_order(&layout.root);
    assert_eq!(before.len(), 3);

    let moved = state
        .move_chat_pane_for_active_tab(&storage, &before[0], &before[2], PaneDropDirection::Right)
        .expect("pane move should persist");

    assert!(moved);
    let persisted = storage
        .watched_layout()
        .get(&active_tab)
        .expect("persisted layout should reload");
    assert_eq!(
        panel_ids_in_order(&persisted.root),
        vec![before[1].clone(), before[2].clone(), before[0].clone()]
    );
}

#[test]
fn move_chat_pane_for_active_tab_wraps_root_target_when_direction_changes() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("pane-move-wrap-root.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for pane wrap test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Twitch, "base")
        .expect("base watched tab should persist");
    let active_tab = state.active_channel_tab_id().to_string();
    state
        .add_chat_pane_for_active_tab(&storage)
        .expect("second pane should persist");

    let layout = state
        .watched_layout(&active_tab)
        .expect("layout should exist before move");
    let before = panel_ids_in_order(&layout.root);
    assert_eq!(before.len(), 2);

    let moved = state
        .move_chat_pane_for_active_tab(&storage, &before[0], &before[1], PaneDropDirection::Bottom)
        .expect("pane move should persist");

    assert!(moved);
    let persisted = storage
        .watched_layout()
        .get(&active_tab)
        .expect("persisted layout should reload");
    assert!(matches!(
        persisted.root,
        LayoutNode::Split {
            direction: SplitDirection::Vertical,
            ..
        }
    ));
    assert_eq!(
        panel_ids_in_order(&persisted.root),
        vec![before[1].clone(), before[0].clone()]
    );
}

#[test]
fn move_chat_pane_for_active_tab_recovers_horizontal_layout_from_vertical_split() {
    let temp = tempfile::tempdir().expect("temp dir should be available");
    let db_path = temp.path().join("pane-move-recover-horizontal.sqlite");
    let storage = Storage::open(&db_path).expect("storage should open for pane recover test");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Twitch, "base")
        .expect("base watched tab should persist");
    let active_tab = state.active_channel_tab_id().to_string();
    state
        .add_chat_pane_for_active_tab(&storage)
        .expect("second pane should persist");

    let layout = state
        .watched_layout(&active_tab)
        .expect("layout should exist before vertical move");
    let before = panel_ids_in_order(&layout.root);
    assert_eq!(before.len(), 2);

    state
        .move_chat_pane_for_active_tab(&storage, &before[0], &before[1], PaneDropDirection::Bottom)
        .expect("vertical pane move should persist");

    let vertical = storage
        .watched_layout()
        .get(&active_tab)
        .expect("vertical layout should reload");
    assert!(matches!(
        vertical.root,
        LayoutNode::Split {
            direction: SplitDirection::Vertical,
            ..
        }
    ));
    let vertical_order = panel_ids_in_order(&vertical.root);

    let recovered = state
        .move_chat_pane_for_active_tab(
            &storage,
            &vertical_order[1],
            &vertical_order[0],
            PaneDropDirection::Right,
        )
        .expect("horizontal recovery move should persist");

    assert!(recovered);
    let horizontal = storage
        .watched_layout()
        .get(&active_tab)
        .expect("horizontal layout should reload");
    assert!(matches!(
        horizontal.root,
        LayoutNode::Split {
            direction: SplitDirection::Horizontal,
            ..
        }
    ));
    assert_eq!(panel_ids_in_order(&horizontal.root), vertical_order);
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

fn panel_ids_in_order(node: &LayoutNode) -> Vec<String> {
    match node {
        LayoutNode::Panel { id, .. } => vec![id.clone()],
        LayoutNode::Split { children, .. } => {
            children.iter().flat_map(panel_ids_in_order).collect()
        }
    }
}
