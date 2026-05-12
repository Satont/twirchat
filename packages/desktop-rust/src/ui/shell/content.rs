use crate::app_state::{AppState, MainSection};
use crate::ui::components::input::Input;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::shell::tabs;
use crate::ui::theme;
use crate::ui::{chat, events, platforms, settings};
use gpui::{Context, Div, Entity, div, prelude::*, px};

pub(crate) fn panel(
    state: &AppState,
    state_entity: Entity<AppState>,
    composer_input: Entity<Input>,
    add_channel_input: Entity<Input>,
    composer_text: String,
    cx: &mut Context<TwirChatApp>,
) -> Div {
    match state.active_section() {
        MainSection::Chat => div()
            .flex_1()
            .min_h(px(0.0))
            .relative()
            .flex()
            .flex_col()
            .bg(theme::background())
            .child(
                chat::panel(
                    state,
                    state_entity.clone(),
                    composer_input,
                    add_channel_input.clone(),
                    composer_text,
                    cx,
                )
                .mt(px(40.0)),
            )
            .child(
                div()
                    .absolute()
                    .top(px(0.0))
                    .left(px(0.0))
                    .right(px(0.0))
                    .child(tabs::bar(state, state_entity.clone(), add_channel_input)),
            ),
        MainSection::Events => events::panel(state),
        MainSection::Platforms => platforms::panel(&state.platforms_panel, state_entity.clone()),
        MainSection::Settings => settings::panel(state, state_entity.clone()),
    }
}
