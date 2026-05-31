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
    let older_messages = older_messages.into_iter();
    let older_lower_bound = older_messages.size_hint().0;
    let existing: Vec<NormalizedChatMessage> = existing_messages.into_iter().collect();
    let existing_ids: HashSet<&str> = existing.iter().map(|message| message.id.as_str()).collect();
    let mut older_ids = HashSet::with_capacity(older_lower_bound);
    let mut merged = Vec::with_capacity(existing.len().saturating_add(older_lower_bound));

    for message in older_messages {
        if !existing_ids.contains(message.id.as_str()) && older_ids.insert(message.id.clone()) {
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
    let mut insert_index = None;

    for (index, message) in existing_messages.iter().enumerate() {
        if message.id == incoming_message.id {
            return existing_messages.to_vec();
        }

        if insert_index.is_none() && compare_messages(&incoming_message, message).is_lt() {
            insert_index = Some(index);
        }
    }

    let mut next_messages = Vec::with_capacity(existing_messages.len().saturating_add(1));
    if let Some(index) = insert_index {
        next_messages.extend(existing_messages.iter().take(index).cloned());
        next_messages.push(incoming_message);
        next_messages.extend(existing_messages.iter().skip(index).cloned());
    } else {
        next_messages.extend_from_slice(existing_messages);
        next_messages.push(incoming_message);
    }

    next_messages
}

pub fn insert_live_message_in_place(
    existing_messages: &mut Vec<NormalizedChatMessage>,
    incoming_message: NormalizedChatMessage,
) -> bool {
    let mut insert_index = None;

    for (index, message) in existing_messages.iter().enumerate() {
        if message.id == incoming_message.id {
            return false;
        }

        if insert_index.is_none() && compare_messages(&incoming_message, message).is_lt() {
            insert_index = Some(index);
        }
    }

    if let Some(index) = insert_index {
        existing_messages.insert(index, incoming_message);
    } else {
        existing_messages.push(incoming_message);
    }

    true
}
