use crate::app_state::mock_data::PrototypeData;
use crate::app_state::{AppState, MainSection};
use crate::theme;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::shell::tabs;
use crate::ui::{chat, events, platforms, settings};
use gpui::{Context, Div, Entity, div, prelude::*};

pub(crate) fn panel(
    state: &AppState,
    data: &PrototypeData,
    state_entity: Entity<AppState>,
    cx: &mut Context<TwirChatApp>,
) -> Div {
    match state.active_section() {
        MainSection::Chat => div()
            .flex_1()
            .flex()
            .flex_col()
            .bg(theme::background())
            .child(tabs::bar(state, state_entity, data))
            .child(chat::panel(data, cx)),
        MainSection::Events => events::panel(data),
        MainSection::Platforms => platforms::panel(data),
        MainSection::Settings => settings::panel(data),
    }
}
