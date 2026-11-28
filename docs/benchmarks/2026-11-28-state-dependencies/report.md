# Desktop state dependency refactor

The state dependency refactor preserves the production target at **4,994 processed messages/s** median (99.87% of the offered 5,000). Median CPU was +0.91%, median RSS +0.25%, and peak RSS +1.29% versus baseline. The single-run development matrix completed all 15 cases before and after. This is a regression check, not a throughput ceiling or a claimed speedup.

## Provenance and workload

- Before: clean commit `b53b04c543a4ca946e27ebe2d49ec19148841fde`.
- After: the round-6 state migration measured as a working diff on the same commit. The bench harness changes only its imports for the moved account and layout stores; fixture settings, input generation, timings, retention, and sampling are unchanged.
- Both: Bun 1.4.4, Linux 7.3.6-1-cachyos, AMD Ryzen 7 9800X3D, isolated headless Weston, 1200×800, 200 retained messages/channel, 3 s warmup, 2 s drain. Native addon SHA-256 `ae97bab7d71bb610e4fb93aa7cccdf247d9d88f8b9495fdc5ed25fa961d93b22`. The launcher verifies the pinned Weston package; a checksum-valid copy was supplied via a private cache.
- Matrix: development React, 12 s per case. Production target: 50 channels, four panes, 5,000 offered messages/s, 30 s per run, three fresh processes per revision. The runner verified React, JSX runtime and reconciler modes. No builds, tests or other benchmark processes ran concurrently.
- Raw data on the measurement host: `/tmp/twirchat-state-before.MP7gz1`, `/tmp/twirchat-state-after.oxBxFm`, and `/tmp/twirchat-state-alternate.9ZFdnj`. The runner checked runtime input hashes before and after each case.

| Revision | Runtime inputs SHA-256 | Files |
| --- | --- | ---: |
| Before | `ad98a72094a1b5d9bbcaa075e58dad139170e6d971812a610a28c004f54dd6d7` | 682 |
| After | `300fce6f29bc80e905b3c1e462bb3a1c04dcb674d45258ce491983fbeb5b59d5` | 685 |

## Production target (three runs per revision)

CPU 100% means one logical core; RSS and heap entries use MiB. Every run reached at least 99% of the offered rate. No median CPU or RSS regression exceeded 5%. One candidate run reached 57.81% CPU and 4.93 ms p95 lag; the three-run range is shown rather than dropping that run.

| Metric | Before median (range) | After median (range) | Median change |
| --- | ---: | ---: | ---: |
| Rate | 4993.51 (4986.74–4996.31) | 4993.58 (4990.75–4995.71) | +0.00% |
| CPU % | 48.90 (47.58–52.41) | 49.34 (46.93–57.81) | +0.91% |
| RSS median MiB | 389.54 (387.12–393.18) | 390.54 (379.86–398.62) | +0.25% |
| RSS peak MiB | 470.61 (458.63–509.11) | 476.69 (454.72–488.97) | +1.29% |
| JS heap peak MiB | 151.59 (144.98–165.37) | 149.73 (144.50–170.81) | -1.23% |
| Lag p95 ms | 2.96 (2.58–3.01) | 2.57 (2.17–4.93) | -13.03% |

## Development matrix

| Case | Rate (before → after) | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c1-r0-p1 | 0.00 → 0.00 | 0.97 → 0.94 | 253.75 → 255.09 | 254.36 → 255.93 | 56.99 → 57.02 | 0.06 → 0.06 |
| c1-r100-p1 | 99.75 → 99.75 | 24.53 → 24.14 | 346.17 → 345.11 | 394.88 → 381.59 | 96.38 → 90.39 | 2.05 → 1.14 |
| c1-r1000-p1 | 995.49 → 995.07 | 32.21 → 32.81 | 396.77 → 373.55 | 445.43 → 434.93 | 127.50 → 124.03 | 3.26 → 4.02 |
| c1-r5000-p1 | 4983.87 → 4977.95 | 40.26 → 35.15 | 394.95 → 392.50 | 452.53 → 438.86 | 118.82 → 115.15 | 5.21 → 4.85 |
| c10-r0-p1 | 0.00 → 0.00 | 1.04 → 0.99 | 260.15 → 259.57 | 260.97 → 260.02 | 58.55 → 58.56 | 0.06 → 0.06 |
| c10-r100-p1 | 99.58 → 99.67 | 15.65 → 19.29 | 330.61 → 325.10 | 363.53 → 356.20 | 89.87 → 87.31 | 0.12 → 0.42 |
| c10-r1000-p1 | 996.66 → 997.41 | 24.88 → 24.28 | 354.51 → 343.34 | 388.69 → 377.30 | 96.67 → 100.75 | 1.19 → 1.60 |
| c10-r5000-p1 | 4983.95 → 4974.70 | 34.80 → 33.91 | 389.83 → 372.61 | 440.37 → 435.18 | 137.25 → 125.45 | 3.70 → 2.82 |
| c50-r0-p1 | 0.00 → 0.00 | 1.13 → 1.10 | 270.07 → 273.60 | 270.50 → 274.50 | 64.89 → 64.90 | 0.06 → 0.06 |
| c50-r100-p1 | 99.58 → 99.67 | 5.41 → 5.25 | 288.57 → 289.00 | 298.70 → 299.10 | 74.40 → 74.37 | 0.06 → 0.06 |
| c50-r1000-p1 | 997.32 → 996.99 | 22.40 → 22.97 | 357.73 → 358.52 | 396.82 → 390.39 | 93.61 → 95.10 | 0.75 → 0.76 |
| c50-r5000-p1 | 4964.95 → 4991.27 | 26.41 → 27.55 | 375.71 → 371.96 | 433.61 → 405.16 | 126.33 → 126.95 | 1.75 → 2.25 |
| c50-r1000-p4 | 998.66 → 997.78 | 57.98 → 52.22 | 526.98 → 507.32 | 623.91 → 585.99 | 129.85 → 135.15 | 9.07 → 8.00 |
| c50-r5000-p4 | 4990.37 → 4983.03 | 66.13 → 67.10 | 590.22 → 591.31 | 695.96 → 698.42 | 160.40 → 154.84 | 14.54 → 14.70 |
| c100-r5000-p4 | 4989.04 → 4987.44 | 56.22 → 56.83 | 530.06 → 544.09 | 671.58 → 630.85 | 165.45 → 146.29 | 9.40 → 9.46 |

`c10-r100-p1` initially showed 15.65% → 19.29% CPU, with two more candidate runs at 18.9% and 18.3%. Three alternating, fresh-process candidate/baseline pairs on the same host did not reproduce the gap: median 16.24% → 16.19% CPU (ranges 16.13–16.25% and 16.17–16.49%); RSS medians 330.50 → 325.25 MiB and RSS peaks 372.32 → 363.90 MiB. The observed difference depends on the run conditions; no sustained regression was reproduced in the paired runs.

## Functional verification

The focused state suite passed 77 tests. The isolated `qa:hmr` probe passed its eight reload phases. The broader `qa:app` probe timed out at its middle-click close assertion on both baseline and candidate; this probe is not evidence of a regression or a pass. No native window was opened on the host desktop.
