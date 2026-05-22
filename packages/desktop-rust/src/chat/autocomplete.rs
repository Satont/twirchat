use crate::chat::AliasBook;
use crate::protocol::types::{NormalizedChatMessage, Platform};
use std::collections::BTreeSet;
use std::ops::Range;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedMentionToken {
    pub query: String,
    pub range: Range<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MentionSuggestion {
    pub label: String,
    pub insert_label: String,
    pub color: Option<String>,
    pub description: Option<String>,
    pub platform: Platform,
    pub platform_user_id: String,
    pub display_name: String,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
    pub current_alias: Option<String>,
}

pub fn parse_mention_token(text: &str) -> Option<ParsedMentionToken> {
    if text.chars().next_back().is_some_and(char::is_whitespace) {
        return None;
    }

    let start = text
        .char_indices()
        .rev()
        .find_map(|(index, ch)| ch.is_whitespace().then_some(index + ch.len_utf8()))
        .unwrap_or(0);
    let word = text.get(start..)?;
    if !word.starts_with('@') || word.chars().count() < 2 {
        return None;
    }

    Some(ParsedMentionToken {
        query: word[1..].to_string(),
        range: start..text.len(),
    })
}

pub fn mention_suggestions<'a>(
    messages: impl IntoIterator<Item = &'a NormalizedChatMessage>,
    aliases: &AliasBook,
) -> Vec<MentionSuggestion> {
    let mut seen = BTreeSet::new();
    let mut suggestions = Vec::new();

    for message in messages {
        let display_name = message.author.display_name.clone();
        let lower_display_name = display_name.to_lowercase();
        let dedupe_key = if message.author.id.is_empty() {
            format!("{:?}:{lower_display_name}", message.platform)
        } else {
            format!("{:?}:{}", message.platform, message.author.id)
        };

        if !seen.insert(dedupe_key) {
            continue;
        }

        let current_alias = if message.author.id.is_empty() {
            None
        } else {
            aliases
                .get(message.platform, &message.author.id)
                .map(str::to_string)
        };
        let label = current_alias
            .clone()
            .unwrap_or_else(|| display_name.clone());
        let description = message
            .author
            .username
            .as_ref()
            .map(|username| format!("@{} - {}", username, platform_label(message.platform)))
            .or_else(|| Some(platform_label(message.platform).to_string()));

        suggestions.push(MentionSuggestion {
            label,
            insert_label: display_name.clone(),
            color: message.author.color.clone(),
            description,
            platform: message.platform,
            platform_user_id: message.author.id.clone(),
            display_name,
            username: message.author.username.clone(),
            avatar_url: message.author.avatar_url.clone(),
            current_alias,
        });
    }

    suggestions
}

pub fn fuzzy_filter_mentions(
    suggestions: &[MentionSuggestion],
    query: &str,
    limit: usize,
) -> Vec<MentionSuggestion> {
    if query.is_empty() || limit == 0 {
        return Vec::new();
    }

    let query = query.to_lowercase();
    let Some(first_char) = query.chars().next() else {
        return Vec::new();
    };

    let mut matches = suggestions
        .iter()
        .filter_map(|suggestion| {
            let label = suggestion.label.to_lowercase();
            let mut query_chars = query.chars();
            let mut current = query_chars.next()?;

            for ch in label.chars() {
                if ch == current {
                    match query_chars.next() {
                        Some(next) => current = next,
                        None => {
                            let rank = label.find(first_char).unwrap_or(usize::MAX);
                            return Some((rank, suggestion.clone()));
                        }
                    }
                }
            }

            None
        })
        .collect::<Vec<_>>();

    matches.sort_by_key(|(rank, _)| *rank);
    matches
        .into_iter()
        .map(|(_, suggestion)| suggestion)
        .take(limit)
        .collect()
}

pub fn replace_mention_token(
    text: &str,
    token: &ParsedMentionToken,
    suggestion: &MentionSuggestion,
) -> String {
    if token.range.start > token.range.end
        || token.range.end > text.len()
        || !text.is_char_boundary(token.range.start)
        || !text.is_char_boundary(token.range.end)
    {
        return text.to_string();
    }

    let before = &text[..token.range.start];
    format!("{}@{} ", before, suggestion.insert_label)
}

fn platform_label(platform: Platform) -> &'static str {
    match platform {
        Platform::Twitch => "twitch",
        Platform::Youtube => "youtube",
        Platform::Kick => "kick",
    }
}
