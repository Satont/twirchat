# Desktop localization and state boundaries

The localization refactor preserved the production target at **4,996 processed messages/s** median (99.91% of offered load) and completed all 15 development cases. Translation, subscription, and scheduling algorithms are unchanged. Lower production CPU and latency in these runs do not establish a speedup.

## Provenance and workload

- Before: clean commit `5a379cc3dc06fd7334e6b456582fc9771b16fa21`; 685 runtime inputs, SHA-256 `300fce6f29bc80e905b3c1e462bb3a1c04dcb674d45258ce491983fbeb5b59d5`.
- After: the round-8 working diff on the same commit; 686 runtime inputs, SHA-256 `ea60a1699665b7926364b9baae7e411722c0ae7651af82eb7ca2d00f013dbe8b`. The benchmark harness is unchanged.
- Both: Bun 1.4.4, Linux 7.3.6-1-cachyos, AMD Ryzen 7 9800X3D, isolated headless Weston, 1200×800, 200 retained messages per channel, 3 s warmup, 2 s drain. Native addon SHA-256 `ae97bab7d71bb610e4fb93aa7cccdf247d9d88f8b9495fdc5ed25fa961d93b22`.
- Matrix: development React, 12 s per case. Production: 50 channels, four panes, 5,000 offered messages/s, 30 s per case, three fresh runs per revision. The runner verified matching React, JSX runtime and reconciler modes and checked the runtime input hashes before and after each case. No tests, builds or other benchmark processes ran concurrently.

## Production target

CPU 100% means one logical core. Every run reached at least 99% of the offered rate. RSS and JS heap are in MiB.

| Metric | Before median (range) | After median (range) | Median change |
| --- | ---: | ---: | ---: |
| Rate | 4989.55 (4988.11–4990.01) | 4995.51 (4993.51–4996.67) | +0.12% |
| CPU % | 51.38 (51.11–54.92) | 46.14 (46.01–47.00) | -10.21% |
| RSS median MiB | 388.33 (386.70–399.14) | 383.73 (382.97–383.79) | -1.19% |
| RSS peak MiB | 469.78 (450.48–494.80) | 457.70 (452.55–473.77) | -2.57% |
| JS heap peak MiB | 150.69 (146.09–156.64) | 150.20 (142.16–153.08) | -0.32% |
| Lag p95 ms | 3.12 (3.08–3.46) | 2.03 (1.90–2.46) | -35.12% |

## Development matrix

| Case | Rate (before → after) | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c1-r0-p1 | 0.00 → 0.00 | 0.99 → 0.96 | 254.52 → 254.77 | 255.68 → 255.70 | 57.01 → 57.02 | 0.06 → 0.06 |
| c1-r100-p1 | 99.67 → 99.67 | 23.78 → 25.10 | 346.98 → 341.64 | 369.64 → 388.08 | 94.46 → 89.07 | 1.69 → 1.48 |
| c1-r1000-p1 | 996.91 → 995.99 | 40.72 → 34.20 | 395.07 → 383.94 | 482.97 → 463.18 | 135.22 → 106.20 | 5.01 → 3.20 |
| c1-r5000-p1 | 4984.78 → 4979.12 | 40.29 → 35.47 | 412.16 → 400.08 | 482.29 → 464.96 | 145.05 → 142.28 | 5.86 → 4.96 |
| c10-r0-p1 | 0.00 → 0.00 | 0.96 → 0.97 | 259.63 → 257.94 | 260.48 → 258.46 | 58.56 → 58.56 | 0.06 → 0.06 |
| c10-r100-p1 | 99.67 → 99.75 | 16.00 → 16.25 | 325.23 → 327.37 | 351.77 → 360.07 | 84.78 → 88.60 | 0.23 → 0.19 |
| c10-r1000-p1 | 996.57 → 997.07 | 24.72 → 24.41 | 349.26 → 354.70 | 398.61 → 394.21 | 102.04 → 106.82 | 1.82 → 2.16 |
| c10-r5000-p1 | 4971.78 → 4982.45 | 35.33 → 33.56 | 373.58 → 379.80 | 428.10 → 460.27 | 119.32 → 114.61 | 4.22 → 4.36 |
| c50-r0-p1 | 0.00 → 0.00 | 1.10 → 1.13 | 271.91 → 271.48 | 272.31 → 272.20 | 64.90 → 64.90 | 0.06 → 0.06 |
| c50-r100-p1 | 99.67 → 99.75 | 5.43 → 5.37 | 289.20 → 289.97 | 299.21 → 302.03 | 74.38 → 74.38 | 0.06 → 0.06 |
| c50-r1000-p1 | 997.57 → 997.16 | 23.10 → 22.94 | 356.23 → 360.64 | 380.17 → 384.51 | 96.38 → 101.48 | 1.11 → 0.86 |
| c50-r5000-p1 | 4995.12 → 4993.70 | 27.59 → 27.07 | 376.34 → 376.05 | 439.06 → 443.03 | 113.28 → 123.24 | 1.81 → 2.07 |
| c50-r1000-p4 | 996.32 → 997.32 | 48.98 → 50.60 | 507.06 → 506.78 | 599.62 → 578.48 | 127.63 → 122.30 | 6.71 → 6.37 |
| c50-r5000-p4 | 4987.53 → 4988.61 | 64.65 → 65.00 | 588.39 → 596.69 | 708.30 → 704.72 | 152.15 → 156.26 | 14.21 → 12.70 |
| c100-r5000-p4 | 4989.02 → 4983.87 | 57.64 → 56.54 | 536.26 → 542.25 | 638.78 → 651.84 | 165.21 → 148.61 | 10.44 → 8.88 |

The first matrix showed +5.6% CPU in `c1-r100-p1` and +7.5% peak RSS in `c10-r5000-p1`. Three alternating fresh-process pairs per case checked whether those differences persisted.

| Case and metric | Before median (range) | After median (range) | Change |
| --- | ---: | ---: | ---: |
| `c1-r100-p1` CPU % | 24.91 (24.17–25.06) | 24.53 (24.09–24.81) | -1.53% |
| `c1-r100-p1` RSS median MiB | 342.10 (341.58–352.03) | 347.66 (344.22–352.99) | +1.63% |
| `c1-r100-p1` RSS peak MiB | 397.00 (381.61–405.18) | 384.31 (377.58–386.95) | -3.20% |
| `c10-r5000-p1` CPU % | 34.76 (34.09–35.78) | 35.37 (34.57–35.41) | +1.75% |
| `c10-r5000-p1` RSS median MiB | 379.00 (375.34–393.73) | 385.48 (373.13–387.99) | +1.71% |
| `c10-r5000-p1` RSS peak MiB | 439.89 (429.55–463.27) | 471.82 (455.69–480.75) | +7.26% |

The `c10-r5000-p1` peak RSS difference also received three separate 30 s development pairs, this time running the baseline first.

| Metric | Before median (range) | After median (range) | Change |
| --- | ---: | ---: | ---: |
| CPU % | 34.11 (34.00–34.23) | 34.37 (34.05–35.12) | +0.77% |
| RSS median MiB | 409.18 (408.10–414.66) | 418.59 (417.10–419.30) | +2.30% |
| RSS peak MiB | 522.53 (477.62–536.53) | 510.41 (500.67–524.79) | -2.32% |
| JS heap peak MiB | 145.87 (141.43–148.97) | 133.43 (132.97–139.69) | -8.52% |

At 12 s, peak RSS remained higher in the paired runs. At 30 s, peak RSS was lower (−2.32%) with overlapping ranges; median RSS was +2.30%, and JS heap peak was lower. The short-window peak difference did not persist at the longer duration. This does not establish a heap or allocator improvement.

## Functional verification

Isolated settings QA verified the live switch to Russian. Isolated HMR QA retained Russian and the translated title across eight reload phases.
