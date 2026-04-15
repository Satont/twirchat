use crate::{
    AppError, AppSettings, ChatLayout, ChatLayoutMode, ChatTheme, FontFamily, HotkeySettings,
    OverlayAnimation, OverlayConfig, OverlayPosition, PlatformFilter, SelfPingConfig, SplitConfig,
    SplitConfigType, Theme,
};
use rusqlite::Connection;

const SETTINGS_KEY: &str = "app_settings";

fn default_settings() -> AppSettings {
    AppSettings {
        theme: Theme::Dark,
        chat_theme: ChatTheme::Modern,
        font_family: FontFamily::Inter,
        font_size: 14.0,
        show_platform_color_stripe: true,
        show_platform_icon: true,
        show_timestamp: true,
        show_avatars: true,
        show_badges: true,
        platform_filter: PlatformFilter::All,
        hotkeys: HotkeySettings {
            new_tab: "ctrl+t".to_owned(),
            next_tab: "ctrl+tab".to_owned(),
            prev_tab: "alt+arrowleft".to_owned(),
            tab_selector: "ctrl+l".to_owned(),
        },
        overlay: OverlayConfig {
            background: "transparent".to_owned(),
            text_color: "#ffffff".to_owned(),
            font_size: 14.0,
            font_family: "inter".to_owned(),
            max_messages: 20,
            message_timeout: 0,
            show_platform_icon: true,
            show_avatar: true,
            show_badges: true,
            animation: OverlayAnimation::Slide,
            position: OverlayPosition::Bottom,
            port: 45823,
        },
        auto_check_updates: Some(true),
        chat_layout: Some(ChatLayout {
            version: 1,
            mode: ChatLayoutMode::Combined,
            splits: vec![SplitConfig {
                id: "default".to_owned(),
                split_type: SplitConfigType::Combined,
                channel_id: None,
                size: 100.0,
            }],
        }),
        self_ping: Some(SelfPingConfig {
            enabled: true,
            color: "rgba(167, 139, 250, 0.15)".to_owned(),
        }),
    }
}

fn deep_merge(base: AppSettings, partial: serde_json::Value) -> AppSettings {
    let base_val = serde_json::to_value(&base).unwrap_or(serde_json::Value::Null);
    let merged = merge_values(base_val, partial);
    serde_json::from_value(merged).unwrap_or(base)
}

fn merge_values(base: serde_json::Value, patch: serde_json::Value) -> serde_json::Value {
    match (base, patch) {
        (serde_json::Value::Object(mut b), serde_json::Value::Object(p)) => {
            for (k, v) in p {
                let entry = b.entry(k).or_insert(serde_json::Value::Null);
                *entry = merge_values(entry.clone(), v);
            }
            serde_json::Value::Object(b)
        }
        (_, patch) => patch,
    }
}

/// Returns the stored `AppSettings`, deep-merged with defaults for any missing fields.
///
/// # Errors
///
/// Returns [`AppError::Database`] on SQL failure.
pub fn get(conn: &Connection) -> Result<AppSettings, AppError> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?")?;
    let mut rows = stmt.query([SETTINGS_KEY])?;

    let defaults = default_settings();

    let Some(row) = rows.next()? else {
        return Ok(defaults);
    };

    let json: String = row.get(0)?;
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap_or(serde_json::Value::Null);
    Ok(deep_merge(defaults, parsed))
}

/// Persists `settings` as JSON, replacing any existing entry.
///
/// # Errors
///
/// Returns [`AppError::Database`] or [`AppError::Serde`] on failure.
pub fn update(conn: &Connection, settings: &AppSettings) -> Result<(), AppError> {
    let json = serde_json::to_string(settings)?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![SETTINGS_KEY, json],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::db;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .expect("pragmas");
        db::init_db(&conn).expect("init_db");
        conn
    }

    #[test]
    fn get_returns_defaults_when_empty() {
        let conn = setup();
        let settings = get(&conn).expect("get settings");
        assert_eq!(settings.font_size, 14.0);
        assert!(settings.show_avatars);
    }

    #[test]
    fn update_then_get_round_trips() {
        let conn = setup();
        let mut s = default_settings();
        s.font_size = 18.0;
        s.show_avatars = false;
        update(&conn, &s).expect("update");
        let loaded = get(&conn).expect("get");
        assert_eq!(loaded.font_size, 18.0);
        assert!(!loaded.show_avatars);
    }

    #[test]
    fn update_is_idempotent() {
        let conn = setup();
        let s = default_settings();
        update(&conn, &s).expect("first update");
        update(&conn, &s).expect("second update should not error");
        let all: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0))
            .expect("count");
        assert_eq!(all, 1);
    }

    #[test]
    fn get_merges_missing_fields_with_defaults() {
        let conn = setup();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('app_settings', '{\"fontSize\": 20}')",
            [],
        )
        .expect("insert partial");
        let settings = get(&conn).expect("get");
        assert_eq!(settings.font_size, 20.0);
        assert!(settings.show_avatars, "missing field should use default");
    }
}
