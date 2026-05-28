use super::adapter::{
    StreamUpdate, StreamUpdateOutcome, TwitchAuthState, TwitchCategory, TwitchChatClient,
    TwitchChatEvent, TwitchChatMessage, TwitchEmoteSpan,
};
use crate::platforms::{PlatformError, PlatformResult};
use crate::protocol::types::{ChatReply, Platform, ReplyAuthor, StreamStatus};
use crate::runtime::config::{RuntimeConfig, RuntimeConfigInput};
use crate::storage::Storage;
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue};
use serde::Deserialize;
use std::collections::{BTreeMap, VecDeque};
use std::net::TcpStream;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket, connect};

const TWITCH_IRC_WS: &str = "wss://irc-ws.chat.twitch.tv:443";

pub struct RealTwitchClient {
    http: Client,
    backend_url: String,
    client_secret: String,
    socket: Option<WebSocket<MaybeTlsStream<TcpStream>>>,
    channel: Option<String>,
    incoming_messages: VecDeque<TwitchChatMessage>,
    incoming_events: VecDeque<TwitchChatEvent>,
    avatar_cache: BTreeMap<String, Option<String>>,
}

impl RealTwitchClient {
    pub fn new(storage: &Storage) -> PlatformResult<Self> {
        let http = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?;
        let runtime = RuntimeConfig::new(RuntimeConfigInput {
            client_secret: storage.client_identity().get_client_secret().ok(),
            ..Default::default()
        });

        Ok(Self {
            http,
            backend_url: runtime.backend_url().to_string(),
            client_secret: runtime.client_secret().to_string(),
            socket: None,
            channel: None,
            incoming_messages: VecDeque::new(),
            incoming_events: VecDeque::new(),
            avatar_cache: BTreeMap::new(),
        })
    }

    fn pump_socket(&mut self) -> PlatformResult<()> {
        if self.socket.is_none() {
            return Ok(());
        }

        loop {
            let message = {
                let Some(socket) = self.socket.as_mut() else {
                    return Ok(());
                };
                match socket.read() {
                    Ok(message) => message,
                    Err(tungstenite::Error::Io(error))
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) =>
                    {
                        break;
                    }
                    Err(error) => {
                        self.socket = None;
                        return Err(PlatformError::new(Platform::Twitch, error.to_string()));
                    }
                }
            };

            match message {
                Message::Text(text) => self.handle_irc_payload(&text)?,
                Message::Ping(payload) => {
                    if let Some(socket) = self.socket.as_mut() {
                        socket.send(Message::Pong(payload)).map_err(|error| {
                            PlatformError::new(Platform::Twitch, error.to_string())
                        })?;
                    }
                }
                Message::Close(_) => {
                    self.socket = None;
                    break;
                }
                _ => {}
            }
        }

        Ok(())
    }

    fn handle_irc_payload(&mut self, payload: &str) -> PlatformResult<()> {
        for line in payload.split("\r\n").filter(|line| !line.trim().is_empty()) {
            if let Some(token) = line.strip_prefix("PING ") {
                if let Some(socket) = self.socket.as_mut() {
                    socket
                        .send(Message::Text(format!("PONG {token}\r\n")))
                        .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?;
                }
                continue;
            }

            match parse_irc_line(line) {
                Some(ParsedTwitchLine::Message(mut message)) => {
                    message.avatar_url = self.resolve_avatar_url(&message.user_id)?;
                    self.incoming_messages.push_back(*message);
                }
                Some(ParsedTwitchLine::Event(event)) => self.incoming_events.push_back(event),
                None => {}
            }
        }

        Ok(())
    }

    fn resolve_avatar_url(&mut self, user_id: &str) -> PlatformResult<Option<String>> {
        if user_id.trim().is_empty() {
            return Ok(None);
        }
        if let Some(cached) = self.avatar_cache.get(user_id) {
            return Ok(cached.clone());
        }

        let response = self
            .http
            .get(format!("{}/api/twitch/user", self.backend_url))
            .headers(self.backend_headers()?)
            .query(&[("userId", user_id)])
            .timeout(Duration::from_secs(3))
            .send();

        let avatar_url = match response {
            Ok(response) if response.status().is_success() => {
                let body: TwitchUserResponse = response
                    .json()
                    .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?;
                normalize_avatar_url(body.user.and_then(|user| user.profile_image_url))
            }
            Ok(_) | Err(_) => None,
        };
        self.avatar_cache
            .insert(user_id.to_string(), avatar_url.clone());
        Ok(avatar_url)
    }

    fn backend_headers(&self) -> PlatformResult<HeaderMap> {
        let mut headers = HeaderMap::new();
        if !self.client_secret.is_empty() {
            headers.insert(
                "X-Client-Secret",
                HeaderValue::from_str(&self.client_secret)
                    .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?,
            );
        }
        Ok(headers)
    }
}

impl TwitchChatClient for RealTwitchClient {
    fn connect(&mut self, channel: &str, auth: &TwitchAuthState) -> PlatformResult<()> {
        let channel = normalize_channel(channel);
        let (mut socket, _) = connect(TWITCH_IRC_WS)
            .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?;
        configure_stream(socket.get_mut());

        let (pass, nick) = match auth {
            TwitchAuthState::Authenticated {
                access_token,
                login,
                ..
            } => (format!("oauth:{access_token}"), login.clone()),
            TwitchAuthState::Anonymous | TwitchAuthState::ReauthRequired { .. } => (
                String::from("SCHMOOPIIE"),
                format!("justinfan{}", current_unix_timestamp()),
            ),
        };

        for command in [
            format!("PASS {pass}\r\n"),
            format!("NICK {nick}\r\n"),
            String::from("CAP REQ :twitch.tv/commands twitch.tv/tags twitch.tv/membership\r\n"),
            format!("JOIN #{channel}\r\n"),
        ] {
            socket
                .send(Message::Text(command))
                .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?;
        }

        self.channel = Some(channel);
        self.socket = Some(socket);
        self.pump_socket()
    }

    fn disconnect(&mut self) -> PlatformResult<()> {
        if let Some(mut socket) = self.socket.take() {
            let _ = socket.close(None);
        }
        self.channel = None;
        Ok(())
    }

    fn send_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
    ) -> PlatformResult<String> {
        validate_irc_parameter("message text", text)?;
        if let Some(reply_id) = reply_to_message_id {
            validate_irc_parameter("reply message id", reply_id)?;
        }
        let Some(socket) = self.socket.as_mut() else {
            return Err(PlatformError::new(
                Platform::Twitch,
                "Twitch IRC socket not connected",
            ));
        };
        let channel = normalize_channel(channel_id);
        validate_channel_name(&channel)?;
        let command = match reply_to_message_id {
            Some(reply_id) => format!(
                "@reply-parent-msg-id={} PRIVMSG #{} :{}\r\n",
                escape_irc_tag_value(reply_id),
                channel,
                text
            ),
            None => format!("PRIVMSG #{channel} :{text}\r\n"),
        };
        socket
            .send(Message::Text(command))
            .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?;
        Ok(uuid::Uuid::new_v4().to_string())
    }

    fn fetch_badges(&mut self, channel: &str) -> PlatformResult<BTreeMap<String, String>> {
        let response = self
            .http
            .get(format!("{}/api/twitch/badges", self.backend_url))
            .headers(self.backend_headers()?)
            .query(&[("broadcasterLogin", normalize_channel(channel))])
            .send()
            .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_else(|error| error.to_string());
            return Err(PlatformError::new(
                Platform::Twitch,
                format!(
                    "Twitch badge fetch failed with {status}: {}",
                    body_snippet(&body)
                ),
            ));
        }
        let body: TwitchBadgesResponse = response
            .json()
            .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?;
        Ok(body.badges)
    }

    fn drain_messages(&mut self) -> PlatformResult<Vec<TwitchChatMessage>> {
        self.pump_socket()?;
        Ok(self.incoming_messages.drain(..).collect())
    }

    fn drain_events(&mut self) -> PlatformResult<Vec<TwitchChatEvent>> {
        Ok(self.incoming_events.drain(..).collect())
    }

    fn search_categories(&mut self, query: &str) -> PlatformResult<Vec<TwitchCategory>> {
        let response = self
            .http
            .get(format!("{}/api/search-categories", self.backend_url))
            .headers(self.backend_headers()?)
            .query(&[("platform", "twitch"), ("query", query)])
            .send()
            .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_else(|error| error.to_string());
            return Err(PlatformError::new(
                Platform::Twitch,
                format!(
                    "Twitch category search failed with {status}: {}",
                    body_snippet(&body)
                ),
            ));
        }
        let body: SearchCategoriesResponse = response
            .json()
            .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?;
        Ok(body
            .categories
            .into_iter()
            .map(|category| TwitchCategory {
                id: category.id,
                name: category.name,
            })
            .collect())
    }

    fn update_stream(&mut self, _update: &StreamUpdate) -> PlatformResult<StreamUpdateOutcome> {
        Err(PlatformError::new(
            Platform::Twitch,
            "Twitch stream updates are handled by backend RPC, not the watched-channel IRC client",
        ))
    }

    fn stream_status(&mut self, channel_id: &str) -> PlatformResult<StreamStatus> {
        let response = self
            .http
            .get(format!("{}/api/stream-status", self.backend_url))
            .headers(self.backend_headers()?)
            .query(&[("platform", "twitch"), ("channelId", channel_id)])
            .send()
            .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_else(|error| error.to_string());
            return Err(PlatformError::new(
                Platform::Twitch,
                format!(
                    "Twitch stream status failed with {status}: {}",
                    body_snippet(&body)
                ),
            ));
        }
        let body: StreamStatusResponse = response
            .json()
            .map_err(|error| PlatformError::new(Platform::Twitch, error.to_string()))?;
        Ok(StreamStatus {
            platform: Platform::Twitch,
            channel_id: channel_id.to_string(),
            is_live: body.is_live,
            title: body.title,
            category_id: body.category_id,
            category_name: body.category_name,
            viewer_count: body.viewer_count,
        })
    }
}

enum ParsedTwitchLine {
    Message(Box<TwitchChatMessage>),
    Event(TwitchChatEvent),
}

fn parse_irc_line(line: &str) -> Option<ParsedTwitchLine> {
    let (tags, rest) = parse_tags(line);
    if rest.contains(" PRIVMSG ") {
        return parse_privmsg(&tags, rest)
            .map(|message| ParsedTwitchLine::Message(Box::new(message)));
    }
    if rest.contains(" USERNOTICE ") {
        return parse_usernotice(&tags, rest).map(ParsedTwitchLine::Event);
    }
    None
}

fn parse_privmsg(tags: &BTreeMap<String, String>, rest: &str) -> Option<TwitchChatMessage> {
    let (_prefix, command, params) = parse_prefix_command_params(rest)?;
    if command != "PRIVMSG" {
        return None;
    }
    let (channel, text) = params.split_once(" :")?;
    let channel = normalize_channel(channel.trim());
    let username = tags
        .get("login")
        .cloned()
        .or_else(|| parse_prefix_username(rest))
        .unwrap_or_default();
    let display_name = tags
        .get("display-name")
        .filter(|value| !value.is_empty())
        .cloned()
        .unwrap_or_else(|| username.clone());
    let user_id = tags.get("user-id").cloned().unwrap_or_default();
    let (text, is_action) = parse_message_text(text);
    let emotes = parse_emotes_tag(tags.get("emotes").map(String::as_str), &text);
    let badges = parse_badges_tag(tags.get("badges").map(String::as_str));
    let reply = parse_reply(tags);
    let timestamp = tags
        .get("tmi-sent-ts")
        .cloned()
        .unwrap_or_else(current_unix_timestamp_string);

    Some(TwitchChatMessage {
        id: tags
            .get("id")
            .cloned()
            .unwrap_or_else(|| format!("twitch:{}:{}", user_id, timestamp)),
        channel,
        user_id,
        username,
        display_name,
        color: tags.get("color").filter(|value| !value.is_empty()).cloned(),
        avatar_url: None,
        text,
        timestamp,
        badges,
        emotes,
        is_action,
        reply,
        bits: tags.get("bits").and_then(|value| value.parse::<u64>().ok()),
    })
}

fn parse_usernotice(tags: &BTreeMap<String, String>, rest: &str) -> Option<TwitchChatEvent> {
    let (_prefix, command, params) = parse_prefix_command_params(rest)?;
    if command != "USERNOTICE" {
        return None;
    }
    let channel_id = params
        .split_whitespace()
        .next()
        .map(normalize_channel)
        .unwrap_or_default();
    let notice_id = tags.get("msg-id")?.as_str();
    let id = tags
        .get("id")
        .cloned()
        .unwrap_or_else(|| format!("twitch:{notice_id}:{}", current_unix_timestamp()));
    let user_id = tags.get("user-id").cloned().unwrap_or_default();
    let display_name = tags
        .get("display-name")
        .filter(|value| !value.is_empty())
        .cloned()
        .unwrap_or_else(|| user_id.clone());
    let system_message = tags.get("system-msg").cloned();

    match notice_id {
        "sub" => Some(TwitchChatEvent::Sub {
            id,
            channel_id,
            user_id,
            display_name,
            months: parse_notice_months(tags),
            system_message,
        }),
        "resub" => Some(TwitchChatEvent::Resub {
            id,
            channel_id,
            user_id,
            display_name,
            months: parse_notice_months(tags),
            system_message,
        }),
        "subgift" | "anonsubgift" => Some(TwitchChatEvent::GiftSub {
            id,
            channel_id,
            user_id,
            display_name,
            recipient_display_name: tags
                .get("msg-param-recipient-display-name")
                .or_else(|| tags.get("msg-param-recipient-user-name"))
                .cloned()
                .unwrap_or_default(),
            months: parse_notice_months(tags),
            system_message,
        }),
        "raid" => Some(TwitchChatEvent::Raid {
            id,
            channel_id,
            user_id,
            display_name,
            viewer_count: tags
                .get("msg-param-viewerCount")
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0),
            system_message,
        }),
        _ => None,
    }
}

fn parse_tags(line: &str) -> (BTreeMap<String, String>, &str) {
    let Some(raw_tags) = line.strip_prefix('@') else {
        return (BTreeMap::new(), line);
    };
    let Some((tags, rest)) = raw_tags.split_once(' ') else {
        return (BTreeMap::new(), line);
    };
    let parsed = tags
        .split(';')
        .filter_map(|tag| {
            let (key, value) = tag.split_once('=')?;
            Some((key.to_string(), unescape_irc_tag_value(value)))
        })
        .collect();
    (parsed, rest)
}

fn parse_prefix_command_params(rest: &str) -> Option<(&str, &str, &str)> {
    let rest = rest.strip_prefix(':')?;
    let (prefix, rest) = rest.split_once(' ')?;
    let (command, params) = rest.split_once(' ')?;
    Some((prefix, command, params))
}

fn parse_prefix_username(rest: &str) -> Option<String> {
    let prefix = rest.strip_prefix(':')?.split_once(' ')?.0;
    Some(prefix.split('!').next()?.to_string())
}

fn parse_badges_tag(value: Option<&str>) -> Vec<(String, String)> {
    value
        .unwrap_or_default()
        .split(',')
        .filter_map(|badge| {
            if badge.is_empty() {
                return None;
            }
            let (id, version) = badge.split_once('/').unwrap_or((badge, "1"));
            Some((id.to_string(), version.to_string()))
        })
        .collect()
}

fn parse_emotes_tag(value: Option<&str>, text: &str) -> Vec<TwitchEmoteSpan> {
    let mut spans = Vec::new();
    for emote_group in value
        .unwrap_or_default()
        .split('/')
        .filter(|part| !part.is_empty())
    {
        let Some((id, offsets)) = emote_group.split_once(':') else {
            continue;
        };
        for offset in offsets.split(',') {
            let Some((start, end)) = offset.split_once('-') else {
                continue;
            };
            let (Ok(start), Ok(end)) = (start.parse::<u32>(), end.parse::<u32>()) else {
                continue;
            };
            let name = slice_inclusive_twitch_range(text, start as usize, end as usize)
                .unwrap_or_default();
            spans.push(TwitchEmoteSpan {
                id: id.to_string(),
                name,
                start,
                end,
            });
        }
    }
    spans
}

fn parse_reply(tags: &BTreeMap<String, String>) -> Option<ChatReply> {
    let parent_message_id = tags.get("reply-parent-msg-id")?.clone();
    let parent_message_text = tags.get("reply-parent-msg-body")?.clone();
    let parent_author_id = tags.get("reply-parent-user-id")?.clone();
    let username = tags
        .get("reply-parent-user-login")
        .cloned()
        .unwrap_or_default();
    let display_name = tags
        .get("reply-parent-display-name")
        .cloned()
        .unwrap_or_else(|| username.clone());
    Some(ChatReply {
        parent_message_id,
        parent_message_text,
        parent_author: ReplyAuthor {
            id: parent_author_id,
            username,
            display_name,
        },
    })
}

fn parse_notice_months(tags: &BTreeMap<String, String>) -> u64 {
    tags.get("msg-param-cumulative-months")
        .or_else(|| tags.get("msg-param-months"))
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(1)
}

fn slice_inclusive_twitch_range(text: &str, start: usize, end: usize) -> Option<String> {
    let exclusive_end = end.checked_add(1)?;
    if exclusive_end <= text.len()
        && text.is_char_boundary(start)
        && text.is_char_boundary(exclusive_end)
    {
        return text.get(start..exclusive_end).map(str::to_string);
    }

    let byte_start = text.char_indices().nth(start).map(|(index, _)| index)?;
    let byte_end = text
        .char_indices()
        .nth(exclusive_end)
        .map(|(index, _)| index)
        .unwrap_or(text.len());
    text.get(byte_start..byte_end).map(str::to_string)
}

fn normalize_channel(channel: &str) -> String {
    channel.trim().trim_start_matches('#').to_lowercase()
}

fn parse_message_text(text: &str) -> (String, bool) {
    const ACTION_PREFIX: &str = "\u{1}ACTION ";
    if let Some(action) = text
        .strip_prefix(ACTION_PREFIX)
        .and_then(|value| value.strip_suffix('\u{1}'))
    {
        return (action.to_string(), true);
    }
    (text.to_string(), false)
}

fn validate_irc_parameter(field: &str, value: &str) -> PlatformResult<()> {
    if value.contains(['\r', '\n', '\0']) {
        return Err(PlatformError::new(
            Platform::Twitch,
            format!("Twitch {field} must be a single IRC line"),
        ));
    }
    Ok(())
}

fn validate_channel_name(channel: &str) -> PlatformResult<()> {
    let valid = !channel.is_empty()
        && channel.len() <= 25
        && channel
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_');
    if valid {
        Ok(())
    } else {
        Err(PlatformError::new(
            Platform::Twitch,
            format!("Invalid Twitch channel name: {channel}"),
        ))
    }
}

fn configure_stream(stream: &mut MaybeTlsStream<TcpStream>) {
    match stream {
        MaybeTlsStream::Plain(stream) => configure_tcp_stream(stream),
        MaybeTlsStream::Rustls(stream) => configure_tcp_stream(stream.get_mut()),
        _ => {}
    }
}

fn configure_tcp_stream(stream: &mut TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
}

fn unescape_irc_tag_value(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut escaped = false;
    for ch in value.chars() {
        if escaped {
            result.push(match ch {
                's' => ' ',
                ':' => ';',
                'r' => '\r',
                'n' => '\n',
                '\\' => '\\',
                other => other,
            });
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else {
            result.push(ch);
        }
    }
    if escaped {
        result.push('\\');
    }
    result
}

fn escape_irc_tag_value(value: &str) -> String {
    value
        .replace('\\', r"\\")
        .replace(';', r"\:")
        .replace(' ', r"\s")
        .replace('\r', r"\r")
        .replace('\n', r"\n")
}

fn body_snippet(value: &str) -> String {
    const MAX_LENGTH: usize = 500;
    let trimmed = value.trim();
    if trimmed.chars().count() <= MAX_LENGTH {
        trimmed.to_string()
    } else {
        let snippet: String = trimmed.chars().take(MAX_LENGTH).collect();
        format!("{snippet}...")
    }
}

fn normalize_avatar_url(value: Option<String>) -> Option<String> {
    let normalized = value?.trim().to_string();
    (!normalized.is_empty()).then_some(normalized)
}

fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn current_unix_timestamp_string() -> String {
    current_unix_timestamp().to_string()
}

#[derive(Deserialize)]
struct TwitchBadgesResponse {
    badges: BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct TwitchUserResponse {
    user: Option<TwitchUser>,
}

#[derive(Deserialize)]
struct TwitchUser {
    profile_image_url: Option<String>,
}

#[derive(Deserialize)]
struct SearchCategoriesResponse {
    categories: Vec<SearchCategory>,
}

#[derive(Deserialize)]
struct SearchCategory {
    id: String,
    name: String,
}

#[derive(Deserialize)]
struct StreamStatusResponse {
    #[serde(rename = "isLive")]
    is_live: bool,
    title: String,
    #[serde(rename = "categoryId")]
    category_id: Option<String>,
    #[serde(rename = "categoryName")]
    category_name: Option<String>,
    #[serde(rename = "viewerCount")]
    viewer_count: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_privmsg_tags_with_repeated_emotes_badges_and_reply() {
        let line = r"@badge-info=subscriber/12;badges=broadcaster/1,subscriber/12;color=#9146ff;display-name=Viewer\sLogin;emotes=25:0-4,12-16;id=msg-1;reply-parent-msg-body=hello\sworld;reply-parent-msg-id=parent-1;reply-parent-user-id=parent-user;reply-parent-user-login=parentlogin;reply-parent-display-name=Parent\sLogin;tmi-sent-ts=1700000000000;user-id=viewer-1 :viewerlogin!viewerlogin@viewerlogin.tmi.twitch.tv PRIVMSG #FixtureStreamer :Kappa hello Kappa";

        let Some(ParsedTwitchLine::Message(message)) = parse_irc_line(line) else {
            panic!("expected parsed Twitch chat message");
        };

        assert_eq!(message.channel, "fixturestreamer");
        assert_eq!(message.display_name, "Viewer Login");
        assert_eq!(
            message.badges,
            vec![
                ("broadcaster".into(), "1".into()),
                ("subscriber".into(), "12".into())
            ]
        );
        assert_eq!(message.emotes.len(), 2);
        assert_eq!(message.emotes[0].name, "Kappa");
        assert_eq!(message.emotes[1].start, 12);
        assert_eq!(
            message
                .reply
                .as_ref()
                .map(|reply| reply.parent_author.display_name.as_str()),
            Some("Parent Login")
        );
    }

    #[test]
    fn parses_ctcp_action_as_action_message() {
        let line = "@badges=;display-name=Viewer;id=msg-action;tmi-sent-ts=1700000000000;user-id=viewer-1 :viewerlogin!viewerlogin@viewerlogin.tmi.twitch.tv PRIVMSG #FixtureStreamer :\u{1}ACTION waves\u{1}";

        let Some(ParsedTwitchLine::Message(message)) = parse_irc_line(line) else {
            panic!("expected parsed Twitch action message");
        };

        assert!(message.is_action);
        assert_eq!(message.text, "waves");
    }

    #[test]
    fn rejects_outbound_irc_command_injection_inputs() {
        assert!(validate_irc_parameter("message text", "hello\r\nJOIN #other").is_err());
        assert!(validate_irc_parameter("message text", "hello\nPRIVMSG #x :pwn").is_err());
        assert!(validate_irc_parameter("reply message id", "abc\r\nPART #x").is_err());
        assert!(validate_channel_name("foo\r\npart").is_err());
        assert!(validate_channel_name("valid_channel1").is_ok());
    }
}
