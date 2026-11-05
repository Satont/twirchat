# Chat flood CPU on a real-shaped workload

`bench:chat` reported about 85% CPU at 5000 messages/s, while a user saw 100–130% on a 9800X3D in
a busy channel. It spreads the load over 50 channels, disables badges, emotes and avatars, and skips
history logging, so it does not model one busy channel.

`bench:flood` runs one channel with default settings, badges, emotes and history logging. It opens
a real window on the current desktop, uses a temporary profile and also runs on Windows.

```sh
bun run --cwd packages/desktop bench:flood --rate 100 --image-file emote.webp
```

## Result

Windows 11, production React, 1200×800, one pane, a real 7TV animated emote. Median of three
8-second runs per version with the same native artifact, % of one logical core.

| Messages/s | Before CPU | Before fps | After CPU | After fps |
| --- | --- | --- | --- | --- |
| 0 | 3.9 | 0.1 | 3.1 | 0.1 |
| 5 | 10.1 | 5.7 | 10.7 | 5.6 |
| 20 | 24.8 | 20.9 | 18.7 | 15.6 |
| 100 | 47.9 | 48.7 | 20.9 | 16.0 |
| 300 | 54.7 | 46.6 | 31.1 | 16.0 |
| 1000 | 80.6 | 39.5 | 35.5 | 16.0 |

The 0 and 5 rows are within run-to-run variation, which reached ±5 points on identical code.

## Where a frame goes

CPU follows frames, not messages. Message handling with no chat mounted costs 3.3% at 100
messages/s. Temporary timers inside GPUI, ms per frame at 100 messages/s before the changes:

| Phase | ms |
| --- | --- |
| Layout and render | 1.4 |
| Prepaint | 3.4 |
| Paint | 0.7 |
| GPU submission | 0.1 |

Prepaint costs about 0.3 ms per visible row. The GPU is not the bottleneck. Animated emotes are
cheap: 25 animation presents/s with 325 texture uploads/s cost 4% CPU.

## Changes

- Publications are limited to one per 66 ms. A message after a quiet gap still appears within
  16 ms. This caps chat updates at about 15 fps during a flood, a measured tradeoff against the
  rule on lowering refresh rates in AGENTS.md, and it is the largest single improvement.
- While following the tail, the list renders only the viewport plus 8 rows, at least 24. At 1000
  messages/s this took CPU from 66.6% to 35.7%.
- A standalone plain message is one text element. Text-only A/B over five runs: 19.9% → 17.8%.
  The compact theme keeps separate words because they flow after the author name.
- History commits once per second instead of up to 20 times, prunes once per minute and uses
  `synchronous=NORMAL`. CPU change is within noise (32.2% → 30.1% at 300 messages/s); the benefit
  is fewer disk writes. A crash can lose up to one second of history.
- 7TV AVIF sources are requested as WebP because the native decoder cannot read animated AVIF.

Caching the ChatView row filter was tried and dropped: 31.6% → 30.1%, within noise.

## Remaining cost

The native flow cache does not help a flood. Its eligibility rejects the default `modern` theme, and
GPUI view caching compares absolute bounds, while every row moves when a message arrives.

A local prototype cached whole rows and translated reused scene primitives and hitboxes:

| Messages/s | Rebuilt rows/frame | Cache off CPU | Cache on CPU |
| --- | --- | --- | --- |
| 20 | 1.3 of 10.8 | 20.9 | 14.6 |
| 60 | 3.9 of 10.8 | 21.3 | 16.0 |
| 100 | 6.1 of 10.8 | 23.4 | 23.4 |

Above about 170 messages/s every visible row is new per publication, so it cannot help a flood.
Animation kept running on reused rows, but native text registries were not restored: painted text
reported 2 of 11 visible rows, which breaks selection and locators. A shippable version must also
translate text and automation snapshots, keep painted bounds current, restore row focus handling
and prove that removing `window.refresh()` is safe for every Full update.

Also found, not changed:

- A native image failure draws `img: load failed` outside its box. Non-7TV AVIF still reaches it.
- When scrolled up during a flood without pausing, the view drifts as the 200-message buffer drops
  old rows. This matches the behavior without tail rendering.

## Limits

- Measured on Windows only. The cause is in cross-platform code, but the user reports Linux, and
  absolute numbers there will differ.
- `bench:chat` needs Linux, so the matrix and production gate in AGENTS.md were not run.
- The stand injects messages after protocol parsing and provider enrichment.
- The window was not always focused or fully visible during runs.
