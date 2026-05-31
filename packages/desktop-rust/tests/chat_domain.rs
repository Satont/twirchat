use serde::Deserialize;
use serde_json::json;
use std::fs;
use std::hint::black_box;
use std::path::PathBuf;
use std::time::Instant;
use twirchat_desktop_rust::chat::{
    AliasBook, ChatAggregator, ChatReplayItem, IngestOutcome, SevenTvCatalog, SevenTvEmote,
    emote_suggestions, fuzzy_filter_emotes, fuzzy_filter_mentions, insert_live_message,
    insert_live_message_in_place, mention_suggestions, merge_older_page, parse_emote_token,
    parse_mention_token, replace_emote_token, replace_mention_token, sort_messages,
};
use twirchat_desktop_rust::protocol::{
    Badge, ChatAuthor, ChatMessageType, Emote, EmotePosition, EventUser, NormalizedChatMessage,
    NormalizedEvent, NormalizedEventType, Platform, UserAlias,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplayFixture {
    seven_tv: Vec<SevenTvFixture>,
    aliases: Vec<UserAlias>,
    items: Vec<FixtureReplayItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SevenTvFixture {
    platform: Platform,
    channel_id: String,
    id: String,
    name: String,
    image_url: String,
    animated: bool,
    zero_width: bool,
    aspect_ratio: f64,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
enum FixtureReplayItem {
    Message(NormalizedChatMessage),
    Event(NormalizedEvent),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BurstFixture {
    count: usize,
    duplicate_every: usize,
    platform: Platform,
    channel_id: String,
    author_id: String,
}

#[test]
fn fixture_replay() -> Result<(), Box<dyn std::error::Error>> {
    let fixture: ReplayFixture = read_json_fixture("replay.json")?;
    let mut catalog = SevenTvCatalog::new();
    for entry in fixture.seven_tv {
        catalog.insert(
            entry.platform,
            entry.channel_id,
            SevenTvEmote {
                id: entry.id,
                name: entry.name,
                image_url: entry.image_url,
                animated: entry.animated,
                zero_width: entry.zero_width,
                aspect_ratio: entry.aspect_ratio,
            },
        );
    }

    let mut aggregator = ChatAggregator::with_seven_tv(500, catalog);
    let outcomes = aggregator.replay(fixture.items.into_iter().map(|item| match item {
        FixtureReplayItem::Message(message) => ChatReplayItem::Message(message),
        FixtureReplayItem::Event(event) => ChatReplayItem::Event(event),
    }));

    let recent = aggregator.get_recent_messages();
    assert_eq!(recent.len(), 3);
    assert_eq!(aggregator.events().len(), 1);
    assert!(outcomes.iter().any(
        |outcome| matches!(outcome, IngestOutcome::DuplicateMessage { id } if id == "tw-msg-1")
    ));

    let twitch = recent
        .iter()
        .find(|message| message.id == "tw-msg-1")
        .ok_or("twitch replay message missing")?;
    let seven_tv = twitch
        .emotes
        .iter()
        .find(|emote| emote.id == "7tv-kekw")
        .ok_or("7TV emote was not merged")?;
    assert_eq!(seven_tv.positions.len(), 2);

    let youtube = recent
        .iter()
        .find(|message| message.id == "yt-msg-1")
        .ok_or("youtube reply message missing")?;
    assert!(youtube.reply.is_some());

    let aliases = AliasBook::from_aliases(fixture.aliases);
    let aliased = aliases.apply(twitch);
    assert_eq!(aliased.message.author.display_name, "Friendly Alias");
    assert_eq!(aliased.original_display_name, "Twitch User");

    let mut reversed = recent.clone();
    reversed.reverse();
    sort_messages(&mut reversed);
    assert_eq!(
        reversed
            .iter()
            .map(|message| message.id.as_str())
            .collect::<Vec<_>>(),
        ["tw-msg-1", "yt-msg-1", "kick-msg-1"]
    );

    let merged_history =
        merge_older_page(vec![recent[0].clone(), recent[1].clone()], recent.clone());
    assert_eq!(merged_history.len(), recent.len());
    let inserted_history = insert_live_message(&recent[..2], recent[2].clone());
    assert_eq!(inserted_history.len(), 3);
    assert_eq!(inserted_history[2].id, "kick-msg-1");

    write_evidence(
        "task-10-fixture-replay.json",
        &json!({
            "acceptedMessages": recent.len(),
            "events": aggregator.events().len(),
            "duplicatesSkipped": outcomes.iter().filter(|outcome| matches!(outcome, IngestOutcome::DuplicateMessage { .. })).count(),
            "platforms": recent.iter().map(|message| message.platform).collect::<Vec<_>>(),
            "sevenTvMergedPositions": seven_tv.positions,
            "replyPreserved": youtube.reply.is_some(),
            "aliasApplied": aliased.message.author.display_name,
            "historyIds": inserted_history.iter().map(|message| message.id.as_str()).collect::<Vec<_>>()
        }),
    )?;

    Ok(())
}

#[test]
fn chat_burst_preserves_order_and_dedupe() -> Result<(), Box<dyn std::error::Error>> {
    let fixture: BurstFixture = read_json_fixture("burst.json")?;
    let mut aggregator = ChatAggregator::new(fixture.count + 20);

    for index in (0..fixture.count).rev() {
        let message = make_message(
            format!("burst-{index:04}"),
            fixture.platform,
            fixture.channel_id.clone(),
            fixture.author_id.clone(),
            format!("Burst User {index}"),
            1_710_000_100_000_i128 + i128::try_from(index)?,
        );
        let _ = aggregator.inject_message(message);

        if index % fixture.duplicate_every == 0 {
            let duplicate = make_message(
                format!("burst-{index:04}"),
                fixture.platform,
                fixture.channel_id.clone(),
                fixture.author_id.clone(),
                "Duplicate Burst User".to_string(),
                1_710_999_999_999,
            );
            let _ = aggregator.inject_message(duplicate);
        }
    }

    let recent = aggregator.get_recent_messages();
    assert_eq!(recent.len(), fixture.count);
    assert_eq!(
        recent.first().map(|message| message.id.as_str()),
        Some("burst-0249")
    );
    assert_eq!(
        recent.last().map(|message| message.id.as_str()),
        Some("burst-0000")
    );

    let mut sorted_history = Vec::new();
    for message in &recent {
        sorted_history = insert_live_message(&sorted_history, message.clone());
    }

    assert_eq!(sorted_history.len(), fixture.count);
    assert_eq!(
        sorted_history.first().map(|message| message.id.as_str()),
        Some("burst-0000")
    );
    assert_eq!(
        sorted_history.last().map(|message| message.id.as_str()),
        Some("burst-0249")
    );

    let duplicate_insert = insert_live_message(&sorted_history, sorted_history[0].clone());
    assert_eq!(duplicate_insert.len(), sorted_history.len());

    write_evidence(
        "task-10-chat-burst.json",
        &json!({
            "fixtureCount": fixture.count,
            "acceptedMessages": recent.len(),
            "dedupeSeenIds": aggregator.seen_message_count(),
            "replayOrderFirst": recent.first().map(|message| message.id.as_str()),
            "replayOrderLast": recent.last().map(|message| message.id.as_str()),
            "historyOrderFirst": sorted_history.first().map(|message| message.id.as_str()),
            "historyOrderLast": sorted_history.last().map(|message| message.id.as_str())
        }),
    )?;

    Ok(())
}

#[test]
fn chat_burst_performance() -> Result<(), Box<dyn std::error::Error>> {
    let fixture: BurstFixture = read_json_fixture("burst.json")?;
    let mut aggregator = ChatAggregator::new(fixture.count + 20);
    let duplicate_attempts = duplicate_attempts(&fixture);
    let total_attempts = fixture.count + duplicate_attempts;

    let ingest_start = Instant::now();
    for index in 0..fixture.count {
        let message = make_message(
            format!("burst-{index:04}"),
            fixture.platform,
            fixture.channel_id.clone(),
            fixture.author_id.clone(),
            format!("Burst User {index}"),
            1_710_000_100_000_i128 + i128::try_from(index)?,
        );
        let inserted = aggregator.inject_message_ref(black_box(message));
        assert!(inserted.is_some());

        if index % fixture.duplicate_every == 0 {
            let duplicate = make_message(
                format!("burst-{index:04}"),
                fixture.platform,
                fixture.channel_id.clone(),
                fixture.author_id.clone(),
                "Duplicate Burst User".to_string(),
                1_710_999_999_999,
            );
            let inserted = aggregator.inject_message_ref(black_box(duplicate));
            assert!(inserted.is_none());
        }
    }
    let ingest_elapsed = ingest_start.elapsed();

    let recent_ids = aggregator
        .recent_messages()
        .map(|message| message.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(recent_ids.len(), fixture.count);
    assert_eq!(aggregator.seen_message_count(), fixture.count);
    assert_eq!(recent_ids.first().copied(), Some("burst-0000"));
    assert_eq!(recent_ids.last().copied(), Some("burst-0249"));

    let recent = aggregator.get_recent_messages();
    let history_start = Instant::now();
    let mut sorted_history = Vec::with_capacity(recent.len());
    for message in recent.iter().rev() {
        assert!(insert_live_message_in_place(
            black_box(&mut sorted_history),
            black_box(message.clone())
        ));
    }
    let history_elapsed = history_start.elapsed();

    assert_eq!(sorted_history.len(), fixture.count);
    assert_eq!(
        sorted_history.first().map(|message| message.id.as_str()),
        Some("burst-0000")
    );
    assert_eq!(
        sorted_history.last().map(|message| message.id.as_str()),
        Some("burst-0249")
    );

    let duplicate_insert = insert_live_message(&sorted_history, sorted_history[0].clone());
    assert_eq!(duplicate_insert.len(), sorted_history.len());

    write_evidence(
        "task-24-chat-burst-performance.json",
        &json!({
            "fixture": "packages/desktop-rust/fixtures/chat/burst.json",
            "fixtureCount": fixture.count,
            "duplicateEvery": fixture.duplicate_every,
            "duplicateAttempts": duplicate_attempts,
            "totalIngestAttempts": total_attempts,
            "acceptedMessages": recent.len(),
            "dedupeSeenIds": aggregator.seen_message_count(),
            "historyInsertions": recent.len(),
            "deterministicAssertions": {
                "acceptedEqualsFixtureCount": recent.len() == fixture.count,
                "dedupeSeenIdsEqualsFixtureCount": aggregator.seen_message_count() == fixture.count,
                "duplicatesRejected": total_attempts - recent.len() == duplicate_attempts,
                "historyPreservesAscendingOrder": sorted_history.first().map(|message| message.id.as_str()) == Some("burst-0000")
                    && sorted_history.last().map(|message| message.id.as_str()) == Some("burst-0249")
            },
            "timings": {
                "ingestMicros": ingest_elapsed.as_micros(),
                "historyMicros": history_elapsed.as_micros(),
                "totalMicros": ingest_elapsed.saturating_add(history_elapsed).as_micros()
            }
        }),
    )?;

    println!(
        "chat_burst_performance accepted {} messages, rejected {duplicate_attempts} duplicates, ingest={}us, history={}us",
        recent.len(),
        ingest_elapsed.as_micros(),
        history_elapsed.as_micros()
    );

    Ok(())
}

#[test]
fn emote_autocomplete_fuzzy_filters_and_replaces_colon_token() {
    let emotes = [
        SevenTvEmote {
            id: "7tv-kappa".to_string(),
            name: "Kappa".to_string(),
            image_url: "https://cdn.7tv.app/emote/kappa/4x.webp".to_string(),
            animated: false,
            zero_width: false,
            aspect_ratio: 1.0,
        },
        SevenTvEmote {
            id: "7tv-kekw".to_string(),
            name: "KEKW".to_string(),
            image_url: "https://cdn.7tv.app/emote/kekw/4x.webp".to_string(),
            animated: true,
            zero_width: false,
            aspect_ratio: 1.0,
        },
        SevenTvEmote {
            id: "7tv-peepo".to_string(),
            name: "peepoHappy".to_string(),
            image_url: "https://cdn.7tv.app/emote/peepo/4x.webp".to_string(),
            animated: false,
            zero_width: false,
            aspect_ratio: 1.0,
        },
    ];

    let suggestions = emote_suggestions(emotes.iter());
    let unfiltered = fuzzy_filter_emotes(&suggestions, "", 15);
    assert_eq!(unfiltered.len(), 3);

    let bare_token = parse_emote_token("hello :").expect("bare emote token should parse");
    assert_eq!(bare_token.query, "");

    let filtered = fuzzy_filter_emotes(&suggestions, "kw", 15);

    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].label, "KEKW");
    assert!(filtered[0].animated);

    let token = parse_emote_token("hello @Friendly :kw").expect("emote token should parse");
    assert_eq!(token.query, "kw");
    assert_eq!(
        replace_emote_token("hello @Friendly :kw", &token, &filtered[0]),
        "hello @Friendly KEKW "
    );
    assert!(parse_emote_token("hello :ke ").is_none());
    let root_token = parse_emote_token(":").expect("root emote token should parse");
    assert_eq!(root_token.query, "");
}

#[test]
fn seven_tv_catalog_returns_first_matching_channel_candidate_for_autocomplete() {
    let mut catalog = SevenTvCatalog::new();
    catalog.insert(
        Platform::Twitch,
        "satont",
        SevenTvEmote {
            id: "7tv-kekw".to_string(),
            name: "KEKW".to_string(),
            image_url: "https://cdn.7tv.app/emote/kekw/4x.webp".to_string(),
            animated: false,
            zero_width: false,
            aspect_ratio: 1.0,
        },
    );
    catalog.insert(
        Platform::Kick,
        "other",
        SevenTvEmote {
            id: "7tv-other".to_string(),
            name: "Other".to_string(),
            image_url: "https://cdn.7tv.app/emote/other/4x.webp".to_string(),
            animated: false,
            zero_width: false,
            aspect_ratio: 1.0,
        },
    );

    let emotes = catalog.for_channel_candidates(Platform::Twitch, ["satont-slug", "satont"]);

    assert_eq!(emotes.len(), 1);
    assert_eq!(emotes[0].name, "KEKW");
}

#[test]
fn mention_autocomplete_uses_alias_labels_but_inserts_original_display_names() {
    let mut msg1 = make_message(
        "msg-1".to_string(),
        Platform::Twitch,
        "channel".to_string(),
        "user-1".to_string(),
        "Twitch User".to_string(),
        1,
    );
    msg1.author.username = Some("real_twitch_user".to_string());

    let mut msg2 = make_message(
        "msg-2".to_string(),
        Platform::Twitch,
        "channel".to_string(),
        "user-2".to_string(),
        "Another Viewer".to_string(),
        2,
    );
    msg2.author.username = Some("another_viewer_login".to_string());

    let messages = [msg1, msg2];
    let aliases = AliasBook::from_aliases([UserAlias {
        platform: Platform::Twitch,
        platform_user_id: "user-1".to_string(),
        alias: "Friendly Alias".to_string(),
        created_at: 1,
        updated_at: 1,
    }]);

    let suggestions = mention_suggestions(messages.iter().rev(), &aliases);
    let filtered_by_alias = fuzzy_filter_mentions(&suggestions, "fr", 15);

    assert_eq!(filtered_by_alias.len(), 1);
    assert_eq!(filtered_by_alias[0].label, "Friendly Alias");
    assert_eq!(filtered_by_alias[0].insert_label, "Twitch User");
    assert_eq!(
        filtered_by_alias[0].current_alias.as_deref(),
        Some("Friendly Alias")
    );

    let filtered_by_original = fuzzy_filter_mentions(&suggestions, "twitch", 15);
    assert_eq!(
        filtered_by_original.len(),
        1,
        "Should match original display name"
    );
    assert_eq!(filtered_by_original[0].label, "Friendly Alias");
    assert_eq!(filtered_by_original[0].insert_label, "Twitch User");

    let filtered_by_username = fuzzy_filter_mentions(&suggestions, "real_twitch", 15);
    assert_eq!(
        filtered_by_username.len(),
        1,
        "Should match specific user's username"
    );
    assert_eq!(filtered_by_username[0].label, "Friendly Alias");
    assert_eq!(filtered_by_username[0].insert_label, "Twitch User");

    let token = parse_mention_token("hello @fr").expect("mention token should parse");
    assert_eq!(token.query, "fr");
    assert_eq!(
        replace_mention_token("hello @fr", &token, &filtered_by_alias[0]),
        "hello @Twitch User "
    );
    assert!(parse_mention_token("hello @fr ").is_none());
    assert!(parse_mention_token("@").is_none());
}

#[test]
fn chat_history_hot_paths_preserve_empty_large_and_unicode_semantics()
-> Result<(), Box<dyn std::error::Error>> {
    let mut empty_history = Vec::new();
    let mut emoji_message = make_message(
        "unicode-emoji".to_string(),
        Platform::Twitch,
        "unicode-channel".to_string(),
        "unicode-author".to_string(),
        "Emoji Viewer".to_string(),
        1_710_000_000_002,
    );
    emoji_message.text = "Привет 👋 café KEKW".to_string();
    emoji_message.emotes.clear();

    assert!(insert_live_message_in_place(
        &mut empty_history,
        emoji_message.clone()
    ));
    assert_eq!(empty_history.len(), 1);
    assert_eq!(
        empty_history.first().map(|message| message.text.as_str()),
        Some("Привет 👋 café KEKW")
    );
    assert!(!insert_live_message_in_place(
        &mut empty_history,
        emoji_message
    ));
    assert_eq!(empty_history.len(), 1);

    let mut large_history = Vec::with_capacity(1_024);
    for index in (0..1_024).rev() {
        let message = make_message(
            format!("large-{index:04}"),
            Platform::Youtube,
            "large-channel".to_string(),
            "large-author".to_string(),
            format!("Large Viewer {index}"),
            1_710_000_100_000_i128 + i128::from(index),
        );
        assert!(insert_live_message_in_place(&mut large_history, message));
    }

    assert_eq!(large_history.len(), 1_024);
    assert_eq!(
        large_history.first().map(|message| message.id.as_str()),
        Some("large-0000")
    );
    assert_eq!(
        large_history.last().map(|message| message.id.as_str()),
        Some("large-1023")
    );

    let older_duplicate = large_history
        .first()
        .cloned()
        .ok_or("large history should contain the first message")?;
    let older_unique = make_message(
        "large-older".to_string(),
        Platform::Youtube,
        "large-channel".to_string(),
        "large-author".to_string(),
        "Older Viewer".to_string(),
        1_710_000_099_999,
    );
    let merged = merge_older_page([older_duplicate, older_unique], large_history.clone());

    assert_eq!(merged.len(), 1_025);
    assert_eq!(
        merged.first().map(|message| message.id.as_str()),
        Some("large-older")
    );
    assert_eq!(
        merged.get(1).map(|message| message.id.as_str()),
        Some("large-0000")
    );

    write_evidence(
        "task-7-chat-history-hot-paths.json",
        &json!({
            "emptyHistoryInsertions": empty_history.len(),
            "largeHistoryInsertions": large_history.len(),
            "mergedHistoryInsertions": merged.len(),
            "unicodeText": empty_history.first().map(|message| message.text.as_str()),
            "largeHistoryFirst": large_history.first().map(|message| message.id.as_str()),
            "largeHistoryLast": large_history.last().map(|message| message.id.as_str()),
            "olderDuplicateSkipped": merged.len() == large_history.len() + 1
        }),
    )?;

    Ok(())
}

fn make_message(
    id: String,
    platform: Platform,
    channel_id: String,
    author_id: String,
    display_name: String,
    timestamp: i128,
) -> NormalizedChatMessage {
    NormalizedChatMessage {
        id,
        platform,
        channel_id,
        author: ChatAuthor {
            id: author_id,
            username: Some("burst_user".to_string()),
            display_name,
            color: Some("#9146ff".to_string()),
            avatar_url: None,
            badges: vec![Badge {
                id: "broadcaster/1".to_string(),
                badge_type: "broadcaster".to_string(),
                text: "Broadcaster".to_string(),
                image_url: None,
            }],
        },
        text: "burst message".to_string(),
        emotes: vec![Emote {
            id: "25".to_string(),
            name: "Kappa".to_string(),
            image_url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0".to_string(),
            positions: vec![EmotePosition { start: 0, end: 4 }],
            aspect_ratio: Some(1.0),
        }],
        timestamp: timestamp.to_string(),
        message_type: ChatMessageType::Message,
        reply: None,
    }
}

fn read_json_fixture<T>(name: &str) -> Result<T, Box<dyn std::error::Error>>
where
    T: serde::de::DeserializeOwned,
{
    let text = fs::read_to_string(fixture_path(name))?;
    Ok(serde_json::from_str(&text)?)
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures/chat")
        .join(name)
}

fn write_evidence(name: &str, value: &serde_json::Value) -> Result<(), Box<dyn std::error::Error>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.sisyphus/evidence")
        .join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(value)?)?;
    Ok(())
}

fn duplicate_attempts(fixture: &BurstFixture) -> usize {
    (0..fixture.count)
        .filter(|index| index % fixture.duplicate_every == 0)
        .count()
}

#[allow(dead_code)]
fn event_fixture(id: String, platform: Platform) -> NormalizedEvent {
    NormalizedEvent {
        id,
        platform,
        event_type: NormalizedEventType::Follow,
        user: EventUser {
            id: "event-user".to_string(),
            display_name: "Event User".to_string(),
            avatar_url: None,
        },
        data: serde_json::Map::new(),
        timestamp: "1710000000000".to_string(),
    }
}
