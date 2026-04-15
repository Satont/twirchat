use crate::platforms::adapter::{AdapterEvent, PlatformAdapter};
use crate::store::{accounts, db, migration};
use crate::{
    AppError, Badge, Emote, EmotePosition, MessageType, NormalizedChatMessage,
    NormalizedChatMessageAuthor, NormalizedChatMessageReply, NormalizedChatMessageReplyAuthor,
    NormalizedEvent, NormalizedEventType, NormalizedEventUser, Platform,
};
use rusqlite::Connection;
use serde_json::{Map, Value, json};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use twitch_irc::login::StaticLoginCredentials;
use twitch_irc::message::{
    Badge as TwitchBadge, ClearChatAction, ClearChatMessage, ClearMsgMessage, Emote as TwitchEmote,
    PrivmsgMessage, ReplyParent, ServerMessage, UserNoticeEvent, UserNoticeMessage,
};
use twitch_irc::{ClientConfig, SecureTCPTransport, TwitchIRCClient};

type TwitchClient = TwitchIRCClient<SecureTCPTransport, StaticLoginCredentials>;

#[derive(Default)]
struct TwitchConnectionState {
    client: Option<TwitchClient>,
    task: Option<JoinHandle<()>>,
}

pub struct TwitchAdapter {
    db_path: PathBuf,
    state: Arc<Mutex<TwitchConnectionState>>,
}

impl TwitchAdapter {
    #[must_use]
    pub fn new(db_path: PathBuf) -> Self {
        Self {
            db_path,
            state: Arc::new(Mutex::new(TwitchConnectionState::default())),
        }
    }

    fn open_connection(&self) -> Result<Connection, AppError> {
        let conn = db::open_db(&self.db_path)?;
        db::init_db(&conn)?;
        migration::migrate_tokens(&conn)?;
        Ok(conn)
    }

    fn load_credentials(&self) -> Result<StaticLoginCredentials, AppError> {
        let conn = self.open_connection()?;

        let Some(account) = accounts::get_all(&conn)?
            .into_iter()
            .find(|account| account.platform == Platform::Twitch)
        else {
            return Ok(StaticLoginCredentials::anonymous());
        };

        let Some(tokens) = accounts::get_tokens(&conn, &account.id)? else {
            return Ok(StaticLoginCredentials::anonymous());
        };

        Ok(StaticLoginCredentials::new(
            account.username.to_lowercase(),
            Some(tokens.access_token),
        ))
    }

    fn format_timestamp(timestamp: chrono::DateTime<chrono::Utc>) -> String {
        timestamp
            .naive_utc()
            .format("%Y-%m-%dT%H:%M:%S%.3f+00:00")
            .to_string()
    }

    fn build_chat_message(message: PrivmsgMessage) -> NormalizedChatMessage {
        NormalizedChatMessage {
            id: message.message_id,
            platform: Platform::Twitch,
            channel_id: message.channel_login,
            author: NormalizedChatMessageAuthor {
                id: message.sender.id,
                username: Some(message.sender.login),
                display_name: message.sender.name,
                color: message.name_color.map(|color| color.to_string()),
                avatar_url: None,
                badges: message.badges.into_iter().map(Self::map_badge).collect(),
            },
            text: message.message_text,
            emotes: message.emotes.iter().map(Self::map_emote).collect(),
            timestamp: Self::format_timestamp(message.server_timestamp),
            message_type: if message.is_action {
                MessageType::Action
            } else {
                MessageType::Message
            },
            reply: message.reply_parent.map(Self::map_reply_parent),
        }
    }

    fn build_user_notice_event(message: UserNoticeMessage) -> Option<NormalizedEvent> {
        let mut data = Map::new();
        data.insert("channelId".to_owned(), json!(message.channel_id));
        data.insert("channelLogin".to_owned(), json!(message.channel_login));
        data.insert("systemMsg".to_owned(), json!(message.system_message));

        let event_type = match message.event {
            UserNoticeEvent::SubOrResub {
                is_resub,
                cumulative_months,
                streak_months,
                sub_plan,
                sub_plan_name,
            } => {
                data.insert("months".to_owned(), json!(cumulative_months));
                data.insert("subPlan".to_owned(), json!(sub_plan));
                data.insert("subPlanName".to_owned(), json!(sub_plan_name));
                if let Some(streak_months) = streak_months {
                    data.insert("streakMonths".to_owned(), json!(streak_months));
                }

                if is_resub {
                    NormalizedEventType::Resub
                } else {
                    NormalizedEventType::Sub
                }
            }
            UserNoticeEvent::SubGift {
                is_sender_anonymous,
                cumulative_months,
                recipient,
                sub_plan,
                sub_plan_name,
                num_gifted_months,
            } => {
                data.insert("months".to_owned(), json!(cumulative_months));
                data.insert("recipientId".to_owned(), json!(recipient.id));
                data.insert("recipientUsername".to_owned(), json!(recipient.login));
                data.insert("recipientDisplayName".to_owned(), json!(recipient.name));
                data.insert("subPlan".to_owned(), json!(sub_plan));
                data.insert("subPlanName".to_owned(), json!(sub_plan_name));
                data.insert("giftMonths".to_owned(), json!(num_gifted_months));
                data.insert("isAnonymous".to_owned(), json!(is_sender_anonymous));
                NormalizedEventType::GiftSub
            }
            UserNoticeEvent::Raid {
                viewer_count,
                profile_image_url,
            } => {
                data.insert("viewerCount".to_owned(), json!(viewer_count));
                data.insert("profileImageUrl".to_owned(), json!(profile_image_url));
                NormalizedEventType::Raid
            }
            _ => return None,
        };

        Some(NormalizedEvent {
            id: message.message_id,
            platform: Platform::Twitch,
            event_type,
            user: NormalizedEventUser {
                id: message.sender.id,
                display_name: message.sender.name,
                avatar_url: None,
            },
            data,
            timestamp: Self::format_timestamp(message.server_timestamp),
        })
    }

    fn build_clear_chat_event(message: ClearChatMessage) -> NormalizedEvent {
        let mut data = Map::new();
        data.insert("channelId".to_owned(), json!(message.channel_id));
        data.insert("channelLogin".to_owned(), json!(message.channel_login));
        data.insert("moderationAction".to_owned(), json!("clearchat"));

        match message.action {
            ClearChatAction::ChatCleared => {
                data.insert("scope".to_owned(), json!("channel"));
            }
            ClearChatAction::UserBanned {
                user_login,
                user_id,
            } => {
                data.insert("scope".to_owned(), json!("user"));
                data.insert("targetUserId".to_owned(), json!(user_id));
                data.insert("targetUsername".to_owned(), json!(user_login));
                data.insert("action".to_owned(), json!("ban"));
            }
            ClearChatAction::UserTimedOut {
                user_login,
                user_id,
                timeout_length,
            } => {
                data.insert("scope".to_owned(), json!("user"));
                data.insert("targetUserId".to_owned(), json!(user_id));
                data.insert("targetUsername".to_owned(), json!(user_login));
                data.insert("action".to_owned(), json!("timeout"));
                data.insert(
                    "durationSeconds".to_owned(),
                    json!(timeout_length.as_secs()),
                );
            }
        }

        NormalizedEvent {
            id: format!(
                "twitch:clearchat:{}",
                message.server_timestamp.timestamp_millis()
            ),
            platform: Platform::Twitch,
            event_type: NormalizedEventType::Host,
            user: NormalizedEventUser {
                id: String::new(),
                display_name: "moderation".to_owned(),
                avatar_url: None,
            },
            data,
            timestamp: Self::format_timestamp(message.server_timestamp),
        }
    }

    fn build_clear_msg_event(message: &ClearMsgMessage) -> NormalizedEvent {
        let mut data = Map::new();
        data.insert("channelLogin".to_owned(), json!(message.channel_login));
        data.insert("moderationAction".to_owned(), json!("clearmsg"));
        data.insert("targetMessageId".to_owned(), json!(message.message_id));
        data.insert("targetUsername".to_owned(), json!(message.sender_login));
        data.insert("messageText".to_owned(), json!(message.message_text));
        data.insert("isAction".to_owned(), Value::Bool(message.is_action));

        NormalizedEvent {
            id: format!(
                "twitch:clearmsg:{}",
                message.server_timestamp.timestamp_millis()
            ),
            platform: Platform::Twitch,
            event_type: NormalizedEventType::Host,
            user: NormalizedEventUser {
                id: String::new(),
                display_name: "moderation".to_owned(),
                avatar_url: None,
            },
            data,
            timestamp: Self::format_timestamp(message.server_timestamp),
        }
    }

    fn map_badge(badge: TwitchBadge) -> Badge {
        let id = format!("{}/{}", badge.name, badge.version);
        Badge {
            id: id.clone(),
            badge_type: badge.name,
            text: id,
            image_url: None,
        }
    }

    fn map_emote(emote: &TwitchEmote) -> Emote {
        Emote {
            id: emote.id.clone(),
            name: emote.code.clone(),
            image_url: format!(
                "https://static-cdn.jtvnw.net/emoticons/v2/{}/default/dark/1.0",
                emote.id
            ),
            positions: vec![EmotePosition {
                start: emote.char_range.start,
                end: emote.char_range.end.saturating_sub(1),
            }],
            aspect_ratio: None,
        }
    }

    fn map_reply_parent(reply: ReplyParent) -> NormalizedChatMessageReply {
        NormalizedChatMessageReply {
            parent_message_id: reply.message_id,
            parent_message_text: reply.message_text,
            parent_author: NormalizedChatMessageReplyAuthor {
                id: reply.reply_parent_user.id,
                username: reply.reply_parent_user.login,
                display_name: reply.reply_parent_user.name,
            },
        }
    }

    async fn handle_server_message(
        event_tx: &tokio::sync::mpsc::Sender<AdapterEvent>,
        message: ServerMessage,
    ) {
        match message {
            ServerMessage::Privmsg(message) => {
                let normalized = Self::build_chat_message(message);
                let _ = event_tx
                    .send(AdapterEvent::Message(Box::new(normalized)))
                    .await;
            }
            ServerMessage::UserNotice(message) => {
                if let Some(normalized) = Self::build_user_notice_event(message) {
                    let _ = event_tx
                        .send(AdapterEvent::Event(Box::new(normalized)))
                        .await;
                }
            }
            ServerMessage::ClearChat(message) => {
                let normalized = Self::build_clear_chat_event(message);
                let _ = event_tx
                    .send(AdapterEvent::Event(Box::new(normalized)))
                    .await;
            }
            ServerMessage::ClearMsg(message) => {
                let normalized = Self::build_clear_msg_event(&message);
                let _ = event_tx
                    .send(AdapterEvent::Event(Box::new(normalized)))
                    .await;
            }
            _ => {}
        }
    }
}

impl Default for TwitchAdapter {
    fn default() -> Self {
        Self::new(PathBuf::new())
    }
}

#[async_trait::async_trait]
impl PlatformAdapter for TwitchAdapter {
    async fn connect(
        &self,
        channel: &str,
        event_tx: tokio::sync::mpsc::Sender<AdapterEvent>,
    ) -> Result<(), AppError> {
        let channel = channel.to_lowercase();
        let credentials = self
            .load_credentials()
            .unwrap_or_else(|_| StaticLoginCredentials::anonymous());
        let config = ClientConfig::new_simple(credentials);
        let (mut incoming_messages, client) =
            TwitchIRCClient::<SecureTCPTransport, StaticLoginCredentials>::new(config);

        client
            .join(channel.clone())
            .map_err(|error| AppError::Adapter(format!("join channel: {error}")))?;

        let event_tx_clone = event_tx.clone();
        let task = tokio::spawn(async move {
            while let Some(message) = incoming_messages.recv().await {
                Self::handle_server_message(&event_tx_clone, message).await;
            }
        });

        let mut state = self.state.lock().await;
        if let Some(existing_client) = state.client.take() {
            existing_client.part(channel.clone());
        }
        if let Some(existing_task) = state.task.take() {
            existing_task.abort();
        }
        state.client = Some(client);
        state.task = Some(task);
        drop(state);

        let _ = event_tx
            .send(AdapterEvent::Status {
                platform: Platform::Twitch,
                channel,
                state: crate::platforms::adapter::AdapterState::Connected,
            })
            .await;

        Ok(())
    }

    async fn disconnect(&self, channel: &str) -> Result<(), AppError> {
        let mut state = self.state.lock().await;
        if let Some(client) = state.client.take() {
            client.part(channel.to_lowercase());
        }
        if let Some(task) = state.task.take() {
            task.abort();
        }
        drop(state);
        Ok(())
    }

    async fn send_message(
        &self,
        channel_id: &str,
        text: &str,
        reply_to: Option<&str>,
    ) -> Result<(), AppError> {
        if reply_to.is_some() {
            return Err(AppError::Adapter(
                "twitch reply messages are not supported yet".to_owned(),
            ));
        }

        let client =
            self.state.lock().await.client.clone().ok_or_else(|| {
                AppError::Adapter("twitch chat client is not connected".to_owned())
            })?;

        client
            .say(channel_id.to_lowercase(), text.to_owned())
            .await
            .map_err(|error| AppError::Adapter(format!("send twitch message: {error}")))
    }

    fn platform(&self) -> Platform {
        Platform::Twitch
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::convert::TryFrom;
    use twitch_irc::message::{IRCMessage, PrivmsgMessage};

    #[test]
    fn parse_sample_privmsg_into_normalized_message() {
        let raw = "@badge-info=subscriber/22;badges=moderator/1,subscriber/12,bits/100;color=#19E6E6;display-name=randers;emotes=25:0-4,12-16/1902:6-10;flags=;id=f9c5774b-faa7-4378-b1af-c4e08b532dc2;bits=100;mod=1;room-id=11148817;subscriber=1;tmi-sent-ts=1594556065407;turbo=0;user-id=40286300;user-type=mod :randers!randers@randers.tmi.twitch.tv PRIVMSG #pajlada :Kappa Keepo Kappa";
        let irc_message = IRCMessage::parse(raw).expect("parse irc line");
        let message = PrivmsgMessage::try_from(irc_message).expect("parse privmsg");

        let normalized = TwitchAdapter::build_chat_message(message);

        assert_eq!(normalized.id, "f9c5774b-faa7-4378-b1af-c4e08b532dc2");
        assert_eq!(normalized.platform, Platform::Twitch);
        assert_eq!(normalized.channel_id, "pajlada");
        assert_eq!(normalized.author.id, "40286300");
        assert_eq!(normalized.author.username.as_deref(), Some("randers"));
        assert_eq!(normalized.author.display_name, "randers");
        assert_eq!(normalized.author.color.as_deref(), Some("#19E6E6"));
        assert_eq!(normalized.author.badges.len(), 3);
        assert_eq!(normalized.author.badges[0].id, "moderator/1");
        assert_eq!(normalized.text, "Kappa Keepo Kappa");
        assert_eq!(normalized.timestamp, "2020-07-12T12:14:25.407+00:00");
        assert!(matches!(normalized.message_type, MessageType::Message));
        assert_eq!(normalized.emotes.len(), 3);
        assert_eq!(normalized.emotes[0].id, "25");
        assert_eq!(normalized.emotes[0].name, "Kappa");
        assert_eq!(normalized.emotes[0].positions[0].start, 0);
        assert_eq!(normalized.emotes[0].positions[0].end, 4);
        assert_eq!(normalized.emotes[1].id, "1902");
        assert_eq!(normalized.emotes[1].positions[0].start, 6);
        assert_eq!(normalized.emotes[1].positions[0].end, 10);
        assert!(normalized.reply.is_none());
    }
}
