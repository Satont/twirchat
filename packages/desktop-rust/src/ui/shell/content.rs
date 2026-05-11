use crate::app_state::mock_data::PrototypeData;
use crate::app_state::{AppState, MainSection};
use crate::storage::watched_layout::create_default_tab_layout;
use crate::ui::components::watched_layout::render_layout;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::shell::tabs;
use crate::ui::theme;
use crate::ui::{chat, events, platforms, settings};
use gpui::{Context, Div, Entity, div, prelude::*};

pub(crate) fn panel(
    state: &AppState,
    data: &PrototypeData,
    state_entity: Entity<AppState>,
    cx: &mut Context<TwirChatApp>,
) -> Div {
    match state.active_section() {
        MainSection::Chat => {
            let active_id = state.active_channel_tab_id();
            let layout = create_default_tab_layout(active_id);
            div()
                .flex_1()
                .flex()
                .flex_col()
                .bg(theme::background())
                .child(tabs::bar(state, state_entity.clone(), data))
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .flex_row()
                        .child(chat::panel(data, cx))
                        .child(render_layout(&layout)),
                )
        }
        MainSection::Events => events::panel(data),
        MainSection::Platforms => platforms::panel(data),
        MainSection::Settings => settings::panel(data),
    }
}
