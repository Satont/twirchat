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
pub struct ParsedEmoteToken {
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

#[derive(Debug, Clone, PartialEq)]
pub struct EmoteSuggestion {
    pub label: String,
    pub image_url: String,
    pub animated: bool,
}

pub fn parse_mention_token(text: &str) -> Option<ParsedMentionToken> {
    let (query, range) = parse_prefixed_token(text, '@')?;
    Some(ParsedMentionToken { query, range })
}

pub fn parse_emote_token(text: &str) -> Option<ParsedEmoteToken> {
    let (query, range) = parse_prefixed_token(text, ':')?;
    Some(ParsedEmoteToken { query, range })
}

fn parse_prefixed_token(text: &str, prefix: char) -> Option<(String, Range<usize>)> {
    if text.chars().next_back().is_some_and(char::is_whitespace) {
        return None;
    }

    let start = text
        .char_indices()
        .rev()
        .find_map(|(index, ch)| ch.is_whitespace().then_some(index + ch.len_utf8()))
        .unwrap_or(0);
    let word = text.get(start..)?;
    if !word.starts_with(prefix) {
        return None;
    }

    if prefix != ':' && word.chars().count() < 2 {
        return None;
    }

    Some((word[prefix.len_utf8()..].to_string(), start..text.len()))
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
    fuzzy_filter_by_targets(suggestions, query, limit, |suggestion| {
        vec![suggestion.label.as_str(), suggestion.display_name.as_str()]
            .into_iter()
            .chain(suggestion.username.as_deref())
            .collect()
    })
}

pub fn emote_suggestions<'a>(
    emotes: impl IntoIterator<Item = &'a crate::chat::SevenTvEmote>,
) -> Vec<EmoteSuggestion> {
    emotes
        .into_iter()
        .map(|emote| EmoteSuggestion {
            label: emote.name.clone(),
            image_url: emote.image_url.clone(),
            animated: emote.animated,
        })
        .collect()
}

pub fn fuzzy_filter_emotes(
    suggestions: &[EmoteSuggestion],
    query: &str,
    limit: usize,
) -> Vec<EmoteSuggestion> {
    fuzzy_filter_by_targets(suggestions, query, limit, |suggestion| {
        vec![suggestion.label.as_str()]
    })
}

fn fuzzy_filter_by_targets<T: Clone>(
    suggestions: &[T],
    query: &str,
    limit: usize,
    targets: impl Fn(&T) -> Vec<&str>,
) -> Vec<T> {
    if limit == 0 {
        return Vec::new();
    }

    if query.is_empty() {
        return suggestions.iter().take(limit).cloned().collect();
    }

    let query = query.to_lowercase();
    let Some(first_char) = query.chars().next() else {
        return Vec::new();
    };

    let mut matches = suggestions
        .iter()
        .filter_map(|suggestion| {
            let mut best_rank = None;

            for target in targets(suggestion) {
                let target_lower = target.to_lowercase();
                let mut query_chars = query.chars();
                let mut current = query_chars.next()?;

                let mut matched_all = false;
                for ch in target_lower.chars() {
                    if ch == current {
                        match query_chars.next() {
                            Some(next) => current = next,
                            None => {
                                matched_all = true;
                                break;
                            }
                        }
                    }
                }

                if matched_all {
                    let rank = target_lower.find(first_char).unwrap_or(usize::MAX);
                    best_rank = Some(best_rank.map_or(rank, |r| std::cmp::min(r, rank)));
                }
            }

            best_rank.map(|rank| (rank, suggestion.clone()))
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
    replace_range(
        text,
        token.range.clone(),
        &format!("@{} ", suggestion.insert_label),
    )
}

pub fn replace_emote_token(
    text: &str,
    token: &ParsedEmoteToken,
    suggestion: &EmoteSuggestion,
) -> String {
    replace_range(text, token.range.clone(), &format!("{} ", suggestion.label))
}

fn replace_range(text: &str, range: Range<usize>, replacement: &str) -> String {
    if range.start > range.end
        || range.end > text.len()
        || !text.is_char_boundary(range.start)
        || !text.is_char_boundary(range.end)
    {
        return text.to_string();
    }

    let before = &text[..range.start];
    format!("{before}{replacement}")
}

fn platform_label(platform: Platform) -> &'static str {
    match platform {
        Platform::Twitch => "twitch",
        Platform::Youtube => "youtube",
        Platform::Kick => "kick",
    }
}
