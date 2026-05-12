//! Native Kick platform adapter surface.

pub mod adapter;
pub mod client;
pub mod mock;

pub use adapter::{
    KickAdapter, KickAdapterError, KickAdapterErrorKind, KickAuthProvider, KickAuthState,
    KickBadge, KickChatClient, KickChatMessage, KickChatMessageKind, KickChatroom, KickEmote,
    KickFollowEvent, KickMessageSender, KickOriginalMessage, KickOriginalSender, KickReplyMetadata,
    KickSendMessageRequest, KickSenderIdentity, KickStreamStatusRequest, KickSubscriptionEvent,
    KickTransportAuth,
};
pub use client::RealKickClient;
pub use mock::{MockKickClient, SentKickMessage};
