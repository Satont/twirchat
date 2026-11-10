# Donation sharing performance

AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs), Linux 7.3.1-1-cachyos, Bun 1.4.4, isolated Weston.
GPUIX 0.11.0-twirchat.25, patch digest `f6ff95b61fce09c8`, binary SHA-256 `ce789deb4d66695747865d79691dfd2400034bb7d5350c177255bdaf83ec4819`.
Both trees used the same native binary.

- Baseline commit `79422a9460e38c74fa90c1507c39124c089bd0f4`, runtime input SHA-256 `7444fe54a5e39fd234e0ab4fd956c6405ac34d92fc33353a708d457dc30d6c6a`.
- Candidate commit `c7eaedc12651dcda13dc4bac910679957f7438b7`, runtime input SHA-256 `c684ce840e1035906f3ec7aba447ed27a8135c8c0347d85ac6c3b37577d3bc88`.
  This report is the only change after that commit and is not a runtime input.

Both source trees were clean. Each case used a 1200×800 window and retained 200 messages per channel.
The runner verified React, JSX and reconciler mode. The fixture used ordinary chat with no backend
connection and no donation integrations, so the measured change is the extra shared-donation store
selector in every `ChatView`.

## Default development matrix

All 15 cases completed with 3 s of warmup, 12 s of measurement and 2 s of drain.
The baseline ran from a tmpfs worktree and the candidate from the home disk; see the rechecks below.
Each cell shows baseline → candidate. CPU is a percentage of one core. Memory is in MiB.

| Scenario | Processed msg/s | CPU % | RSS median | RSS peak | Loop lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| `c1-r0-p1` | 0.00 → 0.00 | 1.00 → 1.07 | 237.92 → 244.03 | 239.10 → 244.93 | 0.02 → 0.02 |
| `c1-r100-p1` | 99.67 → 99.58 | 24.77 → 26.27 | 365.53 → 377.53 | 431.02 → 442.79 | 0.97 → 1.14 |
| `c1-r1000-p1` | 994.08 → 994.41 | 32.99 → 34.28 | 387.25 → 393.00 | 492.59 → 511.95 | 4.38 → 3.05 |
| `c1-r5000-p1` | 4976.72 → 4971.33 | 37.23 → 35.44 | 387.09 → 404.98 | 467.74 → 494.36 | 3.64 → 4.09 |
| `c10-r0-p1` | 0.00 → 0.00 | 1.02 → 0.97 | 245.23 → 250.84 | 246.00 → 251.59 | 0.02 → 0.01 |
| `c10-r100-p1` | 99.58 → 99.58 | 16.35 → 15.62 | 298.86 → 308.66 | 329.18 → 330.25 | 0.63 → 0.28 |
| `c10-r1000-p1` | 997.58 → 996.24 | 24.33 → 22.94 | 373.14 → 374.47 | 431.12 → 456.25 | 1.49 → 1.69 |
| `c10-r5000-p1` | 4977.89 → 4972.39 | 34.20 → 33.13 | 378.00 → 399.19 | 489.25 → 521.75 | 4.10 → 3.58 |
| `c50-r0-p1` | 0.00 → 0.00 | 1.08 → 1.11 | 257.59 → 263.25 | 258.33 → 263.94 | 0.02 → 0.01 |
| `c50-r100-p1` | 99.67 → 99.67 | 5.30 → 5.49 | 268.77 → 276.07 | 276.00 → 284.77 | 0.07 → 0.33 |
| `c50-r1000-p1` | 998.33 → 997.00 | 21.73 → 23.26 | 351.61 → 356.32 | 401.65 → 408.17 | 0.72 → 0.47 |
| `c50-r5000-p1` | 4989.81 → 4987.39 | 25.02 → 26.91 | 388.04 → 391.19 | 481.40 → 492.12 | 1.94 → 1.78 |
| `c50-r1000-p4` | 995.49 → 996.08 | 50.71 → 48.92 | 521.80 → 539.35 | 643.61 → 633.62 | 7.90 → 7.51 |
| `c50-r5000-p4` | 4989.83 → 4986.80 | 65.44 → 62.35 | 533.73 → 541.18 | 709.94 → 665.18 | 13.95 → 12.77 |
| `c100-r5000-p4` | 4986.87 → 4983.97 | 57.61 → 54.90 | 515.58 → 523.73 | 595.26 → 662.42 | 10.85 → 9.24 |

## Development rechecks

RSS median was higher in almost every candidate cell, including idle ones, and CPU rose 6–7% in
three cells. The rechecks ran both commits from tmpfs worktrees and alternated them, two pairs per
cell. The idle offset disappeared, so it came from the worktree location, not the change.

| Scenario | Run | Processed msg/s | CPU % | RSS median MiB | RSS peak MiB | Loop lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `c1-r0-p1` | 1 | 0.00 → 0.00 | 1.01 → 1.01 | 235.42 → 235.50 | 236.15 → 236.41 | 0.02 → 0.01 |
| `c1-r0-p1` | 2 | 0.00 → 0.00 | 1.06 → 0.98 | 235.97 → 237.34 | 236.63 → 238.38 | 0.02 → 0.01 |
| `c1-r100-p1` | 1 | 99.58 → 99.75 | 24.31 → 23.50 | 373.29 → 372.05 | 423.84 → 439.26 | 0.81 → 1.71 |
| `c1-r100-p1` | 2 | 99.67 → 99.67 | 24.89 → 25.54 | 372.27 → 377.05 | 442.69 → 440.12 | 1.38 → 2.13 |
| `c10-r5000-p1` | 1 | 4969.47 → 4967.21 | 34.66 → 34.88 | 399.86 → 390.02 | 487.35 → 484.93 | 4.14 → 4.18 |
| `c10-r5000-p1` | 2 | 4968.04 → 4974.71 | 35.91 → 36.00 | 377.27 → 384.05 | 472.66 → 462.50 | 3.45 → 4.03 |
| `c50-r1000-p1` | 1 | 996.50 → 996.33 | 21.57 → 21.75 | 353.25 → 351.65 | 393.88 → 395.48 | 1.42 → 0.87 |
| `c50-r1000-p1` | 2 | 997.58 → 997.24 | 22.18 → 22.74 | 351.46 → 352.54 | 403.94 → 404.64 | 0.47 → 0.90 |
| `c50-r5000-p1` | 1 | 4987.56 → 4993.93 | 26.18 → 28.32 | 394.67 → 388.76 | 483.64 → 484.00 | 1.71 → 1.42 |
| `c50-r5000-p1` | 2 | 4991.22 → 4989.29 | 28.48 → 28.19 | 405.36 → 379.60 | 509.83 → 471.32 | 2.12 → 1.36 |

## Production target

50 channels, four visible panes, 5000 offered messages/s, 30-second runs.
Set A ran baseline from tmpfs and candidate from the home disk. Set B ran both from tmpfs, alternating.

| Metric | Set A baseline | Set A candidate | Change | Set B baseline | Set B candidate | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Processed msg/s | 4996.39 (4993.29–4996.78) | 4990.02 (4986.15–4993.69) | -0.1% | 4995.81 (4989.39–4995.81) | 4994.05 (4986.72–4995.70) | -0.0% |
| CPU % | 46.74 (46.60–47.31) | 47.81 (47.46–48.91) | +2.3% | 45.86 (45.33–46.10) | 47.50 (46.19–48.01) | +3.6% |
| RSS median MiB | 362.16 (356.96–365.79) | 374.17 (370.94–378.83) | +3.3% | 364.22 (363.56–370.44) | 361.02 (360.62–365.49) | -0.9% |
| RSS peak MiB | 467.37 (451.61–467.97) | 468.95 (452.39–495.81) | +0.3% | 464.53 (437.37–475.01) | 445.78 (442.55–469.37) | -4.0% |
| Loop lag p95 ms | 4.48 (4.45–5.10) | 5.57 (4.41–6.20) | +24.4% | 4.61 (3.59–4.83) | 5.24 (4.26–5.36) | +13.8% |

Values are medians with ranges over three runs. Every candidate run processed at least 99.73% of
the offered rate.

## Conclusion

Memory shows no regression once both trees run from the same filesystem. Production CPU is
2–4% higher in both sets, under the 5% investigation threshold. Loop lag p95 is about 0.6 ms
higher, with overlapping ranges. The only code this fixture exercises is one extra
`useStoreSelector` per pane that reads an empty map, so these deltas are within the
host variation seen in earlier reports rather than a measured cost of the change.
