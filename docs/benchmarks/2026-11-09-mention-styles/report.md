# Desktop mention colors and paints

Measured on November 9, 2026 on a Ryzen 7 9800X3D with 16 logical CPUs, Radeon RX 7800 XT,
Linux 7.3.1-1-cachyos and Bun 1.4.4. Each case used a fresh process, private Weston GL
display, 1200×800 window, 200 retained messages per channel, three seconds of warmup and
two seconds of drain. The production cases measured 30 seconds and the development matrix
measured 12 seconds. The harness verified the loaded React, JSX runtime and reconciler modes.

## Production target

All six repetitions completed at 50 channels, four visible panes and an offered rate of
5000 messages/s. Every run processed more than 99.8% of the offered rate. Median CPU rose
0.5% and median RSS rose 0.9%. Median peak RSS fell 2.6%.

| Metric | Baseline median (range) | Candidate median (range) |
|---|---:|---:|
| Processed msg/s | 4993.35 (4990.85–4993.98) | 4993.75 (4992.88–4994.41) |
| CPU % of one logical core | 45.82 (44.11–45.89) | 46.07 (45.34–47.55) |
| RSS median MiB | 363.17 (356.04–364.38) | 366.50 (360.70–368.73) |
| RSS peak MiB | 481.34 (462.21–482.17) | 468.73 (441.77–469.07) |
| JS heap peak MiB | 165.79 (165.01–188.51) | 166.09 (162.08–171.55) |
| Event-loop lag p95 ms | 2.09 (2.01–2.35) | 2.15 (1.88–2.61) |

## Development matrix

| Scenario | Processed msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| c1-r0-p1 | 0.00 | 1.00 | 242.64 | 243.76 | 53.21 | 0.07 |
| c1-r100-p1 | 99.75 | 23.62 | 376.54 | 438.75 | 115.46 | 0.88 |
| c1-r1000-p1 | 995.24 | 34.45 | 402.29 | 513.53 | 167.87 | 3.46 |
| c1-r5000-p1 | 4982.95 | 37.56 | 395.61 | 527.76 | 181.26 | 5.06 |
| c10-r0-p1 | 0.00 | 1.02 | 247.84 | 248.49 | 54.94 | 0.07 |
| c10-r100-p1 | 99.58 | 15.63 | 305.66 | 328.75 | 78.06 | 0.07 |
| c10-r1000-p1 | 997.66 | 22.56 | 371.57 | 443.92 | 131.70 | 0.82 |
| c10-r5000-p1 | 4964.03 | 33.34 | 383.35 | 512.41 | 173.80 | 2.97 |
| c50-r0-p1 | 0.00 | 1.00 | 259.41 | 260.24 | 61.44 | 0.06 |
| c50-r100-p1 | 99.67 | 5.09 | 274.52 | 280.43 | 67.48 | 0.06 |
| c50-r1000-p1 | 998.07 | 22.43 | 356.16 | 399.05 | 114.69 | 1.10 |
| c50-r5000-p1 | 4987.54 | 26.09 | 393.23 | 491.14 | 166.58 | 2.37 |
| c50-r1000-p4 | 996.66 | 48.83 | 539.97 | 639.88 | 175.18 | 7.73 |
| c50-r5000-p4 | 4990.18 | 63.43 | 545.04 | 688.95 | 164.05 | 12.48 |
| c100-r5000-p4 | 4987.78 | 54.38 | 518.25 | 599.20 | 166.55 | 8.85 |

## Provenance and native QA

- Baseline commit `3b11fa32b04a1b05b0e60821c3a59c32b1e5b1ea` with a clean checkout.
  Runtime input SHA-256 `64d6b31f7917d6fdfecc28d1bac04bd04bdb41ca3d8bde9b00874b7c78bca86c`
  (447 files).
- Candidate uses the same base commit plus the mention changes.
  Dirty tree SHA-256 `26a63e83ab3440ebd8ea58df2473f040650d424859efd4ae875834ea9bd66e34`.
  Runtime input SHA-256 `d3bf8989f2c2d7f930fb8a05ab0801ce0da0c362c3adb7fb84560b5d91241aba`
  (448 files).
- Both used GPUIX `0.11.0-twirchat.23` (API 3,
  patch digest `ec8d738268da160e`, 57,206,136 bytes),
  SHA-256 `7968a5ca95675c1d8a2a06e7d4a6fb82e0cc82e50881c5fd6a9e7839871cd41c`.
- The source and native inputs stayed frozen across each run. Builds, tests and profilers
  ran separately from the measurements.

The default text-only workload exercises ordinary chat ingestion and rendering. The
separate isolated production QA used a fixture cosmetic with the real paint renderer.
It checked author color arriving after the mention was mounted, visible gradient pixels
at 420×300 and 900×600 in both layouts, and restoration of the author color when paints
were disabled. It also exercised pointer and keyboard card opening, repeated opens,
dismissal and continued incoming chat.

```sh
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
bun run --cwd packages/desktop qa:gui --node-env production --keep --timeout 60 -- bun scripts/qa-mention-user-card.tsx
```
