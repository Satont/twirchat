# Linux close-to-tray performance gate

The full default development matrix completed, followed by three fresh production target
runs. At 50 channels, four panes, 5000 offered messages/s and 200 retained messages/channel,
the production repetitions processed **4994.1–4995.0 messages/s** and retained all 10,000
messages. Median CPU changed from **114.1% to 111.9%** of one logical core, median RSS from
**503.9 to 498.7 MiB**, and median RSS peak from **603.5 to 606.8 MiB**. No repeated CPU or RSS
regression above 5% was observed. These shared-host samples do not establish a causal speedup.

The native change adds a visibility guard to Wayland presentation and identifies frame/sync
callbacks during hide/restore. Existing application ingestion, retention, classification,
subscriptions, layout, refresh rate, and the benchmark workload remained identical in the
frozen comparison. Concurrent unrelated workspace changes were excluded from these runs.

## Production comparison

Values are medians with the three-run range in parentheses. CPU 100% is one logical core;
memory is MiB. Each run used a fresh process, output directory and private profile.

| Metric | Before | After |
| --- | --- | --- |
| Processed messages/s | 4995.0 (4995.0–4995.6) | 4994.4 (4994.1–4995.0) |
| CPU % | 114.1 (112.0–115.5) | 111.9 (110.6–114.3) |
| RSS median | 503.9 (492.6–509.5) | 498.7 (497.0–508.8) |
| RSS peak | 603.5 (579.8–629.5) | 606.8 (594.1–632.1) |
| JS heap peak | 218.6 (208.5–224.5) | 223.4 (216.5–237.1) |
| Event-loop lag p95, ms | 2.79 (2.78–2.93) | 3.28 (2.61–3.41) |

The initial lag p95 median increased by 0.49 ms. A consecutive old/new control pair then
recorded **2.83 → 2.85 ms**, CPU **113.3 → 112.9%**, RSS **499.8 → 504.0 MiB**, and throughput
**4995.5 → 4993.9 messages/s**. That pair did not reproduce the initial timer-lag offset.
All measurements are retained; the control pair is separate from the original three-run
comparison. There is no latency improvement claim. The old control used an unchanged-source
rebuild, whose distinct artifact provenance is recorded below.

Raw production results: [before 1](before-1/results.json), [before 2](before-2/results.json),
[before 3](before-3/results.json), [after 1](after-1/results.json),
[after 2](after-2/results.json), [after 3](after-3/results.json).
Diagnostic pair: [old control](refreshed-before/results.json),
[new control](after-control/results.json).

## Default matrix

All **15 development cases** completed at the default 12-second measurement duration.
The target case processed 4986 messages/s, CPU 140.8%, RSS peak 1057.7 MiB. The largest
retention case (100 channels/four panes/5000 messages/s) processed 4981 messages/s, CPU
134.6%, RSS peak 1041.0 MiB. Development and production results remain separate.

[Full matrix](after-matrix/report.md), [raw samples](after-matrix/results.json),
[CSV](after-matrix/results.csv), [provenance](after-matrix/provenance.json).

## Method and provenance

- Ryzen 7 9800X3D, 16 logical CPUs, Linux 7.3.1-1-cachyos, AMD GPU, Bun 1.4.4.
- Private headless Weston GL, 1200×800 window, three-second warmup and two-second drain.
  Production measurements lasted 30 seconds; development measurements lasted 12 seconds.
  Loaded React/JSX/reconciler mode was verified by the existing benchmark harness.
- Text-only compact chat with the workload's existing cosmetic settings. No forced GC,
  allocator trimming, retention reduction, performance-entry clearing or refresh-rate change.
- Both frozen checkouts started at `82552a53694517829df7500d6c4b96e44f87dd27`. Application
  source stayed at that commit; the after checkout added only the close-to-tray native
  patches/manifest and QA launcher fixtures. Native artifacts and runtime sources stayed
  frozen throughout each measured run; input hashes were checked before and after each case.
- Before: runtime source SHA-256
  `39e798c3f11aa658cb845a7cc02dd04b24e38530c130ca716125f2b726154676` (352 files), clean
  source tree; native version `0.11.0-twirchat.3`, API 3, digest `ad7fc24cef2eaf2f`,
  56,166,296 bytes, native SHA-256
  `cd10c5ab9042a0ef0c485c3b320f7862128b78e6809fba8aa4181ad1a379d248`.
- After: runtime source SHA-256
  `e87f2c0e344dccb2339c0c1ac09fbfc7ff327a71c1dab071dd946adb5869bd33` (354 files), dirty
  tree SHA-256 `45f25cfd21cc817bf3fe46b8e9d28825b817b439bbf4d8269352ab641c62f9c2`;
  native version `0.11.0-twirchat.4`, API 3, digest `9fb2fa0507af39a4`, 56,224,840 bytes,
  native SHA-256 `32df77db2384eb22f77a2eb5442b9c67356d857720ee7248d80b35c4ed63bcf7`.
- Refreshed old control: unchanged application/native source pins and original patch checksums;
  rebuilt native SHA-256 `3aaa4bcbee9c16e01cf5f87f85e12de5b36fa7bcb4ce661f9179c66d07b181c8`,
  56,166,112 bytes. [Manifest](refreshed-before/native.json) and
  [runtime provenance](refreshed-before/provenance.json). The new control reused the exact
  after artifact and runtime source hash above.
- All agent builds, functional tests and extra application instances stopped before resource
  measurement. An initial attempt in the shared working tree rejected changing inputs before
  producing accepted results; subsequent measurements used isolated frozen checkouts.

These resource runs execute production/development-mode source. The compiled production app
has separate [close/restore/Quit and missing-tray verification](../../qa/2026-11-03-close-to-tray/README.md).
The benchmark covers DesktopEvents → stores → native ChatView with an in-process generator
and sampler. Platform networking, provider enrichment and SQLite logging are outside this
workload. The coupled generator is not proof of maximum sustainable external throughput.

## Reproduction

Run sequentially on frozen sources/native artifacts, with distinct output directories:

```sh
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```

Repeat the production target command three times. See the existing
[benchmark methodology](../README.md) for interpreting the samples and process/GPU counters.
