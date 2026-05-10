use crate::models::{
    Account, ChannelTab, ChatMessage, Platform, PlatformCard, SettingRow, StreamChip, UiEvent,
};

pub fn accounts() -> Vec<Account> {
    vec![
        Account {
            platform: Platform::Kick,
            display_name: String::from("satont"),
            username: String::from("satont"),
            connected: true,
        },
        Account {
            platform: Platform::Twitch,
            display_name: String::from("justovich221337"),
            username: String::from("justovich221337"),
            connected: true,
        },
    ]
}

pub fn channel_tabs() -> Vec<ChannelTab> {
    vec![
        ChannelTab {
            id: String::from("home"),
            label: String::from("⌂ My channels"),
            platform: None,
            live: false,
            viewer_count: None,
        },
        ChannelTab {
            id: String::from("suhodolskiy"),
            label: String::from("K suhodolskiy"),
            platform: Some(Platform::Kick),
            live: false,
            viewer_count: None,
        },
        ChannelTab {
            id: String::from("dapzeroff"),
            label: String::from("K dapzeroff, dapzer"),
            platform: Some(Platform::Kick),
            live: false,
            viewer_count: None,
        },
    ]
}

pub fn header_chips() -> Vec<StreamChip> {
    vec![
        StreamChip {
            platform: Platform::Kick,
            channel_name: String::from("satont 9"),
            live: true,
            viewer_count: None,
        },
        StreamChip {
            platform: Platform::Twitch,
            channel_name: String::from("justovich221337"),
            live: false,
            viewer_count: None,
        },
    ]
}

pub fn chat_messages() -> Vec<ChatMessage> {
    let rows = [
        (
            Platform::Kick,
            "01:31:32",
            "Lanxre",
            vec![],
            "ну вообще да, надо посмотреть на финале",
            0xa855f7,
            false,
        ),
        (
            Platform::Kick,
            "01:32:00",
            "Lanxre",
            vec![],
            "но как же мне не нравится читать код на расте",
            0xa855f7,
            false,
        ),
        (
            Platform::Kick,
            "01:35:38",
            "Lanxre",
            vec![],
            "интересно, если есть прикол переписывать все на раст, то почему нет прикола переписи на го",
            0xa855f7,
            false,
        ),
        (
            Platform::Kick,
            "01:37:54",
            "zalupaslona7_5",
            vec![],
            "у раста комьюнити фанатиков ебнутых",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:39:50",
            "Fossabot",
            vec!["BOT"],
            "Tg: https://t.me/satontdev",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:41:13",
            "Lanxre",
            vec![],
            "cloudflare уже один раз обосрались",
            0xa855f7,
            false,
        ),
        (
            Platform::Kick,
            "01:41:14",
            "zalupaslona7_5",
            vec![],
            "а можно просто на с писать",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:41:19",
            "Lanxre",
            vec![],
            "я бы подумал два раза",
            0xa855f7,
            false,
        ),
        (
            Platform::Kick,
            "01:42:54",
            "zalupaslona7_5",
            vec![],
            "я имею ввиду вместо раста",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:43:09",
            "zalupaslona7_5",
            vec![],
            "а почему зиг",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:43:18",
            "zalupaslona7_5",
            vec![],
            "за зиг вообще не шарю",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:46:49",
            "Fossabot",
            vec!["BOT"],
            "donz99 just followed the stream! 💚",
            0x60a5fa,
            true,
        ),
        (
            Platform::Twitch,
            "01:49:19",
            "justovich221337",
            vec![],
            "!pc",
            0xd1d5db,
            false,
        ),
        (
            Platform::Kick,
            "01:49:20",
            "Satont",
            vec![],
            "!pc",
            0xffffff,
            false,
        ),
        (
            Platform::Kick,
            "01:49:21",
            "Fossabot",
            vec!["BOT"],
            "Motherboard: Asus Rog Strix B850E Gaming Wi‑Fi | CPU: AMD Ryzen 7 9800x3d | RAM: ADATA XPG Lancer d30 64GB 6000MHz",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:49:43",
            "zalupaslona7_5",
            vec![],
            "столько интересного софта используешь",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:49:54",
            "zalupaslona7_5",
            vec![],
            "фосса бот какой то)",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:50:03",
            "boolshit",
            vec![],
            "а почему fossabot а не twir",
            0x22c55e,
            false,
        ),
        (
            Platform::Kick,
            "01:50:08",
            "Fossabot",
            vec!["BOT"],
            "Tg: https://t.me/satontdev",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:50:53",
            "zalupaslona7_5",
            vec![],
            "👍",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:51:53",
            "zalupaslona7_5",
            vec![],
            "а ты какие то скилы юзаешь?",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:52:37",
            "zalupaslona7_5",
            vec![],
            "скил для vlq это лол",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:53:46",
            "zalupaslona7_5",
            vec![],
            "хз а в чем заключаются этот скил",
            0x60a5fa,
            false,
        ),
        (
            Platform::Kick,
            "01:54:47",
            "Lanxre",
            vec![],
            "🙂",
            0xa855f7,
            false,
        ),
        (
            Platform::Kick,
            "01:55:28",
            "Lanxre",
            vec![],
            "ахахаха",
            0xa855f7,
            false,
        ),
        (
            Platform::Kick,
            "01:55:41",
            "Lanxre",
            vec![],
            "без икончек",
            0xa855f7,
            false,
        ),
        (
            Platform::Kick,
            "01:55:43",
            "zalupaslona7_5",
            vec![],
            "хз, новые модели вроде по таким технологиям",
            0x60a5fa,
            false,
        ),
    ];

    let mut messages = Vec::new();

    for round in 0..5 {
        for (platform, timestamp, author, badges, text, color, system) in &rows {
            messages.push(ChatMessage {
                platform: *platform,
                timestamp: String::from(*timestamp),
                author: String::from(*author),
                badges: badges.iter().map(|badge| String::from(*badge)).collect(),
                text: if round == 0 || *system {
                    String::from(*text)
                } else {
                    format!("{text} · {round}")
                },
                author_color_hex: *color,
                system: *system,
            })
        }
    }

    messages
}

pub fn events() -> Vec<UiEvent> {
    vec![
        UiEvent {
            platform: Platform::Twitch,
            title: String::from("New follow"),
            detail: String::from("donz99 followed the channel"),
            accent_hex: 0x22c55e,
            timestamp: String::from("01:46"),
        },
        UiEvent {
            platform: Platform::Kick,
            title: String::from("Raid"),
            detail: String::from("zalupaslona7_5 joined the stream"),
            accent_hex: 0x3b82f6,
            timestamp: String::from("01:31"),
        },
    ]
}

pub fn platform_cards() -> Vec<PlatformCard> {
    vec![
        PlatformCard {
            platform: Platform::Kick,
            display_name: String::from("satont"),
            username: String::from("@satont"),
            status: String::from("Connected"),
            joined_channel: String::from("#satont"),
            action_label: String::from("Disconnect"),
        },
        PlatformCard {
            platform: Platform::Twitch,
            display_name: String::from("justovich221337"),
            username: String::from("@justovich221337"),
            status: String::from("Connected"),
            joined_channel: String::from("#justovich221337"),
            action_label: String::from("Disconnect"),
        },
    ]
}

pub fn settings() -> Vec<SettingRow> {
    vec![
        SettingRow {
            label: String::from("Theme"),
            value: String::from("Dark"),
            hint: String::from("Palette matches the current desktop app"),
        },
        SettingRow {
            label: String::from("Font family"),
            value: String::from("Inter"),
            hint: String::from("Main chat typography is compact and dark"),
        },
        SettingRow {
            label: String::from("Composer"),
            value: String::from("Compact"),
            hint: String::from("Dense footer layout with chip targets and send action"),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::{channel_tabs, chat_messages};

    #[test]
    fn mock_tabs_include_home() {
        assert!(channel_tabs().iter().any(|tab| tab.id == "home"));
    }

    #[test]
    fn mock_messages_are_non_empty() {
        let messages = chat_messages();
        assert!(!messages.is_empty());
        assert_eq!(messages[0].timestamp, "01:31:32");
    }
}
