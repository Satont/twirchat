//! Native YouTube platform adapter surface.

pub mod adapter;
pub mod mock;
pub mod transport;

pub use adapter::{YouTubeAdapter, YouTubeAuthProvider, YouTubeAuthState};
pub use mock::{MockYouTubeTransport, SentYouTubeMessage};
pub use transport::{
    YouTubeAccountHint, YouTubeAuthor, YouTubeBadge, YouTubeChannelResolutionRequest,
    YouTubeMembership, YouTubeResolvedChannel, YouTubeSendMessageRequest, YouTubeStreamItem,
    YouTubeStreamSignal, YouTubeStreamState, YouTubeStreamSubscription, YouTubeStreamingTransport,
    YouTubeSuperChat, YouTubeTextMessage, YouTubeTransportAuth, YouTubeTransportKind,
};
