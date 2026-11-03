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

The isolated launcher sets `NODE_ENV=development`, so this command measures development React
and its reconciler. Compare runs in the same mode; these numbers do not describe the compiled
release binary. A production measurement needs its own verified build and provenance.

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
