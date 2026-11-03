# Native interaction fixes and performance gate

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
