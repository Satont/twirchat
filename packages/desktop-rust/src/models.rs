#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Twitch,
    YouTube,
    Kick,
}

impl Platform {
    pub fn label(self) -> &'static str {
        match self {
            Self::Twitch => "Twitch",
            Self::YouTube => "YouTube",
            Self::Kick => "Kick",
        }
    }

    pub fn glyph(self) -> &'static str {
        match self {
            Self::Twitch => "T",
            Self::YouTube => "Y",
            Self::Kick => "K",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Account {
    pub platform: Platform,
    pub display_name: String,
    pub username: String,
    pub connected: bool,
}

#[derive(Debug, Clone)]
pub struct ChannelTab {
    pub id: String,
    pub label: String,
    pub platform: Option<Platform>,
    pub live: bool,
    pub viewer_count: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub platform: Platform,
    pub timestamp: String,
    pub author: String,
    pub badges: Vec<String>,
    pub text: String,
    pub author_color_hex: u32,
    pub system: bool,
}

#[derive(Debug, Clone)]
pub struct StreamChip {
    pub platform: Platform,
    pub channel_name: String,
    pub live: bool,
    pub viewer_count: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct UiEvent {
    pub platform: Platform,
    pub title: String,
    pub detail: String,
    pub accent_hex: u32,
    pub timestamp: String,
}

#[derive(Debug, Clone)]
pub struct PlatformCard {
    pub platform: Platform,
    pub display_name: String,
    pub username: String,
    pub status: String,
    pub joined_channel: String,
    pub action_label: String,
}

#[derive(Debug, Clone)]
pub struct SettingRow {
    pub label: String,
    pub value: String,
    pub hint: String,
}
