# Chat resource benchmark

Run from the repository root with Bun 1.4.4:

```bash
bun run --cwd packages/desktop bench:chat
```

A short hardware smoke check uses the same launcher and one scenario:

```bash
bun run --cwd packages/desktop bench:chat --smoke --warmup 1 --duration 2
```

The runner requires x86-64 Linux, installed project dependencies, the desktop native artifact,
`bwrap`, `bsdtar` and a working GPU render node. Prepare the native artifact with
`bun run --cwd packages/desktop build:native` if needed. The QA helper downloads a checksum-pinned
Weston package into a private temporary cache and runs its headless GL backend. It does not install
system packages or connect to the user's desktop. GUI tests must continue to use `qa:gui` or
`qa:native`; `bench:chat` invokes `qa:gui` for every scenario.

By default the isolated launcher sets `NODE_ENV=development`, so this command measures
development React and its reconciler. Compare algorithm changes in the same mode.

To measure the 50-channel / four-pane / 5000 messages/s scenario with production React:

```bash
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production
```

`--mode development|production` is explicit in results, CSV and reports; the runner verifies
the loaded React, JSX runtime and reconciler modules and refuses mixed-mode resume. This runs
native application source, rather than a compiled release binary. `--scenario` accepts an ID
from the default matrix; omit it to run all 15 cases. `--smoke` and `--scenario` cannot be combined.

Add `--plugin-subscriber` to run a real TypeScript plugin that receives every incoming chat
message. This workload records plugin delivery and separate plugin process metrics in JSON.

For ordinary use, `bun run --cwd packages/desktop start` now explicitly uses production React.
`dev` keeps development checks and HMR. React's development Performance Tracks collect User
Timing entries, which Bun retains in the process; production disables that instrumentation.
Benchmarks count retained measure entries after measurement without clearing them. Switching
modes is reported separately from improvements to application algorithms.

## Scenarios and output

The default matrix contains 15 scenarios: 1, 10 and 50 channels at 0, 100, 1000 and 5000 total
messages/s with one visible pane; 50 channels at 1000 and 5000 messages/s with four panes; and
100 channels at 5000 messages/s with four panes. Rates are distributed evenly across channels.
Each scenario starts a fresh process with 200 retained messages per channel, a 1200×800 window,
3 seconds of warmup, 12 seconds of measurement and a 2-second drain. The workload is text-only
compact chat, with avatars and provider cosmetics disabled.

Results are written to a new temporary directory printed by the runner. To keep a named run:

```bash
bun run --cwd packages/desktop bench:chat --output /tmp/twirchat-bench-next
```

`--warmup` accepts 1–15 seconds and `--duration` accepts 2–30 seconds. `--resume --output <directory>`
continues an interrupted run only when source hashes, timing and compositor match its saved
results. Use a new output directory after changing code. Keep the measured checkout stable:
the runner checks runtime input hashes before and after every scenario.

`--compositor weston` is the hardware default. `xvfb` remains available for QA diagnostics, but a
loaded benchmark refuses to report a hardware result when GPU engine counters are unavailable.
Xvfb on the original test host fell back to software rendering and was excluded from the baseline.

## Metrics and limits

- CPU uses process CPU time; 100% means one logical core. It includes the in-process generator
  and sampler, while the isolated compositor runs separately.
- RAM is process RSS, with median, peak, baseline and JS heap recorded separately.
- GPU uses per-process DRM graphics-engine counters, deduplicated by device and client ID.
  The busiest device's graphics percentage and PCI ID are recorded. VRAM/GTT are separate DRM
  resident allocation counters; GTT can overlap RSS and shared buffers.
- Event-loop lag, target/generated/processed counts and 250 ms resource samples are retained.
  A 2 GiB RSS limit stops a case gracefully and marks its shorter measurement as `rss-limit`.

This measures DesktopEvents → batched stores → native ChatView rendering. Platform sockets,
protocol parsing, provider enrichment and SQLite chat logging are outside the workload. The
bounded generator skips excess messages when its event loop falls behind. Read actual throughput
and `generatorMissedMessages` alongside the target rate; a missed target does not establish an
absolute application throughput limit. The machine remains shared with the user's normal work.

## Saved baseline and next session

[2026-11-07 hover rows](2026-11-07-hover-rows/report.md) measures pointer motion across chat rows.
The whole-row cache in native `0.11.0-twirchat.18` cut CPU during that motion about 27–29%, in a
quiet chat and with live messages.

[2026-11-07 split layout](2026-11-07-split-layout/report.md) measures four panes in a 2×2 split,
where nested split layout made each frame about 105 ms in a live profile.

[2026-11-05 chat flood](2026-11-05-chat-flood/report.md) measures one busy channel with default
settings through `bench:flood`, which also runs on Windows. This matrix does not model that case.

[2026-11-05 TypeScript plugins](2026-11-05-plugins/report.md) records the default matrix,
production target repetitions, active subscriber load and isolated native plugin checks.

[2026-11-04 focus synchronization](2026-11-04-focus-sync/report.md) records the next root metadata
optimization, fresh before/after gates, and the preserved RSS counterbalance investigation.

[2026-11-04 hover CPU](2026-11-04-hover-cpu/report.md) records bounded plain-text reuse,
final-artifact pointer measurements, the preserved load gate, RSS investigations and native glyph QA.

[2026-11-03 interaction fixes](2026-11-03-interactions/report.md) records the native painted-bounds
snapshot, autocomplete and drag regressions, together with a completed 15-case development matrix
and three production repetitions. At the target, production CPU was 93–94% of one logical core,
RSS medians 500–508 MiB and peaks 589–621 MiB; actual throughput remained 4994 messages/s.
The later 7TV artwork fix has separate pixel-based GUI evidence and two completed supplementary
production runs. The redundant repeat was stopped; source provenance distinguishes both versions.

[2026-11-03 high-rate optimization](2026-11-03-heavy/report.md) adds a complete same-mode
development comparison and three 30-second production repetitions for 50 channels / four panes /
5000 messages/s. Production processed 4994–4996 messages/s at 94–105% of one logical core,
with RSS medians 496–520 MiB and peaks 596–653 MiB. The same-mode development target case
reduced CPU 149% → 132%, while peak RSS increased 1134 → 1169 MiB; execution-mode savings
are reported separately from algorithm changes.

[2026-11-03 optimization comparison](2026-11-03-optimization/report.md) preserves a fresh run
of the pushed `a4e3308` checkout and a second complete run after the rendering/allocation fixes.
Both use the unchanged default command and development mode. At 50 channels / four panes /
5000 target messages/s, actual throughput increased from 2691 to 4992 messages/s while RSS peak
fell from 1891 to 1134 MiB. The comparison also records the scenario that did not improve.

[2026-11-03 report](2026-11-03/report.md), [CSV](2026-11-03/results.csv),
[JSON](2026-11-03/results.json) and [source provenance](2026-11-03/provenance.json) preserve the
completed 15-case run, including per-case samples and logs. Those are historical results from a
frozen worktree, not measurements of the current project checkout. Runtime input SHA-256:
`dbac8ffd69727fc23642eb836630097621bd4c779fdb4cc3d692082315f15c8b`.

On Ryzen 9800X3D / RX 7800 XT, the four-pane cases targeting 5000 messages/s reached about
2400 messages/s with event-loop lag p95 around 81 ms. The generator skipped about half the target
load, so 2400 messages/s is not a proven hard maximum. CPU and RSS warrant profiling first;
compare new runs against this baseline with the same settings and inspect the raw samples before
claiming a memory leak or a throughput improvement. Use an independent producer when measuring
maximum sustainable offered load.

The original benchmark code, tests and `bench:chat` command are already in this checkout.
Reusing the benchmark does not require the temporary benchmark worktree.
