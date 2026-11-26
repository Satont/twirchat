# Chat pane header cleanup

Reworked the pane header after the Chatterino reference: the tab bar already names the
pane, so the header only states what is on air. Every decorative element that repeated
what the tab bar or the message list already showed is gone.

## What changed

- **No pane name, no "Live chat"**: the header no longer repeats the tab name or a
  platform/transport label; the tab bar carries naming, the header carries stream state.
  The header is also shorter (44 → 34 px).
- **No channel badges**: combined panes ("My channels", custom feeds) render their
  sources as plain comma-separated names. Platform icons, live dots and pill borders are
  gone from those chips; the per-channel hover card is replaced by the plain text.
- **Stream facts on one line**: live dot, viewer count, category and the stream title,
  separated by `·`; offline panes read "Offline". Category and title truncate with an
  ellipsis and never push the actions off the row.
- **Message rate removed**: the `msg/s` counter and its one-second repaint are gone,
  together with the `MessageRate` component.
- **Pinned banner is an icon**: a pin glyph plus `author: text`; the "Pinned ·" word is
  gone.
- **Header buttons are optional**: only pause and mentions stay pinned by default. Every
  other action (history, activities, whispers, filters, search, chatters, appearance)
  lives in the `⋯` menu, and Chat appearance → Header buttons lets the user pin any of
  them back into the toolbar. The new `chatHeaderActions` setting stores the pinned set;
  hidden actions are never unreachable — the menu always lists them.
- Split pane moved into the `⋯` menu next to change channel / open window / close panel;
  removing a plugin source from "My channels" also moved there.

## Verification

`bun run qa:chat-header` renders the pane on the isolated Xvfb display and asserts the
label, badges, rate removal, menu contents, pinning, appearance dialog and the home
header, then captures the screenshots in this folder.

Screenshots:

1. `01-channel-header.png` — channel pane: live dot, viewers, category, title.
2. `02-pinned-banner.png` — pinned message banner with the pin icon.
3. `03-actions-menu.png` — `⋯` menu with every hidden action.
4. `04-pinned-actions.png` — history/filters/search pinned back into the toolbar.
5. `05-header-buttons-settings.png` — Chat appearance → Header buttons.
6. `06-my-channels-header.png` — "My channels" with comma-separated source names.
