use crate::error::AppError;
use crate::store::{db, messages};
use crate::types::{
    Emote, EmotePosition, NormalizedChatMessage, NormalizedEvent, Platform, PlatformStatusInfo,
    SevenTVEmote,
};
use rusqlite::Connection;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::time::{Duration, Instant};

const DEFAULT_BUFFER_SIZE: usize = 500;
const DEDUP_TTL: Duration = Duration::from_secs(5);

type MessageHandler = Box<dyn Fn(NormalizedChatMessage) + Send + Sync>;
type EventHandler = Box<dyn Fn(NormalizedEvent) + Send + Sync>;
type StatusHandler = Box<dyn Fn(PlatformStatusInfo) + Send + Sync>;

#[derive(Debug, Clone)]
pub enum SevenTVEvent {
    EmoteSet {
        platform: Platform,
        channel_id: String,
        emotes: Vec<SevenTVEmote>,
    },
    EmoteAdded {
        platform: Platform,
        channel_id: String,
        emote: SevenTVEmote,
    },
    EmoteRemoved {
        platform: Platform,
        channel_id: String,
        emote_id: String,
    },
    EmoteUpdated {
        platform: Platform,
        channel_id: String,
        emote: SevenTVEmote,
    },
}

struct HandlerEntry<T> {
    id: usize,
    callback: T,
}

#[allow(clippy::module_name_repetitions)]
pub struct ChatAggregator {
    message_buffer: VecDeque<NormalizedChatMessage>,
    buffer_size: usize,
    seen_ids: HashMap<String, Instant>,
    message_handlers: Vec<HandlerEntry<MessageHandler>>,
    event_handlers: Vec<HandlerEntry<EventHandler>>,
    status_handlers: Vec<HandlerEntry<StatusHandler>>,
    next_handler_id: usize,
    emote_cache: HashMap<(String, String), Vec<SevenTVEmote>>,
    conn: Connection,
}

impl ChatAggregator {
    #[must_use]
    #[allow(clippy::missing_panics_doc)]
    pub fn new(buffer_size: usize) -> Self {
        Self::try_new(buffer_size).unwrap_or_else(|error| {
            let conn = Connection::open_in_memory().unwrap_or_else(|fallback_error| {
                panic!(
                    "failed to open sqlite connection: {fallback_error}; original error: {error}"
                )
            });
            db::init_db(&conn).unwrap_or_else(|init_error| {
                panic!("failed to initialize sqlite schema: {init_error}; original error: {error}")
            });
            Self::with_connection(buffer_size, conn)
        })
    }

    /// # Errors
    ///
    /// Returns an error when the backing `SQLite` database cannot be opened or initialized.
    pub fn try_new(buffer_size: usize) -> Result<Self, AppError> {
        let conn = open_default_connection()?;
        Ok(Self::with_connection(buffer_size, conn))
    }

    #[must_use]
    pub fn with_connection(buffer_size: usize, conn: Connection) -> Self {
        Self {
            message_buffer: VecDeque::with_capacity(normalize_buffer_size(buffer_size)),
            buffer_size: normalize_buffer_size(buffer_size),
            seen_ids: HashMap::new(),
            message_handlers: Vec::new(),
            event_handlers: Vec::new(),
            status_handlers: Vec::new(),
            next_handler_id: 0,
            emote_cache: HashMap::new(),
            conn,
        }
    }

    #[must_use]
    pub fn process_message(&mut self, msg: NormalizedChatMessage) -> Option<NormalizedChatMessage> {
        self.process_message_at(msg, Instant::now())
    }

    #[must_use]
    pub fn get_recent(&self, limit: usize) -> Vec<NormalizedChatMessage> {
        if limit == 0 {
            return Vec::new();
        }

        let skip = self.message_buffer.len().saturating_sub(limit);
        self.message_buffer.iter().skip(skip).cloned().collect()
    }

    pub fn inject_message(&mut self, msg: NormalizedChatMessage) {
        let _ = self.process_message(msg);
    }

    pub fn on_message<F>(&mut self, handler: F) -> impl FnOnce(&mut Self) + Send + 'static
    where
        F: Fn(NormalizedChatMessage) + Send + Sync + 'static,
    {
        let id = self.next_handler_id();
        self.message_handlers.push(HandlerEntry {
            id,
            callback: Box::new(handler),
        });

        move |aggregator: &mut Self| {
            aggregator.message_handlers.retain(|entry| entry.id != id);
        }
    }

    pub fn on_event<F>(&mut self, handler: F) -> impl FnOnce(&mut Self) + Send + 'static
    where
        F: Fn(NormalizedEvent) + Send + Sync + 'static,
    {
        let id = self.next_handler_id();
        self.event_handlers.push(HandlerEntry {
            id,
            callback: Box::new(handler),
        });

        move |aggregator: &mut Self| {
            aggregator.event_handlers.retain(|entry| entry.id != id);
        }
    }

    pub fn on_status<F>(&mut self, handler: F) -> impl FnOnce(&mut Self) + Send + 'static
    where
        F: Fn(PlatformStatusInfo) + Send + Sync + 'static,
    {
        let id = self.next_handler_id();
        self.status_handlers.push(HandlerEntry {
            id,
            callback: Box::new(handler),
        });

        move |aggregator: &mut Self| {
            aggregator.status_handlers.retain(|entry| entry.id != id);
        }
    }

    pub fn inject_event(&self, event: &NormalizedEvent) {
        for handler in &self.event_handlers {
            (handler.callback)(event.clone());
        }
    }

    pub fn inject_status(&self, status: &PlatformStatusInfo) {
        for handler in &self.status_handlers {
            (handler.callback)(status.clone());
        }
    }

    pub fn process_7tv_event(&mut self, event: SevenTVEvent) {
        match event {
            SevenTVEvent::EmoteSet {
                platform,
                channel_id,
                emotes,
            } => {
                self.emote_cache
                    .insert(cache_key(platform, &channel_id), emotes);
            }
            SevenTVEvent::EmoteRemoved {
                platform,
                channel_id,
                emote_id,
            } => {
                if let Some(cache) = self.emote_cache.get_mut(&cache_key(platform, &channel_id)) {
                    cache.retain(|emote| emote.id != emote_id);
                }
            }
            SevenTVEvent::EmoteAdded {
                platform,
                channel_id,
                emote,
            }
            | SevenTVEvent::EmoteUpdated {
                platform,
                channel_id,
                emote,
            } => {
                let cache = self
                    .emote_cache
                    .entry(cache_key(platform, &channel_id))
                    .or_default();
                upsert_emote(cache, emote);
            }
        }
    }

    fn process_message_at(
        &mut self,
        msg: NormalizedChatMessage,
        now: Instant,
    ) -> Option<NormalizedChatMessage> {
        self.prune_expired_seen_ids(now);

        if self
            .seen_ids
            .get(&msg.id)
            .is_some_and(|seen_at| now.duration_since(*seen_at) <= DEDUP_TTL)
        {
            return None;
        }

        self.seen_ids.insert(msg.id.clone(), now);

        let enriched_msg = self.enrich_message(msg);
        self.message_buffer.push_back(enriched_msg.clone());

        while self.message_buffer.len() > self.buffer_size {
            if let Some(removed) = self.message_buffer.pop_front() {
                self.seen_ids.remove(&removed.id);
            }
        }

        if let Err(error) = messages::save_message(&self.conn, &enriched_msg) {
            eprintln!(
                "[ChatAggregator] failed to save message {}: {error}",
                enriched_msg.id
            );
        }

        for handler in &self.message_handlers {
            (handler.callback)(enriched_msg.clone());
        }

        Some(enriched_msg)
    }

    fn enrich_message(&self, msg: NormalizedChatMessage) -> NormalizedChatMessage {
        let parsed_emotes = self.parse_7tv_emotes(&msg.text, msg.platform, &msg.channel_id);
        if parsed_emotes.is_empty() {
            return msg;
        }

        let existing_ids: HashSet<String> =
            msg.emotes.iter().map(|emote| emote.id.clone()).collect();
        let mut merged_emotes = msg.emotes.clone();

        for emote in parsed_emotes {
            if !existing_ids.contains(&emote.id) {
                merged_emotes.push(emote);
            }
        }

        NormalizedChatMessage {
            emotes: merged_emotes,
            ..msg
        }
    }

    fn parse_7tv_emotes(
        &self,
        message_text: &str,
        platform: Platform,
        channel_id: &str,
    ) -> Vec<Emote> {
        let Some(emotes) = self.emote_cache.get(&cache_key(platform, channel_id)) else {
            return Vec::new();
        };

        let mut merged: Vec<Emote> = Vec::new();
        let mut index_by_id = HashMap::<String, usize>::new();

        for token in tokenize_message(message_text) {
            if token.is_whitespace {
                continue;
            }

            let Some(emote) = emotes.iter().find(|emote| emote.alias == token.token) else {
                continue;
            };

            let position = EmotePosition {
                start: token.start,
                end: token.end,
            };

            if let Some(index) = index_by_id.get(&emote.id) {
                merged[*index].positions.push(position);
                continue;
            }

            let index = merged.len();
            index_by_id.insert(emote.id.clone(), index);
            merged.push(Emote {
                id: emote.id.clone(),
                name: emote.name.clone(),
                image_url: emote.image_url.clone(),
                positions: vec![position],
                aspect_ratio: Some(emote.aspect_ratio),
            });
        }

        merged
    }

    fn prune_expired_seen_ids(&mut self, now: Instant) {
        self.seen_ids
            .retain(|_, seen_at| now.duration_since(*seen_at) <= DEDUP_TTL);
    }

    #[allow(clippy::missing_const_for_fn)]
    fn next_handler_id(&mut self) -> usize {
        let id = self.next_handler_id;
        self.next_handler_id = self.next_handler_id.wrapping_add(1);
        id
    }
}

const fn normalize_buffer_size(buffer_size: usize) -> usize {
    if buffer_size == 0 {
        DEFAULT_BUFFER_SIZE
    } else {
        buffer_size
    }
}

fn upsert_emote(cache: &mut Vec<SevenTVEmote>, emote: SevenTVEmote) {
    if let Some(existing) = cache.iter_mut().find(|existing| existing.id == emote.id) {
        *existing = emote;
        return;
    }

    cache.push(emote);
}

fn cache_key(platform: Platform, channel_id: &str) -> (String, String) {
    (platform_key(platform).to_owned(), channel_id.to_owned())
}

const fn platform_key(platform: Platform) -> &'static str {
    match platform {
        Platform::Twitch => "twitch",
        Platform::YouTube => "youtube",
        Platform::Kick => "kick",
    }
}

fn default_db_path() -> PathBuf {
    if let Some(explicit_path) = std::env::var_os("TWIRCHAT_DATA_DB_PATH") {
        return PathBuf::from(explicit_path);
    }

    std::env::var_os("HOME")
        .map_or_else(|| PathBuf::from("."), PathBuf::from)
        .join(".local")
        .join("share")
        .join("twirchat")
        .join("data.db")
}

fn open_default_connection() -> Result<Connection, AppError> {
    let path = default_db_path();
    let conn = db::open_db(&path)?;
    db::init_db(&conn)?;
    Ok(conn)
}

struct MessageToken<'a> {
    token: &'a str,
    start: usize,
    end: usize,
    is_whitespace: bool,
}

fn tokenize_message(message_text: &str) -> Vec<MessageToken<'_>> {
    let mut tokens = Vec::new();
    let mut start = None;
    let mut is_whitespace = false;

    for (index, ch) in message_text.char_indices() {
        let char_is_whitespace = ch.is_whitespace();

        match start {
            None => {
                start = Some(index);
                is_whitespace = char_is_whitespace;
            }
            Some(token_start) if is_whitespace != char_is_whitespace => {
                tokens.push(MessageToken {
                    token: &message_text[token_start..index],
                    start: token_start,
                    end: index,
                    is_whitespace,
                });
                start = Some(index);
                is_whitespace = char_is_whitespace;
            }
            Some(_) => {}
        }
    }

    if let Some(token_start) = start {
        tokens.push(MessageToken {
            token: &message_text[token_start..],
            start: token_start,
            end: message_text.len(),
            is_whitespace,
        });
    }

    tokens
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{
        Badge, ConnectionMode, MessageType, NormalizedChatMessageAuthor, NormalizedEventType,
        NormalizedEventUser, PlatformStatus,
    };
    use std::sync::{Arc, Mutex};

    fn make_aggregator(buffer_size: usize) -> ChatAggregator {
        let conn = Connection::open_in_memory().expect("in-memory db");
        db::init_db(&conn).expect("init db");
        ChatAggregator::with_connection(buffer_size, conn)
    }

    fn make_message(id: &str) -> NormalizedChatMessage {
        NormalizedChatMessage {
            id: id.to_owned(),
            platform: Platform::Kick,
            channel_id: "test-channel".to_owned(),
            author: NormalizedChatMessageAuthor {
                id: "user1".to_owned(),
                username: Some("user1".to_owned()),
                display_name: "User".to_owned(),
                color: None,
                avatar_url: None,
                badges: vec![Badge {
                    id: "badge-1".to_owned(),
                    badge_type: "mod".to_owned(),
                    text: "Mod".to_owned(),
                    image_url: None,
                }],
            },
            text: format!("Message {id}"),
            emotes: Vec::new(),
            timestamp: "2026-04-14T12:00:00Z".to_owned(),
            message_type: MessageType::Message,
            reply: None,
        }
    }

    fn make_event() -> NormalizedEvent {
        NormalizedEvent {
            id: "ev1".to_owned(),
            platform: Platform::Kick,
            event_type: NormalizedEventType::Follow,
            user: NormalizedEventUser {
                id: "u1".to_owned(),
                display_name: "Follower".to_owned(),
                avatar_url: None,
            },
            data: serde_json::Map::new(),
            timestamp: "2026-04-14T12:00:00Z".to_owned(),
        }
    }

    fn make_status() -> PlatformStatusInfo {
        PlatformStatusInfo {
            platform: Platform::Kick,
            status: PlatformStatus::Connected,
            error: None,
            mode: ConnectionMode::Anonymous,
            channel_login: Some("test-channel".to_owned()),
        }
    }

    fn make_7tv_emote(id: &str, alias: &str) -> SevenTVEmote {
        SevenTVEmote {
            id: id.to_owned(),
            alias: alias.to_owned(),
            name: alias.to_owned(),
            animated: false,
            zero_width: false,
            aspect_ratio: 1.0,
            image_url: format!("https://example.com/{id}.webp"),
        }
    }

    #[test]
    fn collects_messages() {
        let mut aggregator = make_aggregator(0);
        let received = Arc::new(Mutex::new(Vec::new()));
        let received_clone = Arc::clone(&received);

        let _unsubscribe = aggregator.on_message(move |msg| {
            received_clone.lock().expect("lock").push(msg);
        });

        let _ = aggregator.process_message(make_message("1"));
        let _ = aggregator.process_message(make_message("2"));

        let received = received.lock().expect("lock");
        assert_eq!(received.len(), 2);
        assert_eq!(received[0].id, "1");
    }

    #[test]
    fn deduplicates_messages_with_same_id() {
        let mut aggregator = make_aggregator(0);
        let msg = make_message("dup-1");

        assert!(aggregator.process_message(msg.clone()).is_some());
        assert!(aggregator.process_message(msg).is_none());
        assert_eq!(aggregator.get_recent(10).len(), 1);
    }

    #[test]
    fn dedup_expires_after_five_seconds() {
        let mut aggregator = make_aggregator(0);
        let start = Instant::now();
        let msg = make_message("ttl-1");

        assert!(aggregator.process_message_at(msg.clone(), start).is_some());
        assert!(
            aggregator
                .process_message_at(msg.clone(), start + Duration::from_secs(4))
                .is_none()
        );
        assert!(
            aggregator
                .process_message_at(msg, start + Duration::from_secs(6))
                .is_some()
        );
    }

    #[test]
    fn ring_buffer_limits_size() {
        let mut aggregator = make_aggregator(5);

        for index in 0..10 {
            let _ = aggregator.process_message(make_message(&format!("msg-{index}")));
        }

        let recent = aggregator.get_recent(10);
        assert_eq!(recent.len(), 5);
        assert_eq!(recent[4].id, "msg-9");
    }

    #[test]
    fn on_message_unsubscribe_works() {
        let mut aggregator = make_aggregator(0);
        let received = Arc::new(Mutex::new(Vec::new()));
        let received_clone = Arc::clone(&received);

        let unsubscribe = aggregator.on_message(move |msg| {
            received_clone.lock().expect("lock").push(msg.id);
        });

        let _ = aggregator.process_message(make_message("a"));
        unsubscribe(&mut aggregator);
        let _ = aggregator.process_message(make_message("b"));

        assert_eq!(*received.lock().expect("lock"), vec!["a".to_owned()]);
    }

    #[test]
    fn emits_events() {
        let aggregator = make_aggregator(0);
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_clone = Arc::clone(&events);
        let mut aggregator = aggregator;

        let _unsubscribe = aggregator.on_event(move |event| {
            events_clone.lock().expect("lock").push(event);
        });

        aggregator.inject_event(&make_event());

        let events = events.lock().expect("lock");
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0].event_type, NormalizedEventType::Follow));
    }

    #[test]
    fn emits_status_updates() {
        let mut aggregator = make_aggregator(0);
        let statuses = Arc::new(Mutex::new(Vec::new()));
        let statuses_clone = Arc::clone(&statuses);

        let _unsubscribe = aggregator.on_status(move |status| {
            statuses_clone.lock().expect("lock").push(status);
        });

        aggregator.inject_status(&make_status());

        let statuses = statuses.lock().expect("lock");
        assert_eq!(statuses.len(), 1);
        assert!(matches!(statuses[0].status, PlatformStatus::Connected));
    }

    #[test]
    fn stores_processed_messages_in_sqlite() {
        let mut aggregator = make_aggregator(0);
        let _ = aggregator.process_message(make_message("persisted"));

        let stored = messages::get_recent(&aggregator.conn, "test-channel", 10).expect("stored");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].id, "persisted");
    }

    #[test]
    fn updates_7tv_cache_and_enriches_messages() {
        let mut aggregator = make_aggregator(0);
        aggregator.process_7tv_event(SevenTVEvent::EmoteSet {
            platform: Platform::Kick,
            channel_id: "test-channel".to_owned(),
            emotes: vec![make_7tv_emote("7tv-1", "OMEGALUL")],
        });

        let mut msg = make_message("with-7tv");
        msg.text = "hello OMEGALUL OMEGALUL".to_owned();

        let enriched = aggregator
            .process_message(msg)
            .expect("message should be processed");

        assert_eq!(enriched.emotes.len(), 1);
        assert_eq!(enriched.emotes[0].id, "7tv-1");
        assert_eq!(enriched.emotes[0].positions.len(), 2);
    }
}
