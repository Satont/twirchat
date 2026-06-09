use crate::protocol::types::Platform;
use crate::ui::theme;
use gpui::*;
use std::rc::Rc;
use ui::FluentBuilder;

type LogSliderCallback = Rc<dyn Fn(u32, &mut Window, &mut App) + 'static>;

const TWITCH_MIN_SECONDS: u32 = 1;
const TWITCH_MAX_SECONDS: u32 = 1_209_600; // 14 days
const KICK_MIN_SECONDS: u32 = 60; // 1 minute
const KICK_MAX_SECONDS: u32 = 604_800; // 7 days
const SEGMENT_COUNT: usize = 25;

#[derive(Clone)]
struct LogSliderDrag;

pub struct LogSlider {
    id: String,
    value_seconds: u32,
    platform: Platform,
    on_change: Option<LogSliderCallback>,
}

impl LogSlider {
    pub fn new(id: impl Into<String>, value_seconds: u32) -> Self {
        Self {
            id: id.into(),
            value_seconds,
            platform: Platform::Twitch,
            on_change: None,
        }
    }

    pub fn platform(mut self, platform: Platform) -> Self {
        self.platform = platform;
        self
    }

    pub fn on_change(mut self, callback: impl Fn(u32, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(callback));
        self
    }
}

fn platform_range(platform: Platform) -> (u32, u32) {
    match platform {
        Platform::Twitch => (TWITCH_MIN_SECONDS, TWITCH_MAX_SECONDS),
        Platform::Kick => (KICK_MIN_SECONDS, KICK_MAX_SECONDS),
        Platform::Youtube => (0, 0),
    }
}

fn log_slider_value_for_position(position: f64, min: u32, max: u32) -> u32 {
    if min == 0 || max == 0 || min >= max {
        return min;
    }
    let clamped_position = if position.is_nan() {
        0.0
    } else {
        position.clamp(0.0, 1.0)
    };
    let ratio = (max as f64) / (min as f64);
    let value = (min as f64) * ratio.powf(clamped_position);
    (value.round() as u32).clamp(min, max)
}

fn log_slider_position_for_value(value: u32, min: u32, max: u32) -> f64 {
    if min == 0 || max == 0 || min >= max {
        return 0.0;
    }
    let clamped = value.clamp(min, max);
    if clamped <= min {
        return 0.0;
    }
    let ratio = (max as f64) / (min as f64);
    let position = ((clamped as f64) / (min as f64)).ln() / ratio.ln();
    position.clamp(0.0, 1.0)
}

impl RenderOnce for LogSlider {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        self
    }
}

impl IntoElement for LogSlider {
    type Element = AnyElement;

    fn into_element(self) -> Self::Element {
        let (min, max) = platform_range(self.platform);

        // YouTube has no duration range — render disabled
        if min == 0 && max == 0 {
            return div()
                .id(self.id)
                .w_full()
                .h(px(18.0))
                .flex()
                .flex_row()
                .items_center()
                .opacity(0.3)
                .cursor_default()
                .children((0..SEGMENT_COUNT).map(|_| {
                    div()
                        .flex_1()
                        .h(px(18.0))
                        .relative()
                        .flex()
                        .items_center()
                        .child(
                            div()
                                .w_full()
                                .h(px(4.0))
                                .bg(theme::surface_2())
                                .border_1()
                                .border_color(theme::border())
                                .rounded(px(2.0)),
                        )
                }))
                .into_any_element();
        }

        let clamped_value = self.value_seconds.clamp(min, max);
        let active_position = log_slider_position_for_value(clamped_value, min, max);
        let active_index = (active_position * SEGMENT_COUNT as f64).round() as usize;
        let active_index = active_index.min(SEGMENT_COUNT - 1);
        let on_change = self.on_change;
        let drag_callback = on_change.clone();

        div()
            .id(self.id)
            .w_full()
            .h(px(18.0))
            .flex()
            .flex_row()
            .items_center()
            .cursor_pointer()
            .on_drag(LogSliderDrag, |_, _, _, cx| cx.new(|_| Empty))
            .on_drag_move::<LogSliderDrag>(move |event, window, app| {
                if let Some(callback) = &drag_callback {
                    let width = event.bounds.right() - event.bounds.left();
                    if width > px(0.0) {
                        let ratio =
                            f64::from((event.event.position.x - event.bounds.left()) / width);
                        let clamped_ratio = if ratio.is_finite() {
                            ratio.clamp(0.0, 1.0)
                        } else {
                            0.0
                        };
                        let new_value = log_slider_value_for_position(clamped_ratio, min, max);
                        callback(new_value, window, app);
                    }
                }
            })
            .children((0..SEGMENT_COUNT).enumerate().map(move |(index, _)| {
                let callback = on_change.clone();
                let segment_position = index as f64 / (SEGMENT_COUNT - 1) as f64;
                let segment_value = log_slider_value_for_position(segment_position, min, max);

                div()
                    .flex_1()
                    .h(px(18.0))
                    .relative()
                    .flex()
                    .items_center()
                    .child(
                        div()
                            .w_full()
                            .h(px(4.0))
                            .bg(if index <= active_index {
                                theme::text_muted()
                            } else {
                                theme::surface_2()
                            })
                            .border_1()
                            .border_color(theme::border())
                            .rounded(px(2.0)),
                    )
                    .when(index == active_index, |el| {
                        el.child(
                            div()
                                .absolute()
                                .top(px(4.0))
                                .left(px(0.0))
                                .right(px(0.0))
                                .flex()
                                .justify_center()
                                .child(
                                    div()
                                        .w(px(10.0))
                                        .h(px(10.0))
                                        .rounded_full()
                                        .bg(theme::text_primary())
                                        .border_1()
                                        .border_color(theme::border())
                                        .shadow_sm(),
                                ),
                        )
                    })
                    .on_mouse_down(MouseButton::Left, move |_event, window, app| {
                        if let Some(callback) = &callback {
                            callback(segment_value, window, app);
                        }
                    })
            }))
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        KICK_MAX_SECONDS, KICK_MIN_SECONDS, TWITCH_MAX_SECONDS, TWITCH_MIN_SECONDS,
        log_slider_position_for_value, log_slider_value_for_position, platform_range,
    };
    use crate::protocol::types::Platform;

    #[::core::prelude::rust_2021::test]
    fn position_zero_returns_min() {
        assert_eq!(
            log_slider_value_for_position(0.0, TWITCH_MIN_SECONDS, TWITCH_MAX_SECONDS),
            TWITCH_MIN_SECONDS
        );
        assert_eq!(
            log_slider_value_for_position(0.0, KICK_MIN_SECONDS, KICK_MAX_SECONDS),
            KICK_MIN_SECONDS
        );
    }

    #[::core::prelude::rust_2021::test]
    fn position_one_returns_max() {
        assert_eq!(
            log_slider_value_for_position(1.0, TWITCH_MIN_SECONDS, TWITCH_MAX_SECONDS),
            TWITCH_MAX_SECONDS
        );
        assert_eq!(
            log_slider_value_for_position(1.0, KICK_MIN_SECONDS, KICK_MAX_SECONDS),
            KICK_MAX_SECONDS
        );
    }

    #[::core::prelude::rust_2021::test]
    fn position_half_returns_geometric_mean() {
        // position 0.5 ≈ sqrt(min * max) (geometric mean)
        let twitch_mid = log_slider_value_for_position(0.5, TWITCH_MIN_SECONDS, TWITCH_MAX_SECONDS);
        let expected_twitch = (TWITCH_MIN_SECONDS as f64 * TWITCH_MAX_SECONDS as f64).sqrt();
        assert!(
            (twitch_mid as f64 - expected_twitch).abs() <= 1.0,
            "twitch mid: got {twitch_mid}, expected ~{expected_twitch}"
        );

        let kick_mid = log_slider_value_for_position(0.5, KICK_MIN_SECONDS, KICK_MAX_SECONDS);
        let expected_kick = (KICK_MIN_SECONDS as f64 * KICK_MAX_SECONDS as f64).sqrt();
        assert!(
            (kick_mid as f64 - expected_kick).abs() <= 1.0,
            "kick mid: got {kick_mid}, expected ~{expected_kick}"
        );
    }

    #[::core::prelude::rust_2021::test]
    fn value_clamping_at_boundaries() {
        // Value below min clamps to min
        assert_eq!(
            log_slider_position_for_value(0, TWITCH_MIN_SECONDS, TWITCH_MAX_SECONDS),
            0.0
        );
        // Value above max clamps to 1.0
        let pos = log_slider_position_for_value(
            TWITCH_MAX_SECONDS + 1,
            TWITCH_MIN_SECONDS,
            TWITCH_MAX_SECONDS,
        );
        assert!((pos - 1.0).abs() < f64::EPSILON);
    }

    #[::core::prelude::rust_2021::test]
    fn platform_specific_ranges() {
        // Twitch: 1s to 14 days
        let (twitch_min, twitch_max) = platform_range(Platform::Twitch);
        assert_eq!(twitch_min, 1);
        assert_eq!(twitch_max, 1_209_600);

        // Kick: 1 minute to 7 days
        let (kick_min, kick_max) = platform_range(Platform::Kick);
        assert_eq!(kick_min, 60);
        assert_eq!(kick_max, 604_800);

        // YouTube: no range (disabled)
        let (yt_min, yt_max) = platform_range(Platform::Youtube);
        assert_eq!(yt_min, 0);
        assert_eq!(yt_max, 0);
    }

    #[::core::prelude::rust_2021::test]
    fn round_trip_position_to_value_and_back() {
        // For several positions, verify value → position → value round-trips
        for position in [0.0, 0.25, 0.5, 0.75, 1.0] {
            let value =
                log_slider_value_for_position(position, TWITCH_MIN_SECONDS, TWITCH_MAX_SECONDS);
            let recovered =
                log_slider_position_for_value(value, TWITCH_MIN_SECONDS, TWITCH_MAX_SECONDS);
            assert!(
                (recovered - position).abs() < 0.01,
                "round-trip failed: position {position} → value {value} → recovered {recovered}"
            );
        }
    }

    #[::core::prelude::rust_2021::test]
    fn nan_and_infinity_inputs_are_safe() {
        // NaN and infinity positions should return min
        assert_eq!(
            log_slider_value_for_position(f64::NAN, TWITCH_MIN_SECONDS, TWITCH_MAX_SECONDS),
            TWITCH_MIN_SECONDS
        );
        assert_eq!(
            log_slider_value_for_position(f64::INFINITY, TWITCH_MIN_SECONDS, TWITCH_MAX_SECONDS),
            TWITCH_MAX_SECONDS
        );
        assert_eq!(
            log_slider_value_for_position(
                f64::NEG_INFINITY,
                TWITCH_MIN_SECONDS,
                TWITCH_MAX_SECONDS
            ),
            TWITCH_MIN_SECONDS
        );
    }

    #[::core::prelude::rust_2021::test]
    fn zero_range_returns_min() {
        // YouTube has no range — functions should return min (0)
        assert_eq!(log_slider_value_for_position(0.5, 0, 0), 0);
        assert_eq!(log_slider_position_for_value(100, 0, 0), 0.0);
    }

    #[::core::prelude::rust_2021::test]
    fn inverted_range_returns_min() {
        // If max < min, return min safely
        assert_eq!(log_slider_value_for_position(0.5, 100, 10), 100);
        assert_eq!(log_slider_position_for_value(50, 100, 10), 0.0);
    }
}
