use twirchat::app_state::AppState;
use twirchat::protocol::messages::{BackendToDesktopMessage, SevenTvEmote};
use twirchat::protocol::types::{ChatAuthor, ChatMessageType, NormalizedChatMessage, Platform};
use twirchat::services::{BackendWsEvent, ServiceEvent, WatchedChannelsEvent};
use twirchat::storage::Storage;

fn main() {
    let db_path = std::env::temp_dir().join(format!(
        "twirchat-watched-history-emotes-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let storage = Storage::open(&db_path).expect("storage should open");
    let mut state = AppState::from_storage(&storage);

    state
        .add_watched_channel_tab_from_slug(&storage, Platform::Kick, "suhodolskiy")
        .expect("watched tab add should succeed");
    let watched_id = state.active_channel_tab_id().to_string();

    state.apply_service_event(ServiceEvent::BackendWs(BackendWsEvent::MessageDecoded {
        message: BackendToDesktopMessage::SeventvEmoteSet {
            platform: Platform::Kick,
            channel_id: "16992646".into(),
            emotes: vec![SevenTvEmote {
                id: "7tv-kick-1".into(),
                alias: "KEKW".into(),
                name: "KEKW".into(),
                animated: false,
                zero_width: false,
                aspect_ratio: 1.0,
                image_url: "https://cdn.7tv.app/emote/7tv-kick-1/4x.webp".into(),
            }],
        },
    }));

    state.apply_service_event(ServiceEvent::WatchedChannels(
        WatchedChannelsEvent::MessageBuffered {
            channel_id: watched_id.clone(),
            message: Box::new(NormalizedChatMessage {
                id: "watched-msg-1".into(),
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
                text: "hello KEKW".into(),
                emotes: vec![],
                timestamp: "1700000000".into(),
                message_type: ChatMessageType::Message,
                reply: None,
            }),
        },
    ));

    let live_emotes = state
        .watched_channel_messages
        .get(&watched_id)
        .and_then(|messages| messages.first())
        .map(|message| message.emotes.len())
        .unwrap_or(0);

    let reloaded = AppState::from_storage(&storage);
    let persisted_count = reloaded
        .watched_channel_messages
        .get(&watched_id)
        .map(|messages| messages.len())
        .unwrap_or(0);

    println!(
        "live_watched_emotes={} reloaded_watched_history_count={}",
        live_emotes, persisted_count,
    );
}
