# Combined viewers on My channels

The previous header cleanup (#281) reduced a combined pane ("My channels", a custom feed)
to a comma-separated list of source names: the pane no longer said how many people watch
or whether anything is on air. The aggregated counter is back, next to those names.

## What changed

- **One number for the pane**: live viewers of every source are added up and shown once
  (`1.2K`) with a live dot, followed by a short `на стриме` / `on live` label that names
  how many sources stream now.
- **Same channel on two platforms counts once** (`twitch:satont` + `kick:satont` are one
  broadcaster; the Twitch login wins), so a multistream is not double counted.
- **Platforms without viewer counts** (YouTube, VK Play, plugin transports) only add to the
  live tally. A plugin source counts as live until its transport reports `error` /
  `disconnected`.
- **Nothing on air → nothing shown**: an empty total would read as "0 watching", so the
  counter disappears instead.
- **Single channel panes are unchanged**: they keep the detailed line (dot, viewers,
  category, title).
- Streamer mode's "hide viewer count and duration" still hides the number; the live
  tally stays visible.

Aggregation lives in `packages/desktop/src/gpuix/state/channel-viewers.ts` and is covered by
`packages/desktop/tests/channel-viewers.test.ts`.

## Verification

`bun run qa:chat-header` (isolated Xvfb display) renders both the channel pane and the
"My channels" pane; it asserts the aggregated total appears on the home header.

Screenshots:

1. `home-viewers.png` — "My channels" with `satont, oceanofapathy, streamx · 1.2K на стриме`.
2. `channel-viewers.png` — a single channel pane, unchanged detail line.
