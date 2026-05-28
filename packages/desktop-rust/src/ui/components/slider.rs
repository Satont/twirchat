use crate::ui::theme;
use gpui::*;
use std::rc::Rc;
use ui::FluentBuilder;

type SliderCallback = Rc<dyn Fn(f64, &mut Window, &mut App) + 'static>;

const DEFAULT_MIN: f64 = 0.0;
const DEFAULT_MAX: f64 = 100.0;
const DEFAULT_STEP: f64 = 1.0;

#[derive(Clone)]
struct SliderDrag;

pub struct Slider {
    id: String,
    value: f64,
    min: f64,
    max: f64,
    step: f64,
    on_change: Option<SliderCallback>,
}

impl Slider {
    pub fn new(id: impl Into<String>, value: f64) -> Self {
        Self {
            id: id.into(),
            value,
            min: DEFAULT_MIN,
            max: DEFAULT_MAX,
            step: DEFAULT_STEP,
            on_change: None,
        }
    }

    pub fn range(mut self, min: f64, max: f64, step: f64) -> Self {
        self.min = min;
        self.max = max.max(min);
        self.step = if step.is_finite() && step > 0.0 {
            step
        } else {
            DEFAULT_STEP
        };
        self
    }

    pub fn on_change(mut self, callback: impl Fn(f64, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(callback));
        self
    }
}

impl RenderOnce for Slider {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        self
    }
}

impl IntoElement for Slider {
    type Element = AnyElement;

    fn into_element(self) -> Self::Element {
        let values = slider_values(self.min, self.max, self.step);
        let active_value = snap_slider_value(self.value, self.min, self.max, self.step);
        let active_index = values
            .iter()
            .position(|value| (*value - active_value).abs() < f64::EPSILON)
            .unwrap_or(0);
        let on_change = self.on_change;
        let drag_callback = on_change.clone();
        let min = self.min;
        let max = self.max;
        let step = self.step;

        div()
            .id(self.id)
            .w_full()
            .h(px(18.0))
            .flex()
            .flex_row()
            .items_center()
            .cursor_pointer()
            .on_drag(SliderDrag, |_, _, _, cx| cx.new(|_| Empty))
            .on_drag_move::<SliderDrag>(move |event, window, app| {
                if let Some(callback) = &drag_callback {
                    callback(
                        slider_value_for_position(
                            event.event.position,
                            event.bounds,
                            min,
                            max,
                            step,
                        ),
                        window,
                        app,
                    );
                }
            })
            .children(values.into_iter().enumerate().map(move |(index, value)| {
                let callback = on_change.clone();

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
                            callback(value, window, app);
                        }
                    })
            }))
            .into_any_element()
    }
}

pub(crate) fn snap_slider_value(value: f64, min: f64, max: f64, step: f64) -> f64 {
    let safe_step = if step.is_finite() && step > 0.0 {
        step
    } else {
        DEFAULT_STEP
    };
    let safe_max = max.max(min);
    let clamped = value.clamp(min, safe_max);
    let steps = ((clamped - min) / safe_step).round();
    (min + steps * safe_step).clamp(min, safe_max)
}

fn slider_value_for_position(
    position: Point<Pixels>,
    bounds: Bounds<Pixels>,
    min: f64,
    max: f64,
    step: f64,
) -> f64 {
    let width = bounds.right() - bounds.left();
    if width <= px(0.0) {
        return snap_slider_value(min, min, max, step);
    }

    let ratio = f64::from((position.x - bounds.left()) / width);
    slider_value_for_ratio(ratio, min, max, step)
}

pub(crate) fn slider_value_for_ratio(ratio: f64, min: f64, max: f64, step: f64) -> f64 {
    let safe_max = max.max(min);
    let clamped_ratio = if ratio.is_finite() {
        ratio.clamp(0.0, 1.0)
    } else {
        0.0
    };

    snap_slider_value(min + (safe_max - min) * clamped_ratio, min, safe_max, step)
}

fn slider_values(min: f64, max: f64, step: f64) -> Vec<f64> {
    let safe_step = if step.is_finite() && step > 0.0 {
        step
    } else {
        DEFAULT_STEP
    };
    let safe_max = max.max(min);
    let step_count = ((safe_max - min) / safe_step).round() as usize;

    (0..=step_count)
        .map(|index| (min + index as f64 * safe_step).min(safe_max))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{slider_value_for_ratio, snap_slider_value};

    #[test]
    fn snap_slider_value_clamps_and_rounds_to_step() {
        assert_eq!(snap_slider_value(9.4, 10.0, 30.0, 1.0), 10.0);
        assert_eq!(snap_slider_value(17.6, 10.0, 30.0, 1.0), 18.0);
        assert_eq!(snap_slider_value(31.0, 10.0, 30.0, 1.0), 30.0);
    }

    #[test]
    fn slider_value_for_ratio_maps_drag_position_to_range() {
        assert_eq!(slider_value_for_ratio(0.0, 10.0, 30.0, 1.0), 10.0);
        assert_eq!(slider_value_for_ratio(0.5, 10.0, 30.0, 1.0), 20.0);
        assert_eq!(slider_value_for_ratio(1.0, 10.0, 30.0, 1.0), 30.0);
        assert_eq!(slider_value_for_ratio(2.0, 10.0, 30.0, 1.0), 30.0);
    }
}
