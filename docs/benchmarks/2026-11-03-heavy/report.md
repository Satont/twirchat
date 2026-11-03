# High-rate multi-pane chat optimization

Target: **50 channels, four visible panes, 5000 total messages/s**, preserving 200 messages per
channel and the existing display, filtering, delivery, pause, search and completion behavior.

Three 30-second production runs processed 4994–4996 messages/s. Median CPU was **99.0% of one
logical core**, median of each run's RSS median was **510.7 MiB**, and RSS peaks ranged from
**595.6 to 653.2 MiB**. Event-loop lag p95 ranged from 2.29 to 2.69 ms. These are production
React measurements of native application source, rather than measurements of a compiled binary.

Algorithm changes were compared separately in development mode against the previous frozen
optimization run. For the target scenario, CPU fell **149.1% → 132.2% (11.3%)** and lag p95
fell **15.8 → 12.8 ms**. Peak RSS **increased 1134.4 → 1169.3 MiB (3.1%)** in that comparison;
there is no same-mode RAM reduction claim for this row. Switching React modes is a separate
execution change and is not counted as an algorithmic optimization.

## Reproduction and provenance

The original command still runs the unchanged default 15-case development matrix:

```sh
bun run --cwd packages/desktop bench:chat
```

The focused production workload, repeated three times into separate output directories:

```sh
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```

For ordinary application use:

```sh
bun run --cwd packages/desktop start
```

`start` now explicitly sets `NODE_ENV=production`. `dev` retains development checks and HMR.
Bun 1.4.4's runtime `--production` flag alone did not set NODE_ENV in the local verification;
the script uses an explicit environment assignment supported by Bun Shell.

- Host: Ryzen 7 9800X3D / 16 logical CPUs, RX 7800 XT, Linux 7.3.1-1-cachyos, Bun 1.4.4.
- Every run used the private headless Weston GL launcher, a fresh process/profile, 1200×800
  window, three-second warmup, two-second drain, text-only compact chat and 200 retained
  messages per channel. Avatars/provider cosmetics are disabled by the original workload.
  No forced GC, allocator trimming, buffer reduction or frame-rate change was introduced.
- All final runs used parent commit `e3cff68f098d269bfef9ed76bcdd236f4ea96a47` plus the same
  optimization diff. Runtime input SHA-256:
  `bc94c7e6d851e928067fcd3965ac037812db04095d612afcee2bb661e662157a` (337 files).
  Dirty diff SHA-256: `0a49408901fb3a5055d1b8179c4e143662aa701c4a342fb971062af065e7bde7`.
- Native API remains 2. Artifact digest `9552c13702730e24`, SHA-256
  `4b252e90605b32d7adf19ba441254774e7e896c673a0864345c5d71cec90a370`, 56,144,016 bytes.
  The source/native bytes stayed frozen; no builds, tests or profilers ran concurrently
  with the final measurements. Input hashes were checked before and after every case.
- The development comparison uses the saved [previous after run](../2026-11-03-optimization/after/report.md),
  runtime hash `13ea0b458aadd37df2fb3960ce80a032549058c6c36b2eaead39431dcef69e52`.

CPU includes the in-process generator and sampler, and excludes the separate compositor.
RSS includes native allocations; JS heap is reported separately. Platform network parsing,
provider enrichment and SQLite chat logging are outside this workload. The generator shares
the event loop and skips excess work when late. Read actual rate alongside the target; this
does not establish an independently offered maximum throughput. The host remains shared
with normal work. See the [methodology](../README.md).

## Production repetitions

All rows use the final code, production React, 50 channels / four panes / 5000 target messages/s,
and a full 30-second measurement. Memory columns are MiB. Each repetition starts a fresh process.

| Run | Actual msg/s | CPU % | RSS median | RSS peak | JS heap peak | Lag p95 ms | User Timing measures |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 4996.4 | 99.0 | 496.4 | 595.6 | 225.8 | 2.69 | 0 |
| 2 | 4994.1 | 93.9 | 510.7 | 646.5 | 214.4 | 2.29 | 0 |
| 3 | 4996.1 | 104.8 | 519.8 | 653.2 | 247.2 | 2.38 | 0 |

The run-to-run CPU and peak-RSS ranges are retained rather than selecting the best run.
These short runs do not prove long-session memory boundedness. Production/development timing
and instrumentation differ; do not subtract these rows from a development baseline and call
the result an algorithmic gain.

Raw data: [run 1](production-1/results.json), [run 2](production-2/results.json),
[run 3](production-3/results.json), with CSV, reports, samples and private-runtime logs beside them.

## Development comparison

Same React mode and unchanged default 3-second warmup / 12-second measurement. Every arrow
is previous optimized run → final code. RSS is peak MiB; lag is p95 milliseconds.

| Channels | Panes | Target msg/s | Actual msg/s | CPU % | RSS peak MiB | Lag p95 ms |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 0 | 0.0 → 0.0 | 1.3 → 1.2 | 283.1 → 284.4 | 0.1 → 0.1 |
| 1 | 1 | 100 | 99.7 → 99.7 | 73.6 → 56.2 | 560.4 → 595.8 | 2.4 → 1.9 |
| 1 | 1 | 1000 | 997.8 → 997.3 | 103.5 → 87.0 | 755.0 → 762.1 | 10.1 → 4.8 |
| 1 | 1 | 5000 | 4972.2 → 4959.0 | 161.9 → 125.4 | 836.8 → 708.3 | 27.6 → 26.6 |
| 10 | 1 | 0 | 0.0 → 0.0 | 1.2 → 1.2 | 282.8 → 279.2 | 0.1 → 0.1 |
| 10 | 1 | 100 | 99.7 → 99.7 | 24.3 → 21.6 | 379.4 → 378.8 | 1.0 → 0.6 |
| 10 | 1 | 1000 | 997.2 → 998.2 | 67.3 → 54.6 | 577.3 → 561.2 | 2.5 → 2.1 |
| 10 | 1 | 5000 | 4988.9 → 4990.5 | 90.0 → 75.9 | 633.2 → 626.7 | 4.5 → 3.7 |
| 50 | 1 | 0 | 0.0 → 0.0 | 1.3 → 1.3 | 295.9 → 293.5 | 0.1 → 0.1 |
| 50 | 1 | 100 | 99.7 → 99.7 | 8.3 → 7.5 | 321.1 → 312.4 | 0.1 → 0.1 |
| 50 | 1 | 1000 | 997.4 → 998.5 | 47.0 → 40.6 | 512.9 → 476.6 | 0.6 → 0.1 |
| 50 | 1 | 5000 | 4990.5 → 4991.4 | 87.9 → 60.4 | 616.7 → 557.5 | 3.7 → 2.3 |
| 50 | 4 | 1000 | 996.9 → 997.4 | 110.9 → 90.5 | 825.6 → 771.5 | 4.7 → 0.3 |
| 50 | 4 | 5000 | 4992.1 → 4982.5 | 149.1 → 132.2 | 1134.4 → 1169.3 | 15.8 → 12.8 |
| 100 | 4 | 5000 | 4985.6 → 4981.1 | 160.2 → 130.4 | 1136.4 → 988.0 | 13.5 → 11.0 |

CPU fell in every loaded case in this single comparison. RSS did not fall in all cases:
one channel / 100 messages/s, one channel / 1000 messages/s and the target four-pane case
recorded higher peaks. GC timing, transient allocation and development instrumentation matter;
these are single paired runs, not confidence intervals. Idle use is effectively unchanged.

[Final full report](development/report.md), [raw JSON with samples](development/results.json),
[comparison CSV](development-comparison.csv), [source provenance](development/provenance.json).

## What changed

1. **Reuse the live buffer's identity index.** Retention and activity counting now share one
   pass. A WeakMap transfers an identity Set to the returned immutable array version, avoiding
   a fresh scan/key construction for all 200 retained messages on each arrival batch. Branching
   from an older array rebuilds its index. Evicted and too-old IDs leave the cached index after
   batch deduplication, preserving both retention and activity semantics.
2. **One similarity classification cache.** The state layer delegates to the service's bounded
   cache instead of maintaining a second 25,000-entry map. Canonical identity uses an
   unambiguous length prefix. Frozen policy outcomes are reused; history still updates while
   the filter is disabled, and historical hydration cannot overwrite live classifications.
3. **Constant-work FIFO eviction.** A bounded key ring identifies the oldest classification
   directly, replacing repeated `Map.keys().next()` walks. Partial reset rebuilds the surviving
   order once. Duplicate arrivals do not advance the ring.
4. **Skip inactive derived work.** Empty moderation snapshots return a shared empty resolver.
   Mention/emote candidates are built only while that completion mode is active. Emote prefetch,
   aliases, favorites, channel selection and current mention ordering are preserved.
5. **Preserve native row measurements.** Forward/reverse overlapping buffers retain their shared
   ListState rows instead of replacing all 200. Uniform hints fill only unknown rows. Existing
   measured sizes, focus handles and scroll anchors survive; explicit reset/remeasure,
   width changes, configuration changes and content-revision invalidation still work.
6. **Explicit production startup and honest benchmark modes.** The runner verifies actual React,
   JSX-runtime and reconciler module families, records the mode, rejects mixed-mode resume,
   and supports selecting an existing scenario. Defaults remain development for historical
   comparisons. Ordinary `start` uses production without removing debug behavior from `dev`.

The structural similarity-cache upgrade retires its old HMR resource/subscription and resets
arrival history once during that code upgrade. Subsequent HMR retains the V2 runtime and
reader-store identity. The native artifact update requires restarting an already-running app.

## Profile evidence and instrumentation

The [diagnostic CPU summaries](cpu-diagnostics.json) cover the pushed baseline in development
and an intermediate production version before index reuse/FIFO eviction/lazy completion.
They include profiler overhead and are not rows in the resource comparisons.

- The development profile attributed 20.2% of self samples to `performance.measure`, called
  from React's `logComponentRender`, 6.3% to Set construction and about 9.1% to the two
  similarity classification layers. `measure` is a JavaScript runtime builtin here;
  it is not GPUI text measurement.
- After consolidating the cache, the intermediate production profile exposed Set construction
  at 15.3%, classification insertion/eviction at 8.6%, and inactive autocomplete work at 2.5%
  plus mention-color lookup at 1.7% of self samples. These observations motivated the remaining
  index, FIFO and completion changes. CPU sample fractions are not whole-process CPU fractions.
- The final target development case retained **137,979 User Timing measure entries**, including
  warmup. All three production repetitions retained zero. The one-channel / 1000 messages/s
  development case retained 198,171. Entries are counted after CPU/RSS/GPU measurement, never
  cleared. [React Performance Tracks](https://react.dev/reference/dev-tools/react-performance-tracks)
  documents development instrumentation and its absence from ordinary production builds.
- A native Samply capture was blocked by the host's `perf_event_paranoid=2`; no kernel setting
  was changed. No native sampling trace was captured. Native optimizations are backed by
  their source analysis, regression tests and actual GUI/resource measurements.

## Validation

- `bun run fix`, `bun run check`: workspace quality rules, typechecks, lint and formatting passed.
  Existing lint warnings remain; no lint errors.
- `bun run test`: **1043 passed**, 15 PostgreSQL integration tests skipped.
- Native locked release build passed; six renderer regressions and three GPUI measurement
  regressions passed. GPUI tests used byte-identical source in a temporary narrowed workspace
  with a regenerated test lockfile; the production build used its original pinned lockfile.
- Private native QA covered live search jumps, pane resizing/docking,
  composer actions and completion, pause/link behavior, similarity and streamer mode.
- Production delivery QA reconciled eight sends, painted seven official/custom badge variants
  and passed 16 timestamp geometry cases. HMR passed eight stages retaining renderer/backend.
- The complete `App` entry also passed private production QA: splits, tabs, settings, account
  chooser, zoom, standalone window and independent main-window close.

All GUI, tray and notification tests used the isolated launcher. No host window, display socket,
notification, screenshot or compositor setting was used or changed.
