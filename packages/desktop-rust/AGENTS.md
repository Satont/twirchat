# TwirChat Desktop Rust / GPUI Notes

## GPUI component references

- It is acceptable to use https://longbridge.github.io/gpui-component/ as a visual/API reference, but adapt components to this codebase instead of copying them wholesale.
- Keep state in GPUI `Entity<T>` models and call `cx.notify()` after state changes.

## Text input

- Real editable text fields must use GPUI input plumbing: `EntityInputHandler`, `ElementInputHandler`, a `FocusHandle`, `track_focus`, and app-level `KeyBinding`s.
- Do not implement text fields as static `div()` placeholders with click callbacks; that cannot type, move the cursor, or select text.
- Bind common input actions explicitly for the input key context, including backspace/delete, left/right, shift-left/shift-right, and ctrl/cmd-a.

## Images

- Use GPUI image primitives for avatars, badges, and platform icons: `gpui::{img, ImageSource, ObjectFit}`.
- For remote URLs, pass `ImageSource::from(url)` to `img(...)` and set `.object_fit(ObjectFit::Cover)` for avatars or `.object_fit(ObjectFit::Contain)` for icons/badges.
- Always provide `.with_loading(...)` and `.with_fallback(...)` for avatars so pending/failed images do not render as blank circles.
- Keep an image cache mounted near the app root with `retain_all(...)` when a screen renders repeated remote images.
