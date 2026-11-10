# Inline AutoMod performance

AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs), Linux 7.3.1-1-cachyos, Bun 1.4.4, isolated Weston.
Native binary SHA-256 `ce789deb4d66695747865d79691dfd2400034bb7d5350c177255bdaf83ec4819` for every run.

- Baseline commit `79422a9460e38c74fa90c1507c39124c089bd0f4`, runtime input SHA-256 `7444fe54a5e39fd234e0ab4fd956c6405ac34d92fc33353a708d457dc30d6c6a`.
- Candidate commit `838b6d29cb4a0fc3c0116d13dcf252b7fdd4c23a`, runtime input SHA-256 `8eb2a1f5a18690590128e1467dde4ba5a78ae704cd44f9eba901f4271033cbc1`.

Both source trees were clean. Each case used a 1200×800 window and retained 200 messages per channel.
The runner verified React, JSX and reconciler mode. The fixture has no Twitch AutoMod events, so this
measures the cost of the inactive feature on ordinary chat traffic.

## Default development matrix

All 15 cases completed with 3 s of warmup, 12 s of measurement and 2 s of drain.
Each cell shows baseline → candidate. CPU is a percentage of one core. Memory is in MiB.

| Scenario | Processed msg/s | CPU % | RSS median | RSS peak | JS heap peak | Loop lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `c1-r0-p1` | 0.0 → 0.0 | 0.96 → 0.99 | 244.3 → 244.1 | 245.2 → 245.1 | 53.7 → 53.7 | 0.01 → 0.02 |
| `c1-r100-p1` | 99.6 → 99.7 | 25.53 → 25.58 | 384.1 → 379.4 | 445.3 → 452.6 | 121.1 → 122.2 | 2.10 → 1.76 |
| `c1-r1000-p1` | 994.3 → 993.9 | 34.42 → 33.84 | 400.3 → 403.7 | 525.1 → 532.8 | 168.6 → 181.0 | 3.44 → 3.54 |
| `c1-r5000-p1` | 4972.3 → 4974.3 | 36.19 → 36.02 | 408.8 → 391.0 | 514.5 → 473.0 | 165.5 → 167.6 | 3.94 → 4.18 |
| `c10-r0-p1` | 0.0 → 0.0 | 0.98 → 1.03 | 251.0 → 249.6 | 252.0 → 250.9 | 55.3 → 55.4 | 0.02 → 0.01 |
| `c10-r100-p1` | 99.5 → 99.6 | 15.71 → 14.52 | 309.4 → 309.3 | 333.6 → 336.3 | 79.5 → 79.6 | 0.12 → 0.58 |
| `c10-r1000-p1` | 996.0 → 997.2 | 25.33 → 24.27 | 384.8 → 377.5 | 446.4 → 439.8 | 138.2 → 134.5 | 1.63 → 0.92 |
| `c10-r5000-p1` | 4970.5 → 4965.6 | 35.48 → 34.55 | 384.1 → 383.1 | 500.7 → 496.0 | 157.9 → 164.4 | 4.05 → 3.72 |
| `c50-r0-p1` | 0.0 → 0.0 | 1.12 → 1.05 | 261.8 → 262.5 | 263.1 → 263.2 | 61.8 → 61.9 | 0.01 → 0.01 |
| `c50-r100-p1` | 99.6 → 99.6 | 4.97 → 5.15 | 274.7 → 276.0 | 283.5 → 284.3 | 68.0 → 68.1 | 0.02 → 0.28 |
| `c50-r1000-p1` | 997.2 → 998.4 | 22.81 → 21.59 | 354.1 → 359.7 | 409.5 → 407.9 | 115.4 → 114.6 | 0.92 → 1.05 |
| `c50-r5000-p1` | 4964.4 → 4986.6 | 27.98 → 27.66 | 389.4 → 389.2 | 486.5 → 500.4 | 171.8 → 176.7 | 1.81 → 1.36 |
| `c50-r1000-p4` | 997.4 → 997.2 | 51.26 → 49.41 | 530.7 → 528.5 | 630.7 → 621.5 | 164.4 → 170.4 | 8.26 → 8.05 |
| `c50-r5000-p4` | 4985.1 → 4990.8 | 63.07 → 64.54 | 543.6 → 566.7 | 725.9 → 694.9 | 165.7 → 160.5 | 13.83 → 13.47 |
| `c100-r5000-p4` | 4983.5 → 4989.8 | 56.72 → 56.14 | 534.6 → 548.6 | 612.9 → 660.2 | 181.1 → 163.8 | 9.33 → 10.38 |

## Production target

Three 30-second runs per version with 50 channels, four visible panes, and 5000 offered messages/s.

| Metric | Baseline median (range) | Candidate median (range) | Median change |
| --- | ---: | ---: | ---: |
| Processed msg/s | 4993.05 (4975.65–4996.09) | 4995.18 (4988.32–4995.36) | +0.0% |
| CPU % | 45.46 (44.81–47.52) | 47.57 (47.16–48.10) | +4.6% |
| RSS median MiB | 373.98 (372.76–388.18) | 368.10 (366.72–372.11) | -1.6% |
| RSS peak MiB | 469.49 (467.37–518.66) | 467.70 (447.69–484.26) | -0.4% |
| JS heap peak MiB | 160.73 (160.68–197.99) | 156.73 (138.20–163.44) | -2.5% |
| Loop lag p95 ms | 4.94 (4.07–7.40) | 4.89 (4.68–5.10) | -1.0% |

Each candidate run processed at least 99.77% of the offered rate.

## Paired production rechecks

The CPU median rose 4.6% in the first set, so two more pairs alternated baseline and candidate
sources on the same host. The baseline runtime input hash matched the saved baseline above.
The candidate rechecks also contained the unused deleted `TwitchAutoMod.tsx` file, which nothing
imports; its runtime input hash is therefore `babbf8c8…` instead of `8eb2a1f5…`.

| Run | Processed msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Loop lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline 1 | 4995.5 | 46.19 | 378.2 | 476.6 | 165.8 | 5.16 |
| Candidate 1 | 4992.0 | 45.63 | 370.1 | 455.8 | 165.3 | 4.18 |
| Baseline 2 | 4994.5 | 47.46 | 366.4 | 451.0 | 136.5 | 4.29 |
| Candidate 2 | 4995.4 | 47.00 | 379.1 | 475.4 | 156.0 | 4.33 |

Both paired candidates used less CPU than the baseline run just before them, so the first-set
difference is host variation. The development `c50-r5000-p4` RSS median rose 4.2% while its peak fell
4.3%; the production target shows no RSS increase.
