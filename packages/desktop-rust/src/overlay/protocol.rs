use crate::protocol::{Emote, NormalizedChatMessage, NormalizedEvent};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePart {
    #[serde(rename = "type")]
    pub part_type: MessagePartType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emote: Option<Emote>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessagePartType {
    Text,
    Emote,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayChatMessage {
    pub message: NormalizedChatMessage,
    pub parts: Vec<MessagePart>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum OverlayMessage {
    ChatMessage { data: Box<OverlayChatMessage> },
    ChatEvent { data: Box<NormalizedEvent> },
    Clear,
}

impl OverlayMessage {
    pub fn from_chat_message(message: NormalizedChatMessage) -> Self {
        let parts = build_message_parts(&message);
        Self::ChatMessage {
            data: Box::new(OverlayChatMessage { message, parts }),
        }
    }
}

pub fn build_message_parts(message: &NormalizedChatMessage) -> Vec<MessagePart> {
    if message.emotes.is_empty() {
        return vec![MessagePart {
            part_type: MessagePartType::Text,
            content: Some(message.text.clone()),
            emote: None,
        }];
    }

    let mut ranges = Vec::new();
    for emote in &message.emotes {
        for position in &emote.positions {
            ranges.push((position.start, position.end, emote));
        }
    }
    ranges.sort_by_key(|(start, _, _)| *start);

    let mut parts = Vec::new();
    let mut index = 0_usize;
    for (start, end, emote) in ranges {
        let start = usize::try_from(start).unwrap_or(usize::MAX);
        let end = usize::try_from(end).unwrap_or(usize::MAX);
        if index < start
            && let Some(content) = message.text.get(index..start)
        {
            parts.push(MessagePart {
                part_type: MessagePartType::Text,
                content: Some(content.to_string()),
                emote: None,
            });
        }

        parts.push(MessagePart {
            part_type: MessagePartType::Emote,
            content: None,
            emote: Some(emote.clone()),
        });
        index = end.saturating_add(1);
    }

    if index < message.text.len()
        && let Some(content) = message.text.get(index..)
    {
        parts.push(MessagePart {
            part_type: MessagePartType::Text,
            content: Some(content.to_string()),
            emote: None,
        });
    }

    parts
}
