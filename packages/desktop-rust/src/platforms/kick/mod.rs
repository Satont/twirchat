//! Native Kick platform adapter surface.

pub mod adapter;
pub mod badges;
pub mod client;
pub mod mock;

pub use adapter::{
    KickAdapter, KickAdapterError, KickAdapterErrorKind, KickAuthProvider, KickAuthState,
    KickAvatarLookupRequest, KickAvatarLookupSource, KickBadge, KickBadgeV2, KickChatClient,
    KickChatMessage, KickChatMessageKind, KickChatroom, KickEmote, KickFollowEvent,
    KickMessageSender, KickOriginalMessage, KickOriginalSender, KickReplyMetadata,
    KickSendMessageRequest, KickSenderIdentity, KickStreamStatusRequest, KickSubscriptionEvent,
    KickTransportAuth,
};
pub use badges::{embedded_kick_badge_svg, kick_badge_embedded_url};
pub use client::RealKickClient;
pub use mock::{MockKickClient, SentKickMessage};
