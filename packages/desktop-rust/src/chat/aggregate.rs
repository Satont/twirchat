use crate::protocol::{Emote, EmotePosition, NormalizedChatMessage, NormalizedEvent, Platform};
use std::collections::{BTreeMap, HashSet, VecDeque};

const DEFAULT_BUFFER_SIZE: usize = 500;

#[derive(Debug, Clone, PartialEq)]
pub enum ChatReplayItem {
    Message(NormalizedChatMessage),
    Event(NormalizedEvent),
}

#[derive(Debug, Clone, PartialEq)]
pub enum IngestOutcome {
    Message(NormalizedChatMessage),
    Event(NormalizedEvent),
    DuplicateMessage { id: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct SevenTvEmote {
    pub id: String,
    pub name: String,
    pub image_url: String,
    pub animated: bool,
    pub zero_width: bool,
    pub aspect_ratio: f64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SevenTvCatalog {
    emotes: BTreeMap<SevenTvKey, SevenTvEmote>,
}

impl SevenTvCatalog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(
        &mut self,
        platform: Platform,
        channel_id: impl Into<String>,
        emote: SevenTvEmote,
    ) {
        self.emotes.insert(
            SevenTvKey {
                platform,
                channel_id: channel_id.into(),
                name: emote.name.clone(),
            },
            emote,
        );
    }

    pub fn get(&self, platform: Platform, channel_id: &str, name: &str) -> Option<&SevenTvEmote> {
        self.emotes.get(&SevenTvKey {
            platform,
            channel_id: channel_id.to_owned(),
            name: name.to_owned(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct SevenTvKey {
    platform: Platform,
    channel_id: String,
    name: String,
}

#[derive(Debug, Clone)]
pub struct ChatAggregator {
    buffer_size: usize,
    message_buffer: VecDeque<NormalizedChatMessage>,
    seen_ids: HashSet<String>,
    seven_tv: SevenTvCatalog,
    events: Vec<NormalizedEvent>,
}

impl Default for ChatAggregator {
    fn default() -> Self {
        Self::new(DEFAULT_BUFFER_SIZE)
    }
}

impl ChatAggregator {
    pub fn new(buffer_size: usize) -> Self {
        Self::with_seven_tv(buffer_size, SevenTvCatalog::new())
    }

    pub fn with_seven_tv(buffer_size: usize, seven_tv: SevenTvCatalog) -> Self {
        Self {
            buffer_size,
            message_buffer: VecDeque::new(),
            seen_ids: HashSet::new(),
            seven_tv,
            events: Vec::new(),
        }
    }

    pub fn seven_tv_mut(&mut self) -> &mut SevenTvCatalog {
        &mut self.seven_tv
    }

    pub fn inject_message(
        &mut self,
        message: NormalizedChatMessage,
    ) -> Option<NormalizedChatMessage> {
        if self.seen_ids.contains(&message.id) {
            return None;
        }

        self.seen_ids.insert(message.id.clone());
        let enriched_message = merge_seven_tv_emotes(message, &self.seven_tv);
        self.message_buffer.push_back(enriched_message.clone());

        if self.message_buffer.len() > self.buffer_size
            && let Some(removed) = self.message_buffer.pop_front()
        {
            self.seen_ids.remove(&removed.id);
        }

        Some(enriched_message)
    }

    pub fn inject_event(&mut self, event: NormalizedEvent) -> NormalizedEvent {
        self.events.push(event.clone());
        event
    }

    pub fn ingest(&mut self, item: ChatReplayItem) -> IngestOutcome {
        match item {
            ChatReplayItem::Message(message) => {
                let id = message.id.clone();
                self.inject_message(message).map_or(
                    IngestOutcome::DuplicateMessage { id },
                    IngestOutcome::Message,
                )
            }
            ChatReplayItem::Event(event) => IngestOutcome::Event(self.inject_event(event)),
        }
    }

    pub fn replay(
        &mut self,
        items: impl IntoIterator<Item = ChatReplayItem>,
    ) -> Vec<IngestOutcome> {
        items.into_iter().map(|item| self.ingest(item)).collect()
    }

    pub fn get_recent_messages(&self) -> Vec<NormalizedChatMessage> {
        self.message_buffer.iter().cloned().collect()
    }

    pub fn events(&self) -> &[NormalizedEvent] {
        &self.events
    }

    pub fn seen_message_count(&self) -> usize {
        self.seen_ids.len()
    }
}

pub fn merge_seven_tv_emotes(
    mut message: NormalizedChatMessage,
    catalog: &SevenTvCatalog,
) -> NormalizedChatMessage {
    let seven_tv_emotes = parse_seven_tv_emotes(
        &message.text,
        message.platform,
        &message.channel_id,
        catalog,
    );
    let mut existing_ids: HashSet<String> = message
        .emotes
        .iter()
        .map(|emote| emote.id.clone())
        .collect();

    for emote in seven_tv_emotes {
        if existing_ids.insert(emote.id.clone()) {
            message.emotes.push(emote);
        }
    }

    message
}

fn parse_seven_tv_emotes(
    text: &str,
    platform: Platform,
    channel_id: &str,
    catalog: &SevenTvCatalog,
) -> Vec<Emote> {
    let mut merged: Vec<Emote> = Vec::new();

    for (token, start, end) in token_ranges(text) {
        let Some(seven_tv_emote) = catalog.get(platform, channel_id, token) else {
            continue;
        };

        if let Some(existing) = merged
            .iter_mut()
            .find(|emote| emote.id == seven_tv_emote.id)
        {
            existing.positions.push(EmotePosition { start, end });
        } else {
            merged.push(Emote {
                id: seven_tv_emote.id.clone(),
                name: seven_tv_emote.name.clone(),
                image_url: seven_tv_emote.image_url.clone(),
                positions: vec![EmotePosition { start, end }],
                aspect_ratio: Some(seven_tv_emote.aspect_ratio),
            });
        }
    }

    merged
}

fn token_ranges(text: &str) -> Vec<(&str, u32, u32)> {
    let mut ranges = Vec::new();
    let mut token_start: Option<usize> = None;

    for (index, character) in text.char_indices() {
        if character.is_whitespace() {
            if let Some(start) = token_start.take() {
                push_token_range(text, start, index, &mut ranges);
            }
        } else if token_start.is_none() {
            token_start = Some(index);
        }
    }

    if let Some(start) = token_start {
        push_token_range(text, start, text.len(), &mut ranges);
    }

    ranges
}

fn push_token_range<'a>(
    text: &'a str,
    start: usize,
    exclusive_end: usize,
    ranges: &mut Vec<(&'a str, u32, u32)>,
) {
    let Some(token) = text.get(start..exclusive_end) else {
        return;
    };
    let Ok(start) = u32::try_from(start) else {
        return;
    };
    let Some(inclusive_end) = exclusive_end.checked_sub(1) else {
        return;
    };
    let Ok(end) = u32::try_from(inclusive_end) else {
        return;
    };
    ranges.push((token, start, end));
}
