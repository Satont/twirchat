# Donation events performance

AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs), Linux 7.3.1-1-cachyos, Bun 1.4.4, isolated Weston.
GPUIX 0.11.0-twirchat.25, patch digest `f6ff95b61fce09c8`, binary SHA-256 `ce789deb4d66695747865d79691dfd2400034bb7d5350c177255bdaf83ec4819`.

- Baseline commit `e895f1099eafea20fc6d6ef477d5088883ff019d`, runtime input SHA-256 `a634ff0670d8d629e4ecdbbb7f3b44787bd0f24e1978381cd62716b4bce7d5c2`.
- Candidate commit `a4c37d3727b121097561e0367e81d60b183bacda`, runtime input SHA-256 `3693be23129fac0b32e6ecb7dcfca2f3741ce6b624af9d2019525ded21704c5d`.

Both source trees were clean. Each case used a 1200×800 window and retained 200 messages per channel.
The runner verified React, JSX and reconciler mode. The fixture used ordinary chat with donation integrations disconnected.

The baseline runtime matches the rebased parent `2ca2279397a091538da5f4f119ef44ce0a113f54`.
The only difference between the measured baseline and that commit is the moderation slider benchmark report.

## Default development matrix

All 15 cases completed with 3 s of warmup, 12 s of measurement and 2 s of drain.
The candidate matrix resumed from a shorter artifact path after Weston hit the Unix socket path limit.
Each cell shows baseline → candidate. CPU is a percentage of one core. Memory is in MiB.

| Scenario | Processed msg/s | CPU % | RSS median | RSS peak | JS heap peak | Loop lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `c1-r0-p1` | 0.00 → 0.00 | 1.01 → 1.04 | 238.69 → 238.28 | 239.82 → 239.14 | 52.07 → 52.47 | 0.06 → 0.06 |
| `c1-r100-p1` | 99.65 → 99.75 | 25.49 → 26.58 | 370.84 → 374.91 | 424.26 → 442.88 | 114.42 → 116.77 | 2.14 → 1.85 |
| `c1-r1000-p1` | 996.24 → 996.74 | 35.15 → 34.21 | 398.16 → 381.55 | 510.93 → 501.27 | 158.53 → 160.74 | 4.01 → 4.58 |
| `c1-r5000-p1` | 4981.55 → 4978.87 | 37.98 → 36.91 | 406.03 → 392.44 | 509.71 → 505.54 | 166.07 → 158.12 | 4.73 → 4.42 |
| `c10-r0-p1` | 0.00 → 0.00 | 1.03 → 1.05 | 241.36 → 245.70 | 242.35 → 247.30 | 53.79 → 54.13 | 0.06 → 0.06 |
| `c10-r100-p1` | 99.58 → 99.67 | 16.47 → 15.52 | 303.19 → 303.97 | 329.35 → 327.11 | 78.13 → 77.75 | 0.56 → 0.19 |
| `c10-r1000-p1` | 998.99 → 996.82 | 24.92 → 26.86 | 371.60 → 365.77 | 438.86 → 435.26 | 129.63 → 132.94 | 1.54 → 1.84 |
| `c10-r5000-p1` | 4975.48 → 4977.04 | 34.97 → 34.80 | 386.29 → 392.60 | 488.27 → 465.05 | 161.69 → 145.46 | 3.35 → 3.78 |
| `c50-r0-p1` | 0.00 → 0.00 | 1.07 → 1.13 | 258.73 → 259.16 | 259.31 → 259.97 | 60.29 → 60.62 | 0.06 → 0.07 |
| `c50-r100-p1` | 99.67 → 99.75 | 5.26 → 5.25 | 270.20 → 271.67 | 277.84 → 279.85 | 66.33 → 66.67 | 0.06 → 0.29 |
| `c50-r1000-p1` | 997.74 → 996.99 | 21.79 → 22.43 | 346.93 → 352.37 | 400.71 → 400.99 | 112.67 → 112.41 | 1.47 → 1.36 |
| `c50-r5000-p1` | 4991.21 → 4969.12 | 28.23 → 28.70 | 382.29 → 386.14 | 467.93 → 467.09 | 161.60 → 162.06 | 2.03 → 1.53 |
| `c50-r1000-p4` | 996.57 → 996.49 | 52.09 → 50.74 | 531.24 → 539.18 | 609.09 → 635.15 | 167.99 → 170.83 | 8.67 → 8.37 |
| `c50-r5000-p4` | 4988.94 → 4988.08 | 66.59 → 64.81 | 566.79 → 530.53 | 637.09 → 694.48 | 149.10 → 163.44 | 14.54 → 14.07 |
| `c100-r5000-p4` | 4988.13 → 4985.20 | 58.90 → 61.92 | 511.13 → 506.82 | 692.37 → 567.12 | 148.86 → 139.20 | 11.53 → 10.94 |

## Production target

Three 30-second runs per version with 50 channels, four visible panes, and 5000 offered messages/s.

| Metric | Baseline median (range) | Candidate median (range) | Median change |
| --- | ---: | ---: | ---: |
| Processed msg/s | 4990.51 (4986.51–4991.29) | 4989.75 (4989.11–4991.18) | -0.0% |
| CPU % | 48.07 (46.91–48.98) | 48.24 (47.44–48.55) | +0.3% |
| RSS median MiB | 361.53 (359.17–370.31) | 366.06 (364.95–366.21) | +1.3% |
| RSS peak MiB | 452.61 (444.27–454.27) | 461.76 (457.63–466.59) | +2.0% |
| JS heap peak MiB | 163.69 (153.18–165.70) | 164.46 (155.48–166.16) | +0.5% |
| Loop lag p95 ms | 5.47 (4.85–5.62) | 5.30 (5.18–6.45) | -3.1% |

Each candidate run processed at least 99.78% of the offered rate. The in-process generator measures delivered load in this fixture.

## Development rechecks

The matrix showed one-off CPU increases at 10 and 100 channels and a higher peak RSS
at 50 channels. The paired rechecks alternated the exact rebased parent and candidate.
The parent runtime input hash matched the saved baseline above.

| Scenario | Processed msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Loop lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `c10-r1000-p1` | 998.49 → 998.07 | 26.06 → 24.90 | 377.89 → 372.03 | 440.36 → 443.51 | 134.32 → 130.44 | 1.94 → 1.62 |
| `c50-r5000-p4` | 4988.55 → 4986.53 | 67.39 → 64.33 | 516.99 → 542.89 | 674.84 → 659.45 | 164.40 → 165.11 | 14.69 → 13.98 |
| `c100-r5000-p4` | 4982.39 → 4986.81 | 56.42 → 56.05 | 512.95 → 534.05 | 650.31 → 612.42 | 157.65 → 173.62 | 12.21 → 10.53 |

The paired runs reversed the original CPU increases and the 50-channel peak RSS increase.
The 50-channel median RSS moved in opposite directions between the full matrix and the paired run.
