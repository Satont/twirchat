# Chat rendering and allocation optimization

The full 15-case benchmark was repeated before and after the changes with:

```sh
bun run --cwd packages/desktop bench:chat
```

Both runs completed all cases. The 50-channel / four-pane case targeting 5000 messages/s
processed 2690.5 → 4992.1 messages/s, with CPU 167.2% → 149.1%, peak RSS
1891.1 → 1134.4 MiB and event-loop lag p95 52.7 → 15.8 ms. CPU time per processed message
fell by approximately 52% in that case. The generator still shares the application's event loop;
this is improved handling of this workload, not an independent measurement of maximum throughput.

## Method and provenance

- Host: AMD Ryzen 7 9800X3D, 16 logical CPUs, RX 7800 XT, Linux 7.3.1-1-cachyos, Bun 1.4.4.
- Identical default matrix, private headless Weston GL display, 1200×800 window, 200 retained
  messages/channel, 3-second warmup, 12-second measurement, 2-second drain. Text-only compact
  chat, avatars and provider cosmetics disabled. No forced GC or allocator trimming.
- **Development React in both runs.** `qa:gui` sets `NODE_ENV=development`; this benchmark
  does not measure a compiled release binary. Development reconciler/DevTools costs appear
  in the profile and remain present in both sides of the comparison.
- Before: clean pushed commit `a4e3308cd23b939bbc545d3e0e69419b86d668bb`, runtime input SHA-256
  `71161764dcbe6cb9f594ba25ff33b6e00178349ea2fd2077d7ed50a8dbec9c02` (336 files).
- After: same parent commit plus the optimization diff, runtime input SHA-256
  `13ea0b458aadd37df2fb3960ce80a032549058c6c36b2eaead39431dcef69e52` (337 files).
  Dirty diff SHA-256 `39635da42cc0d4405158ebe365699e969286d31fa1e39aabaeb46fd002f1b6a6`.
- Native API remains version 2. The native cache fix was rebuilt before the after run;
  native artifact bytes are included in the runtime input hashes. Sources and artifacts stayed
  frozen through each matrix; the runner checked them before and after every case.

CPU 100% means one logical core and includes the synthetic generator and sampler. RSS includes
native allocations and differs from live JS heap. The compositor runs separately. The host is
shared with normal work; these are single runs, not confidence intervals. Platform networking,
provider enrichment and SQLite chat logging are outside this workload. Full methodology is
in the [benchmark guide](../README.md).

## Results

Every cell with an arrow is before → after. Peak RSS is MiB; lag is milliseconds.

| Channels | Panes | Target msg/s | Actual msg/s | CPU % | RSS peak MiB | Lag p95 ms |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 0 | 0.0 → 0.0 | 1.3 → 1.3 | 283.5 → 283.1 | 0.1 → 0.1 |
| 1 | 1 | 100 | 99.6 → 99.7 | 114.3 → 73.6 | 1130.0 → 560.4 | 18.7 → 2.4 |
| 1 | 1 | 1000 | 996.8 → 997.8 | 117.9 → 103.5 | 1049.2 → 755.0 | 23.1 → 10.1 |
| 1 | 1 | 5000 | 4949.0 → 4972.2 | 157.2 → 161.9 | 824.9 → 836.8 | 32.6 → 27.6 |
| 10 | 1 | 0 | 0.0 → 0.0 | 1.2 → 1.2 | 281.5 → 282.8 | 0.1 → 0.1 |
| 10 | 1 | 100 | 99.7 → 99.7 | 44.8 → 24.3 | 666.6 → 379.4 | 2.3 → 1.0 |
| 10 | 1 | 1000 | 997.0 → 997.2 | 107.6 → 67.3 | 1218.8 → 577.3 | 15.3 → 2.5 |
| 10 | 1 | 5000 | 4982.9 → 4988.9 | 124.1 → 90.0 | 1209.6 → 633.2 | 20.5 → 4.5 |
| 50 | 1 | 0 | 0.0 → 0.0 | 1.3 → 1.3 | 297.9 → 295.9 | 0.1 → 0.1 |
| 50 | 1 | 100 | 99.7 → 99.7 | 14.3 → 8.3 | 487.8 → 321.1 | 0.1 → 0.1 |
| 50 | 1 | 1000 | 996.8 → 997.4 | 83.4 → 47.0 | 1006.0 → 512.9 | 2.5 → 0.6 |
| 50 | 1 | 5000 | 4986.9 → 4990.5 | 152.6 → 87.9 | 1525.8 → 616.7 | 19.0 → 3.7 |
| 50 | 4 | 1000 | 991.8 → 996.9 | 165.2 → 110.9 | 1865.7 → 825.6 | 63.8 → 4.7 |
| 50 | 4 | 5000 | 2690.5 → 4992.1 | 167.2 → 149.1 | 1891.1 → 1134.4 | 52.7 → 15.8 |
| 100 | 4 | 5000 | 2629.8 → 4985.6 | 163.2 → 160.2 | 1795.0 → 1136.4 | 57.1 → 13.5 |

The one-channel / 5000 messages/s case did **not** improve resource use: CPU rose 3.0% and
peak RSS rose 1.4%, while actual throughput changed by less than 0.5%. A rapidly replaced
single-pane buffer gives memoization little old content to reuse. This comparison does not
establish whether the small increase is measurement variation or a repeatable regression.
Idle CPU/RSS are effectively unchanged. Other loaded cases reduced CPU and RSS, including
cases that now process substantially more messages.

JS heap peaks do not fall in every case: for example, one channel / 100 messages/s records
143.8 → 156.8 MiB while RSS falls 1130.0 → 560.4 MiB. GC timing and native/allocator residency
matter. Short RSS measurements do not prove or disprove a long-session memory leak.

## Changes and profile evidence

1. Reuse one `Intl.DateTimeFormat` for message timestamps instead of constructing locale
   formatting state and cloning a Date on every render. Keep the existing 24-hour locale
   output and non-throwing invalid-date behavior.
2. Pass a stable moderation callback. Previously each pane render created a fresh callback
   for every retained message, defeating `ChatMessage` memoization even with moderation off.
3. Memoize the complete message-row wrapper, including its native host style/event props.
   Retained rows whose props do not change now skip rebuilding that host subtree. The native
   list still receives all retained children; scrolling, height measurement and follow-tail
   behavior are preserved.
4. Reuse two immutable similarity outcomes per policy instead of allocating an outcome on
   every message lookup. Policy changes still replace the reader, and new messages update
   the bounded live classification cache.
5. Prune native `VirtualListEntry.seen_rows` when the child list changes. Removed painted
   row IDs previously survived ordinary sliding-window updates. This is a boundedness fix
   for long sessions; that small set does not explain the GiB-scale RSS figures. Membership
   is checked with a temporary set rather than a quadratic scan on configuration changes.

A separate Bun CPU profile of one channel / 100 messages/s found `toLocaleTimeString` at
15.9% of self samples before the fixes, plus `performance.measure` at 18.8% and development React
object-diff work at 7.2%. A diagnostic run after only the formatter and stable-callback changes
removed `toLocaleTimeString` from the hot list; CPU changed from 103.4% to 73.5% and RSS peak
from 1186.0 to 602.3 MiB. Those profiler runs include profiler overhead and precede the remaining
fixes, so they are supporting diagnostics, not rows in the main comparison. Subsequent stack
inspection traced `measure` to React's `logComponentRender` / User Timing instrumentation;
it is a JavaScript runtime builtin, not GPUI text measurement. This attribution does not change
the recorded samples or the same-mode before/after comparison.

The [CPU profile summary](cpu-profile-summary.json) retains top self-sample counts and locations
for those two diagnostic profiles. Allocation reduction is supported by removing identified
per-render constructions; this work did not collect a complete native/JS allocation trace.

## Evidence

- [Comparison CSV](comparison.csv), including JS heap peaks and unrounded values.
- Before: [report](before/report.md), [JSON with resource samples](before/results.json),
  [CSV](before/results.csv), [provenance](before/provenance.json).
- After: [report](after/report.md), [JSON with resource samples](after/results.json),
  [CSV](after/results.csv), [provenance](after/provenance.json).
- Both directories also retain per-case samples, isolation checks and runtime logs. Private
  profiles, runtime directories and compositor processes were removed by the launcher.

The earlier [historical baseline](../2026-11-03/report.md) is preserved unchanged. The before
column here is a fresh measurement of the pushed functional changes, rather than that older run.

## Validation

- `bun run fix` and `bun run check` passed: quality rules, workspace typechecks, lint and
  formatting. Lint still reports existing warnings, with no errors.
- `bun run test`: 1025 tests passed; 15 PostgreSQL integration tests were skipped.
- Two native release regression tests passed, including 5000 successive sliding windows of
  200 rows and preservation of painted/unpainted row identity.
- `bun run --cwd packages/desktop check:native` passed against the rebuilt pinned source.
- Private native QA passed for pause reasons, link interaction, similarity filtering and
  streamer mode; eight optimistic sends reconciled, seven official/custom badge variants
  painted, and all 16 timestamp geometry cases retained the same content position.
- HMR passed eight reload stages while retaining the native renderer and backend singleton.
- The chat QA fixture now explicitly checks that a visible window suppresses default
  background-only notifications, then disables that preference for its mocked notification
  rule tests. Its old expectation conflicted with the new visibility behavior.

All native windows and notification tests ran through the isolated launcher. No window,
tray icon, notification or screenshot used the host desktop.
