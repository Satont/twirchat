use crate::chat::normalize::compare_message_keys;
use crate::protocol::NormalizedChatMessage;
use std::cmp::Ordering;
use std::collections::HashSet;

pub fn compare_messages(left: &NormalizedChatMessage, right: &NormalizedChatMessage) -> Ordering {
    compare_message_keys(left, right)
}

pub fn sort_messages(messages: &mut [NormalizedChatMessage]) {
    messages.sort_by(compare_messages);
}

pub fn merge_older_page(
    older_messages: impl IntoIterator<Item = NormalizedChatMessage>,
    existing_messages: impl IntoIterator<Item = NormalizedChatMessage>,
) -> Vec<NormalizedChatMessage> {
    let existing: Vec<NormalizedChatMessage> = existing_messages.into_iter().collect();
    let mut seen: HashSet<String> = existing.iter().map(|message| message.id.clone()).collect();
    let mut merged = Vec::new();

    for message in older_messages {
        if seen.insert(message.id.clone()) {
            merged.push(message);
        }
    }

    merged.extend(existing);
    merged
}

pub fn insert_live_message(
    existing_messages: &[NormalizedChatMessage],
    incoming_message: NormalizedChatMessage,
) -> Vec<NormalizedChatMessage> {
    if existing_messages
        .iter()
        .any(|message| message.id == incoming_message.id)
    {
        return existing_messages.to_vec();
    }

    let mut next_messages = existing_messages.to_vec();
    let insert_index = next_messages
        .iter()
        .position(|entry| compare_messages(&incoming_message, entry).is_lt());

    if let Some(index) = insert_index {
        next_messages.insert(index, incoming_message);
    } else {
        next_messages.push(incoming_message);
    }

    next_messages
}
