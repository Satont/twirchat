# Combined-feed membership notices

In a combined feed every row gets a source chip so viewers can tell the source channels apart.
Twitch join and part notices rendered that chip on a line of its own above the notice, so each
membership event took two lines and the feed became noisy when several sources were active.

`TwitchChatNotice` now accepts the feed source chip and renders it inside the membership row.
`ChatMessage` passes the chip only for `join` and `part`; other Twitch notices keep the header
above the notice because they carry a title, icon and optional detail line.

## Before

Modern: the chip sits above the timestamp and `Users joined` text.

![Before: membership notice uses two lines](modern-before.png)

Compact: the same two-line stack, with the chip breaking the timestamp column rhythm.

![Before: compact membership notice uses two lines](compact-before.png)

## After

Modern: timestamp, chip and notice share one line.

![After: modern membership notice is one line](modern-after.png)

Compact: the chip follows the timestamp column and the notice stays on one line.

![After: compact membership notice is one line](compact-after.png)

## Checks

- `bun run fix` — passed; no new lint errors.
- `bun run typecheck` — passed (desktop and shared workspaces).
- `bun run lint` and `bun run format:check` — passed.
- `bun run --cwd packages/desktop test` — passed: 1406 pass / 12 skip.
- `bun run --cwd packages/desktop qa:feed-membership` — isolated native GUI QA at 760×240.
  It renders a two-source combined feed in modern and compact layouts and asserts that every
  join/part notice contains its source chip inside the notice row and shares a line with the
  notice text. The fixture fails on the previous revision (`feed chip starts inside the notice
  row`) and passes with this change.

Rendering-only change limited to Twitch membership rows. Ingestion, stores, filtering and the
ordinary message rows are untouched, so the completed
[membership benchmark](../benchmarks/2026-11-14-twitch-chat-membership/report.md) remains valid
for that workload.
