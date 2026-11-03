# Wrapping desktop channel tabs

The top channel bar wraps tabs into native flex rows as the window narrows. The bar grows
with its rows, and long tab labels shrink inside the available width while viewer/unread
counts remain visible. Existing tab order, selection, menus, persistence and painted-geometry
drag handling are retained. There are no JS width measurements or new subscriptions.

## Native interaction evidence

- [900px](qa/wrapping-tabs-900.png): two rows for twelve channel tabs plus Home and Add.
  [420px](qa/wrapping-tabs-420.png): four rows; widening restores two rows.
  Every tab and the trailing Add control fit within the bar.
- [Counter/selection fixture](qa/tab-counts-result.json) covers effective widths
  900 → 420 → 320 → 248 → 900px. The 248px case models a 320px window beside the 72px rail.
  It checks all tab/action x/y positions across count-format boundaries, bounded counts,
  long labels, active-state changes, pointer selection and Enter on a lower-row tab.
  [248px screenshot](qa/tab-counts-248.png).
- [Gesture fixture](qa/drag-interactions-result.json) checks cross-row reorder with one
  persistence, outside/lost-button/Escape/blur cancellation, subsequent gestures and pane
  interactions. 482 incoming messages and 299 heartbeat ticks continued;
  maximum sampled event-loop delay during gestures was 64.09ms.
  Fresh layout queries: 0; React/renderer errors: 0.
- Both fixtures ran through `qa:gui` on private Xvfb/bwrap displays. Isolation guards/results
  are retained in `qa/`. The host desktop was not captured or manipulated.
- `bun run fix`, `bun run lint`, `bun run typecheck`, and `bun run test` passed.
  The existing PostgreSQL integration suite is skipped without its test database.
  The Impeccable detector returned [no findings](qa/design-detect.json).

## Production performance gate

Fresh before-run plus three fresh after-runs, production React/JSX/reconciler verified.
50 channels, four panes, 5000 total offered messages/s, 200 retained messages per channel;
1200×800 native window, 3s warmup, 30s measurement, 2s drain, private headless Weston.
CPU 100% means one logical core; memory is process RSS/JS heap in MiB.

| Run | Actual msg/s | CPU % | RSS median | RSS peak | Heap peak | Lag p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| Before | 4995.86 | 111.74 | 514.03 | 647.50 | 231.14 | 2.91 |
| After 1 | 4993.66 | 113.24 | 498.41 | 644.31 | 236.28 | 3.25 |
| After 2 | 4994.18 | 110.54 | 501.38 | 619.75 | 239.09 | 3.17 |
| After 3 | 4995.08 | 111.67 | 500.24 | 613.31 | 235.56 | 3.11 |

After-run medians (ranges): actual rate **4994.18**
(4993.66–4995.08) msg/s;
CPU **111.67%** (110.54–113.24);
RSS medians **500.24 MiB**
(498.41–501.38);
RSS peaks **619.75 MiB**
(613.31–644.31);
heap peaks **236.28 MiB**
(235.56–239.09);
lag p95 **3.17ms**
(3.11–3.25).

Against the fresh before-run, CPU median changed -0.06%, RSS median
-2.68% and RSS peak median -4.29%.
Each repetition preserves at least 99% of the offered target. No repeated target CPU/RSS
increase above 5% is observed. These shared-host samples do not establish a speedup.

Raw results/samples/provenance: [before](baseline-1/results.json),
[after 1](production-1/results.json), [after 2](production-2/results.json),
[after 3](production-3/results.json).

## Default development matrix and limits

All fifteen default scenarios completed in development mode with the default 12s measurement
and 3s warmup. [Report](development/report.md), [raw results](development/results.json).
The [comparison CSV](development-comparison.csv) reuses the prior emote-resource matrix as
its before data: its runtime/native source SHA-256 exactly matches the fresh clean baseline
(`3a70a065cd949a806304a6b536803336309ef2ffd8121b5bec649b929ef93738`). Its original
[provenance](../2026-11-03-emote-resources/development/provenance.json) remains authoritative.
Some single-case CPU comparisons rise above 5%, including 50 channels/one pane/5000 msg/s
(62.3 → 95.3%); others fall. They are not repeated regressions or evidence of uniform speedup.
At the four-pane acceptance target, development CPU was 142.8 → 135.4%; RSS median
851.5 → 820.6 MiB and actual throughput 4980.19 msg/s.

The standard chat benchmark mounts ChatView directly and does **not** mount the tab bar.
It guards unchanged ingestion/rendering behavior, while the focused native fixtures above
exercise wrapping and input. The text-only compact workload disables avatars/provider
cosmetics as before; it excludes platform networking, enrichment and SQLite logging.
The coupled generator is not proof of maximum sustainable external throughput.

## Frozen inputs and reproduction

- Parent: `dec7ff78f0e2ed8417ae1582847fc2fcafbcdaf7` plus [source diff](source.patch).
- Before runtime SHA-256: `3a70a065cd949a806304a6b536803336309ef2ffd8121b5bec649b929ef93738`.
- After runtime SHA-256: `262a12f340f52ac9a215e65dee4322fbcae560e8f7f95c040bdf25b675803b1e`
  (370 runtime/native files). Hashes were verified before/after every case.
- Native `0.11.0-twirchat.6`, API 3, patch digest `cb782c083032b0ed`;
  SHA-256 `459aa1d3165395c0fbb97f7bb10abf2daf03a1996a7e59659114f29bc2ff6c26`, 56,576,904 bytes.
  [Native provenance](native-provenance.json).
- Ryzen 7 9800X3D, 16 logical CPUs, Linux 7.3.1-1-cachyos, Bun 1.4.4.
  Sources and native artifacts stayed frozen; resource runs were serial, without concurrent
  tests/builds/profilers or other app fixtures. No forced GC, retention/rate changes,
  allocator trimming or performance-entry clearing.

```sh
bun run --cwd packages/desktop qa:gui --dbus --keep --timeout 60 -- bun scripts/qa-drag-interactions.tsx
bun run --cwd packages/desktop qa:gui --keep --timeout 60 -- bun scripts/qa-tab-counts.tsx
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```
