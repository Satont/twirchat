# Desktop color themes

## Setup

AMD Ryzen 7 9800X3D 8-Core Processor, 16 logical CPUs, Linux 7.3.1-1-cachyos and Bun 1.4.4.
Each case used a fresh process and private hardware-backed Weston display, a 1200×800 window,
compact text chat, 200 retained messages per channel, 3 s warmup and 2 s drain. The runner
verified the loaded React mode and hashed the runtime inputs before and after each case. Both
sets used the default Dark theme. The workstation remained in regular use during sampling.

Both clean checkouts used GPUIX `0.11.0-twirchat.23`, API 3, patch digest `ec8d738268da160e`.
Native SHA-256 `7968a5ca95675c1d8a2a06e7d4a6fb82e0cc82e50881c5fd6a9e7839871cd41c`.

- Baseline commit `3b11fa32b04a1b05b0e60821c3a59c32b1e5b1ea`, runtime SHA-256
  `64d6b31f7917d6fdfecc28d1bac04bd04bdb41ca3d8bde9b00874b7c78bca86c` (447 files).
- Themes commit `418043acf21163fff865b4e7c9c715d3ba331a39`, runtime SHA-256
  `6b24d6c53dfe743ec8d181d370a77404f034ee5d8497d1136f49b58d72447e9e` (449 files).

## Production target

Each run offered 5000 messages/s across 50 channels with four visible panes for 30 seconds.
Runs 1–3 used separate checkouts. Runs 4–5 alternated revisions in the same checkout, with
the original native artifact and dependencies kept in place.

```sh
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```

| Run | Msg/s | CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline 1 | 4991.3 | 45.10 | 352.9 | 437.7 | 153.1 | 2.11 |
| Baseline 2 | 4993.7 | 45.70 | 353.6 | 453.5 | 168.5 | 2.28 |
| Baseline 3 | 4990.7 | 43.57 | 356.6 | 461.9 | 167.9 | 1.98 |
| Baseline 4 | 4991.1 | 41.99 | 349.0 | 445.9 | 162.6 | 1.90 |
| Baseline 5 | 4991.0 | 44.63 | 357.7 | 446.2 | 160.5 | 1.87 |
| Themes 1 | 4990.2 | 42.55 | 363.9 | 460.6 | 152.7 | 1.66 |
| Themes 2 | 4991.8 | 44.04 | 371.4 | 478.5 | 160.2 | 1.75 |
| Themes 3 | 4993.2 | 45.68 | 366.7 | 484.1 | 165.3 | 2.32 |
| Themes 4 | 4991.8 | 42.38 | 366.5 | 464.5 | 158.8 | 1.95 |
| Themes 5 | 4992.8 | 43.99 | 355.7 | 452.1 | 152.4 | 1.96 |

Medians (min–max). CPU is expressed as a percent of one logical core.

| Revision | Msg/s | CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 4991.1 (4990.7–4993.7) | 44.63 (41.99–45.70) | 353.6 (349.0–357.7) | 446.2 (437.7–461.9) | 162.6 (153.1–168.5) | 1.98 (1.87–2.28) |
| Themes | 4991.8 (4990.2–4993.2) | 43.99 (42.38–45.68) | 366.5 (355.7–371.4) | 464.5 (452.1–484.1) | 158.8 (152.4–165.3) | 1.95 (1.66–2.32) |

The slowest production run processed 99.80% of offered traffic. Across five runs, median CPU
fell 1.4%, median RSS rose 3.6% and median peak RSS rose 4.1%. The peak RSS difference was 5.5%
across the initial three runs and 2.7% across the two repeats from the same checkout.
The benchmark uses an in-process generator and measures the app's handling of that workload.

## Default development matrix

Each measurement lasted 12 seconds. Cells show baseline → candidate.

```sh
bun run --cwd packages/desktop bench:chat
```

| Scenario | Msg/s | CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c1-r0-p1 | 0.0 → 0.0 | 0.95 → 0.94 | 239.2 → 242.1 | 240.3 → 243.0 | 53.5 → 53.5 | 0.06 → 0.06 |
| c1-r100-p1 | 99.7 → 99.7 | 22.97 → 24.81 | 377.7 → 381.2 | 444.2 → 443.9 | 125.7 → 124.8 | 1.39 → 0.95 |
| c1-r1000-p1 | 995.0 → 996.0 | 32.19 → 33.78 | 381.8 → 390.7 | 509.1 → 515.1 | 170.2 → 167.4 | 4.30 → 4.64 |
| c1-r5000-p1 | 4974.1 → 4981.1 | 34.20 → 38.76 | 400.2 → 401.6 | 516.7 → 518.2 | 170.5 → 173.5 | 4.15 → 5.00 |
| c10-r0-p1 | 0.0 → 0.0 | 0.95 → 0.97 | 242.1 → 245.9 | 243.0 → 246.9 | 55.0 → 55.1 | 0.06 → 0.06 |
| c10-r100-p1 | 99.7 → 99.7 | 14.63 → 15.56 | 298.6 → 305.3 | 324.7 → 331.9 | 79.4 → 79.9 | 0.06 → 0.47 |
| c10-r1000-p1 | 997.6 → 997.6 | 23.98 → 24.73 | 376.8 → 377.7 | 447.4 → 449.7 | 137.0 → 136.1 | 1.10 → 1.53 |
| c10-r5000-p1 | 4975.9 → 4973.0 | 33.78 → 32.50 | 384.5 → 394.9 | 488.9 → 500.7 | 169.7 → 161.1 | 3.95 → 3.21 |
| c50-r0-p1 | 0.0 → 0.0 | 1.04 → 1.05 | 256.5 → 260.2 | 257.2 → 261.5 | 61.3 → 61.4 | 0.06 → 0.06 |
| c50-r100-p1 | 99.6 → 99.7 | 5.22 → 5.38 | 267.7 → 275.4 | 273.9 → 280.8 | 67.5 → 67.6 | 0.11 → 0.06 |
| c50-r1000-p1 | 997.6 → 997.0 | 22.41 → 20.62 | 348.5 → 354.1 | 402.8 → 406.7 | 114.6 → 114.5 | 0.72 → 0.89 |
| c50-r5000-p1 | 4986.6 → 4993.0 | 26.19 → 25.49 | 388.5 → 395.6 | 467.2 → 473.0 | 167.1 → 167.3 | 1.19 → 0.82 |
| c50-r1000-p4 | 998.0 → 997.0 | 49.64 → 46.29 | 520.3 → 528.3 | 612.6 → 636.4 | 175.0 → 170.5 | 8.20 → 7.21 |
| c50-r5000-p4 | 4988.7 → 4988.5 | 63.51 → 62.21 | 535.3 → 548.0 | 629.5 → 705.0 | 159.9 → 168.7 | 14.11 → 13.20 |
| c100-r5000-p4 | 4987.2 → 4989.4 | 59.65 → 51.13 | 506.0 → 508.9 | 581.5 → 642.2 | 166.3 → 162.3 | 9.76 → 8.49 |

### Development repeat

The single-pass development matrix showed higher peak RSS in the two four-pane 5000 msg/s cases.
The 50-channel case was repeated with both revisions in the same checkout. The repeat uses the
same development runtime, timing and workload as the matrix.

| Revision | Msg/s | CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 4988.5 | 61.60 | 527.2 | 682.2 | 168.1 | 13.16 |
| Themes | 4987.2 | 60.38 | 546.1 | 698.7 | 191.3 | 12.46 |

The repeated peak RSS gap was 2.4%, compared with 12.0% in the matrix case. The baseline peak
varied from 629.5 to 682.2 MiB across those two samples.

## Functional verification

Workspace lint, typecheck, format check and all 1352 tests passed. Isolated native QA exercised
the real app at 1200×800 and Settings at 680×820, including preset switching, keyboard selection,
live custom preview, invalid hex, SQLite persistence, palette reset and incoming chat messages.
[Native screenshots](../../qa/2026-11-09-color-themes).
