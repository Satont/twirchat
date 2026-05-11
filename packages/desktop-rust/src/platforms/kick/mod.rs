//! Native Kick platform adapter surface.

pub mod adapter;
pub mod mock;

pub use adapter::{
    KickAdapter, KickAdapterError, KickAdapterErrorKind, KickAuthProvider, KickAuthState,
    KickBadge, KickChatClient, KickChatMessage, KickChatMessageKind, KickChatroom, KickEmote,
    KickFollowEvent, KickMessageSender, KickOriginalMessage, KickOriginalSender, KickReplyMetadata,
    KickSendMessageRequest, KickStreamStatusRequest, KickSubscriptionEvent, KickTransportAuth,
};
pub use mock::{MockKickClient, SentKickMessage};
