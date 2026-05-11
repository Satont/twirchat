use crate::app_state::{AppState, MainSection};
use crate::storage::watched_layout::create_default_tab_layout;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::shell::tabs;
use crate::ui::theme;
use crate::ui::{chat, events, platforms, settings};
use gpui::{Context, Div, Entity, div, prelude::*};

pub(crate) fn panel(
    state: &AppState,
    state_entity: Entity<AppState>,
    cx: &mut Context<TwirChatApp>,
) -> Div {
    match state.active_section() {
        MainSection::Chat => {
            let active_id = state.active_channel_tab_id();

            // Home tab should only render chat, not a watched layout
            let chat_content = if active_id == "home" {
                chat::panel(state, cx)
            } else {
                let _layout = create_default_tab_layout(active_id);
                div()
                    .flex_1()
                    .w_full()
                    .flex()
                    .flex_row()
                    .child(chat::panel(state, cx))
                // .child(render_layout(&_layout)) // TEMPORARILY DISABLED for remediation
            };

            div()
                .flex_1()
                .flex()
                .flex_col()
                .bg(theme::background())
                .child(tabs::bar(state, state_entity.clone()))
                .child(chat_content)
        }
        MainSection::Events => events::panel(),
        MainSection::Platforms => platforms::panel(&state.platforms_panel),
        MainSection::Settings => settings::panel(),
    }
}
