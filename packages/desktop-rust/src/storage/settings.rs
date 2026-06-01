use crate::protocol::types::{
    AppSettings, AppTheme, ChatLayout, ChatLayoutMode, ChatTheme, FontFamilyChoice, HotkeySettings,
    OverlayAnimation, OverlayConfig, OverlayPosition, PlatformFilter, SelfPingConfig, SplitConfig,
    SplitConfigType,
};
use crate::runtime::DEFAULT_OVERLAY_SERVER_PORT;
use crate::storage::db::{Connection, Param};
use crate::storage::{StorageResult, merge_json};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub struct SettingsStore<'a> {
    conn: &'a Connection,
}

impl<'a> SettingsStore<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn get_app_settings(&self) -> StorageResult<AppSettings> {
        self.get_json("app_settings")
            .map(|value| value_to_settings(value.as_ref()))
    }

    pub fn set_app_settings(&self, settings: &AppSettings) -> StorageResult<()> {
        self.set_json("app_settings", &serde_json::to_value(settings)?)
    }

    pub fn get_chat_layout(&self) -> StorageResult<ChatLayout> {
        self.get_json("chat_layout")
            .map(|value| value_to_chat_layout(value.as_ref()))
    }

    pub fn set_chat_layout(&self, layout: &ChatLayout) -> StorageResult<()> {
        self.set_json("chat_layout", &serde_json::to_value(layout)?)
    }

    pub fn get_tab_channel_ids(&self) -> StorageResult<Option<Vec<String>>> {
        match self.get_json("tab_channel_ids")? {
            Some(Value::Array(values)) => Ok(Some(
                values
                    .into_iter()
                    .filter_map(|value| value.as_str().map(str::to_string))
                    .collect(),
            )),
            Some(_) | None => Ok(None),
        }
    }

    pub fn set_tab_channel_ids(&self, ids: &[String]) -> StorageResult<()> {
        self.set_json("tab_channel_ids", &json!(ids))
    }

    pub fn get_watched_tab_custom_names(&self) -> StorageResult<BTreeMap<String, String>> {
        match self.get_json("watched_tab_custom_names")? {
            Some(value) => serde_json::from_value::<BTreeMap<String, String>>(value)
                .map_err(crate::storage::StorageError::from),
            None => Ok(BTreeMap::new()),
        }
    }

    pub fn set_watched_tab_custom_name(
        &self,
        tab_id: &str,
        name: Option<&str>,
    ) -> StorageResult<()> {
        let mut names = self.get_watched_tab_custom_names()?;
        match name.map(str::trim).filter(|name| !name.is_empty()) {
            Some(name) => {
                names.insert(tab_id.to_string(), name.to_string());
            }
            None => {
                names.remove(tab_id);
            }
        }
        self.set_json("watched_tab_custom_names", &json!(names))
    }

    pub(crate) fn get_json(&self, key: &str) -> StorageResult<Option<Value>> {
        let row = self.conn.query_one(
            "SELECT value FROM settings WHERE key = ? LIMIT 1",
            &[Param::Text(key)],
        )?;
        match row {
            Some(row) => match serde_json::from_str::<Value>(&row.text("value")?) {
                Ok(value) => Ok(Some(value)),
                Err(_) => Ok(None),
            },
            None => Ok(None),
        }
    }

    pub(crate) fn set_json(&self, key: &str, value: &Value) -> StorageResult<()> {
        let text = serde_json::to_string(value)?;
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            &[Param::Text(key), Param::Text(&text)],
        )?;
        Ok(())
    }
}

pub fn default_chat_layout() -> ChatLayout {
    ChatLayout {
        version: 1,
        mode: ChatLayoutMode::Combined,
        splits: vec![SplitConfig {
            id: "default".into(),
            split_type: SplitConfigType::Combined,
            channel_id: None,
            size: 100.0,
        }],
    }
}

pub fn default_app_settings() -> AppSettings {
    AppSettings {
        theme: AppTheme::Dark,
        chat_theme: ChatTheme::Modern,
        font_family: FontFamilyChoice::Inter,
        font_size: 14.0,
        show_platform_color_stripe: true,
        show_platform_icon: true,
        show_timestamp: true,
        show_avatars: true,
        show_badges: true,
        platform_filter: PlatformFilter::All("all".into()),
        hotkeys: HotkeySettings {
            new_tab: "ctrl+t".into(),
            next_tab: "ctrl+tab".into(),
            prev_tab: "alt+arrowleft".into(),
            tab_selector: "ctrl+l".into(),
        },
        overlay: OverlayConfig {
            background: "transparent".into(),
            text_color: "#ffffff".into(),
            font_size: 14.0,
            font_family: "inter".into(),
            max_messages: 20,
            message_timeout: 0,
            show_platform_icon: true,
            show_avatar: true,
            show_badges: true,
            animation: OverlayAnimation::Slide,
            position: OverlayPosition::Bottom,
            port: DEFAULT_OVERLAY_SERVER_PORT,
        },
        auto_check_updates: Some(true),
        chat_layout: Some(default_chat_layout()),
        self_ping: Some(SelfPingConfig {
            enabled: true,
            color: "rgba(167, 139, 250, 0.15)".into(),
        }),
    }
}

fn value_to_settings(value: Option<&Value>) -> AppSettings {
    let default = default_app_settings();
    let Ok(mut merged) = serde_json::to_value(&default) else {
        return default;
    };
    if let Some(value) = value {
        merge_json(&mut merged, value);
    }
    serde_json::from_value(merged)
        .ok()
        .map_or(default, |value| value)
}

fn value_to_chat_layout(value: Option<&Value>) -> ChatLayout {
    let default = default_chat_layout();
    let Ok(mut merged) = serde_json::to_value(&default) else {
        return default;
    };
    if let Some(value) = value {
        merge_json(&mut merged, value);
    }
    serde_json::from_value(merged)
        .ok()
        .map_or(default, |value| value)
}

#[cfg(test)]
mod tests {
    use super::value_to_settings;
    use serde_json::json;

    #[test]
    fn partial_settings_deep_merge_with_defaults() {
        let settings = value_to_settings(Some(&json!({ "overlay": { "maxMessages": 5 } })));
        assert_eq!(settings.overlay.max_messages, 5);
        assert_eq!(settings.overlay.port, 45823);
    }
}
