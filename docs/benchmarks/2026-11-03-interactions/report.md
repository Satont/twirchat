# Native interaction fixes and performance gate

The later [wrapping-tabs gate](../2026-11-03-wrapping-tabs/report.md) adds native multi-row tab
layout, cross-row input/drag QA, and fresh default-matrix/production target measurements.

The later [animated-image resource gate](../2026-11-03-emote-resources/report.md) adds native
decoded-frame ownership, inline 1x sizing, real GIF checks, and a complete fresh default matrix
plus three production target repetitions. Its own source/native provenance is recorded there.

Autocomplete now scrolls its selected row and stays within the composer/window. Tab and pane
motion uses a nonblocking snapshot of the last completed native paint, with coalesced motion,
cancellation and layout persistence after an accepted drop. 7TV notices preserve the event's
artwork URL and show a quoted alias beside the image, including during loading or after failure.

The completed gate preserved **50 channels, four panes, 5000 total messages/s and 200 retained
messages per channel**. Three production repetitions achieved 4993.8–4994.7 messages/s. Median
CPU was **93.5% of one logical core**, median of RSS medians **503.5 MiB**, and median RSS peak
**599.8 MiB**. RSS peaks ranged from 588.6 to 621.2 MiB.

Against the [previous production repetitions](../2026-11-03-heavy/report.md), median CPU was
99.0% → 93.5%, median RSS 510.7 → 503.5 MiB and median peak RSS 646.5 → 599.8 MiB. These short
shared-host samples show no target CPU/RSS regression; they do not isolate a causal speedup from
the interaction changes. Lag p95 median was 2.38 → 2.56 ms (+0.18 ms), within the previous
2.29–2.69 ms range. Every production repetition preserved over 99% of the target rate.

## Changes and native evidence

- Autocomplete has a clipped scroll viewport, bounded width/height and fixed-height rows.
  Focused menus capture Up/Down, Enter/Tab and Escape before conflicting custom shortcuts.
  Native input QA covered 20 commands, repeated navigation, wrapping, selection and dismissal
  at 420×300 and 900×600 with incoming chat. A separate production fixture passed.
  [Small screenshot](qa/autocomplete-420.png), [normal screenshot](qa/autocomplete-900.png),
  [production result](qa/autocomplete-production.json).
- Fresh native geometry queries waited for a UI command/frame for each element examined during
  a drag. API 3 exposes `getPaintedElementBounds`: try-lock reads of per-window completed paint
  maps, no layout request or extra frame demand. Maps share an Arc; replacing the previous map
  releases it outside the publication lock. A completed-paint observer handles native scroll and
  cached views without a React commit. [Geometry QA](qa/painted-geometry.json) read 10,000 boxes
  in 3.76 ms and covered same-size scroll/reorder, resize, independent windows and close cleanup.
- Tab/pane/divider motion coalesces at 16 ms and flushes the final pointer position on release.
  Targets use stable identities; unchanged previews do not rerender. Escape, blur, lost button,
  outside release and unmount cancel the gesture. Divider drafts persist once on acceptance.
  [Drag QA](qa/drag-interactions.json) recorded zero fresh-bounds calls, 470 incoming messages,
  a continuing heartbeat and maximum measured lag 39.83 ms. It also tests a React update in the
  gap after native OS close; `reactErrors` stayed empty through shutdown.
- Window sessions dispose React roots before requested native close. Mutations after native
  close are ignored; duplicate close/empty callbacks are harmless. Window-manager runtime 4
  and native API 3 require one restart of an already running app.
- 7TV notice types derive from the validated protocol. The event URL, animation, aspect ratio
  and provider metadata survive to message tokens. The quoted name cannot be enriched into a
  second image. Add/remove/rename tests cover schema → builder → enrichment → tokenizer.
  [Pixel QA](qa/seventv-notices-result.json) verified cached RAGEY GIF artwork at 900/420px
  (815 changed pixels in its artwork slot) and visible names with pending/failed requests.
  [Cached artwork](qa/seventv-cached-420.png), [pending](qa/seventv-pending-420.png),
  [failed](qa/seventv-failed-420.png).
- [AGENTS.md](../../../AGENTS.md) makes CPU/RSS/throughput/input responsiveness acceptance
  requirements. `project-quality/no-blocking-native-geometry` rejects fresh geometry references
  in application UI while allowing automation. Reuse completed measurements for later fixes
  outside the measured workload, retaining exact provenance and focused regression checks.

## Reproduction and provenance

```sh
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```

- Ryzen 7 9800X3D, 16 logical CPUs, RX 7800 XT, Linux 7.3.1-1-cachyos, Bun 1.4.4.
- Private headless Weston GL; fresh process/profile per case, 1200×800 window, three-second
  warmup, two-second drain. Development measurement 12 seconds; production 30 seconds.
  Text-only compact chat, avatars/provider cosmetics disabled by the original workload.
- Complete matrix and three production runs: parent commit
  `27f1c9f4e1abd52c9c26223d6a7b8b3af2c8a780` plus the interaction diff, before the final notice
  builder extraction. Runtime SHA-256
  `e167f953b55eba0cae8be14e1eda300cd9d73d8f55fe192fba230dd2bb3480ec` (338 files);
  dirty diff `5eeec964c0697db72d224027387fbe5669fbf2492a1e94ec817356ad8e48d1e8`.
- Native version `0.11.0-twirchat.3`, API 3, digest `6b1b1c7f0c458919`, 56,175,560 bytes;
  SHA-256 `f16ef09c0f27bf54cb9f51fec0e5659b4572a48ade41d3a15bf097f0f9d59f24`.
- Sources/native bytes stayed frozen. No concurrent tests/builds/profilers ran. Runtime hashes
  were checked before and after every completed case. No forced GC, allocator trimming, entry
  clearing, retention reduction or refresh-rate change was introduced.

The benchmark measures DesktopEvents → batched stores → native ChatView. It includes its
in-process generator/sampler, excludes the separate compositor and does not exercise platform
network parsing, provider enrichment or SQLite chat logging. A coupled generator can skip work
when late; actual throughput is always reported. These runs do not prove maximum sustainable
external load or long-session memory boundedness. See the [methodology](../README.md).

## Production repetitions

Each run is a fresh process at the target. Memory is MiB; CPU 100% is one logical core.

| Run | Actual msg/s | CPU % | RSS median | RSS peak | JS heap peak | Lag p95 ms | User Timing measures |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 4993.9 | 93.9 | 503.5 | 588.6 | 244.8 | 2.49 | 0 |
| 2 | 4994.7 | 93.5 | 500.0 | 621.2 | 231.9 | 2.56 | 0 |
| 3 | 4993.8 | 93.0 | 508.2 | 599.8 | 223.9 | 2.66 | 0 |

Raw results with samples, provenance and private-runtime logs: [run 1](production-1/results.json),
[run 2](production-2/results.json), [run 3](production-3/results.json).

## Development matrix

All 15 cases completed in the same mode, timings, settings and retention as the
[previous run](../2026-11-03-heavy/development/results.json). The target's CPU was effectively
unchanged, 132.2% → 132.8% (+0.5%); peak RSS was 1169.3 → 1023.2 MiB. Actual throughput was
4982.5 → 4984.5 messages/s, lag p95 12.84 → 13.91 ms.

Not every case improved: one channel / 5000 msg/s recorded higher CPU/RSS; 10 channels / 1000
and 50 channels / 100 or four panes / 1000 recorded higher CPU; 100 channels / four panes
recorded higher RSS. These are single comparisons, not confirmed repeated regressions or proof
of their cause. Development instrumentation and allocation/GC timing remain part of these runs;
there is no blanket improvement claim. No further matrix ran after the narrow artwork fix.

[Complete report](development/report.md), [raw samples](development/results.json),
[all-case comparison CSV](development-comparison.csv), [provenance](development/provenance.json).

## Supplementary artwork-version runs

After the notice builder/image fix, two additional production target repetitions completed.
The user then requested reusing existing data; the third repetition was stopped and its incomplete
output is excluded. The redundant second development matrix was not started. The artwork path
is outside the benchmark's generated chat workload; focused native image QA covers its correctness.
The previous complete gate remains the interaction regression evidence.

Runtime SHA-256 `573e52717c70642e2a11cc6b9649ce6bd233398f8b35fab486edef917c934856` (339 files),
dirty diff `9003df1380584b95f00b84ccee5acca844f6365785fde504e19a42e63f526fd7`, same parent/native artifact.

| Run | Actual msg/s | CPU % | RSS median MiB | RSS peak MiB | Lag p95 ms |
|---:|---:|---:|---:|---:|---:|
| 1 | 4995.7 | 96.4 | 500.2 | 590.1 | 2.83 |
| 2 | 4996.2 | 97.1 | 501.5 | 603.0 | 2.42 |

[Run 1](artwork-production-1/results.json), [run 2](artwork-production-2/results.json).
These two repetitions are not presented as a new three-run gate.

## Twitch announcement presentation (#79)

Twitch announcement rows now add a tinted frame, Twitch icon and `Announcement` header around
the existing compact or modern content. The frame uses the received blue, green, orange or
purple color independently of the sender's name color. `primary` and unknown color names fall
back to Twitch purple because the current message contract has no channel profile accent.
An ignored row stays hidden until it is revealed, then receives its announcement frame.

This narrow change reuses the complete interaction gate and its exact source/native provenance
recorded above; it does not introduce new performance measurements. The benchmark generates
Kick messages without announcement metadata. Those rows retain their existing React/native
tree and only encounter a platform comparison; the new component runs only for announcements.
Ingestion, stores, retention, tokens, native layout code and benchmark settings are unchanged
by this fix. Focused native checks cover the added presentation separately.

All eight production native cases passed: compact/modern, dark/light and 420/900px. The fixture
checks background pixels for every color and the primary/unknown fallback, retained sender,
badge/link/emote content, wrapping bounds, an ordinary neighbor and pointer-driven reveal of an
ignored announcement. [Results and exact UI/native provenance](qa/announcements/result.json),
[compact at 420px](qa/announcements/announcements-420-dark-compact.png),
[modern in the light theme](qa/announcements/announcements-900-light-modern.png).
The isolated branch passed `bun run fix`, lint, typecheck and all **1150 tests**; 15 PostgreSQL
integration tests were skipped. This focused QA used the matching API 3 native artifact
`ad7fc24cef2eaf2f`, SHA-256 `cd10c5ab9042a0ef0c485c3b320f7862128b78e6809fba8aa4181ad1a379d248`,
separately from the older performance gate's artifact above.

## Validation

- Workspace `bun run fix` and `bun run check` passed, including strict GPUIX fixture types.
  Existing lint warnings remain; no lint errors.
- `bun run test`: **1068 passed**, 15 PostgreSQL integration tests skipped.
- Native locked release build and four snapshot Rust regressions passed.
- Private geometry, autocomplete, drag/OS-close and 7TV pixel fixtures passed. New fixtures have
  a standard nearest TypeScript project and inclusion in desktop typechecking.
- [Eight-stage HMR](qa/hmr.json) and [complete production App](qa/app-production.json) passed.
- All native tests/screenshots used private virtual displays. No host window, compositor
  configuration, notification or desktop screenshot was used. No live backend/app was restarted.

## Exact 7TV alias matching

The follow-up to source commit `82552a53694517829df7500d6c4b96e44f87dd27` removes case
folding from the desktop 7TV service's alias keys and lookups. `Pog` and `pog` remain distinct
through initial loading, live additions, renames and removal; an unmatched `POG` stays text.
Channel-name normalization is unchanged.

This narrow fix reuses the complete matrix and three production repetitions above, with their
recorded source/native provenance. `scripts/bench-chat-case.tsx` disables emote providers,
generates `emotes: []`, and emits `watched_channel_message` directly through DesktopEvents.
It bypasses the changed service and message parser, so repeating that workload would not
exercise this fix. Focused service and real message-parser regressions cover exact aliases
and token positions; no CPU/RSS improvement is claimed.

## Mention user cards

Chat mentions now open the mentioned user's existing card on primary click, Enter or Space.
The full handle survives word wrapping. Lookup uses same-platform account/reply/retained author
identities, then the Twitch login, Kick slug or existing YouTube handle endpoint. The target
preserves the source channel context without borrowing the sender's ID or message ID. Older
remote lookups cannot replace a newer mention selection; unmounted mentions ignore completion.

This interaction-only addition reuses the complete performance gate and exact original
source/native provenance above. The benchmark phrases contain no mentions: ordinary text keeps
its existing token/native tree and gains no hooks, subscriptions, retained-message scans or
network work. The new component runs only for mention tokens, and identity lookup runs on
activation. No new CPU/RSS/throughput improvement or regression measurement is claimed.

[Production native QA](qa/mention-user-card-result.json) covers compact/modern at 420×300 and
900×600, native X11 pointer input, right-click exclusion, Enter/Space, Escape dismissal, repeated
reopening, delayed/unmounted lookup cancellation, native user-window fallback, and 200 history
rows at normal size. Incoming chat kept painting: 222 messages and 222 heartbeat ticks during
the run. The 165.7 ms maximum timer delay includes synchronous test-driver subprocesses,
screenshots and existing history rendering; it does not isolate input callback latency.
Remote network responses are stubbed inside the private, offline launcher. Development QA
also passed. [Small card](qa/mention-modern-420.png), [normal card](qa/mention-compact-900.png).

QA base: `1455a1dd59690e5e17aed753825f1b1c120c25f1` plus this change. Runtime SHA-256
`2f5b60ed4a11ecad4b2b0bd05af05c148af152d90d7d7080a281e4d91c7bc580` (358 files).
Native `0.11.0-twirchat.4`, API 3, digest `9fb2fa0507af39a4`, 56,224,840 bytes, SHA-256
`32df77db2384eb22f77a2eb5442b9c67356d857720ee7248d80b35c4ed63bcf7`; Bun 1.4.4.
Workspace formatting, lint, typecheck and tests passed: 1175 tests, 15 PostgreSQL tests skipped.

## Animated emote follow-up

Visible GIF/WebP emotes now play without focus, share a timeline across copies, and request
redraws at encoded frame deadlines. The [animation report](../2026-11-03-animated-emotes/report.md)
records native pixel/lifecycle checks, the complete development matrix and final production repeats.
