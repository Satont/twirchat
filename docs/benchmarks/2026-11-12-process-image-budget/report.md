# Process-wide decoded image budget

GPUIX accounts for decoded pixels once per resource across windows. When the
total exceeds 128 MiB, the windows release least recently used cold entries
until the total reaches 96 MiB or all remaining entries are pinned by a live
scene. Each window still has its 64 MiB / 256-entry cache budget and four-minute
idle expiry. The process threshold controls retained frame pixels. Decoder work
buffers, GPU textures, and memory reserved by the allocator have separate costs.

## Four windows with disjoint animations

Three fresh processes per variant on Linux 7.3.3-1-cachyos, Bun 1.4.4, Ryzen 7
9800X3D and Radeon RX 7800 XT. The private hardware-backed Weston desktop was
1200×800. Four 280×150 native windows each painted 16 distinct absolute-path
WebP resources in successive batches of 5, 5, 5 and 1. Every image had 64
120×120 frames at 100 ms. Each batch completed before the next. The measured
steady interval was five seconds with one live animation per window. The
bench then revisited the first batch in each window and closed all four windows.
Both variants verified production React, JSX runtime and reconciler.

Values are medians (min–max). Memory is in MiB and CPU is percent of one core.

| Metric | Before | With process budget |
| --- | ---: | ---: |
| Retained decoded frames | 225.00 | 119.53 |
| Steady RSS | 445.80 (445.53–445.85) | 367.98 (361.35–382.61) |
| Steady peak RSS | 445.81 (445.65–456.32) | 367.98 (361.35–393.03) |
| Steady end PSS | 385.04 (384.81–385.46) | 306.66 (300.25–321.44) |
| Peak RSS during loading | 461.66 (457.60–462.34) | 387.20 (380.08–394.11) |
| Load time, ms | 504.84 (504.72–586.06) | 505.31 (504.66–545.11) |
| Load CPU | 62.54 (56.22–66.22) | 64.16 (56.82–65.53) |
| Steady CPU | 1.82 (1.66–2.26) | 1.79 (1.79–1.84) |
| Steady peak JS heap | 5.87 (5.86–12.77) | 5.87 (5.87–12.75) |
| Steady event-loop lag p95, ms | 0.057 (0.057–0.060) | 0.058 (0.056–0.058) |
| Repeat decodes on the four revisits | 0 | 20 |
| Time to paint a revisited batch, ms | 20.15 (20.09–20.84) | 20.16 (20.08–40.29) |

The budget lowered median process RSS by 77.82 MiB (17.5%). The final
119.53 MiB includes resources loaded after the last trim cycle, below the
128 MiB threshold. All visible animations advanced with zero new decodes
during measurement. Each closed window released its cache. The revisit
timer polls at 20 ms. Two candidate batches needed a second poll.

This stress test paints native images directly and measures the trade-off when
several windows retain disjoint sets. The test assigns the same encoded fixture
bytes to distinct paths to fix the decode workload while varying cache identity.

## Provenance

Both variants used base commit `d1b27dc6cccf93d6cfbcb3438175b1ba8a4d234d`.
The focused fixture was stored locally at
`packages/desktop/dist/bench-image-pressure.tsx`, SHA-256
`745ee1520c501e842f32f9dd67c44cacf93cd26291ba0988d68f7ea8e685bdaa`.
The WebP SHA-256 was
`efa416462840287c2aaa6e6c3aa3b72a5de6fd0fc8f3f153673a373853a0558e`.

| Variant | Native version | Patch digest | Linux x64 addon SHA-256 |
| --- | --- | --- | --- |
| Before | `0.11.0-twirchat.25` | `f6ff95b61fce09c8` | `ce789deb4d66695747865d79691dfd2400034bb7d5350c177255bdaf83ec4819` |
| After | `0.11.0-twirchat.26` | `7211b2d8e07c0ae6` | `07cd67b2a49cfd2ee64040f01d3f168c986fcd59b1b19ff1cc3c89a330ba047b` |

## Production chat target

50 channels, four panes, 200 retained messages per channel and 5,000 offered
messages per second. Three fresh processes per variant, each with a
three-second warmup and 30-second measurement at 1200×800 on hardware-backed
Weston. Values are medians (min–max). CPU is percent of one core.

| Metric | Before | With process budget |
| --- | ---: | ---: |
| Processed messages/s | 4992.18 (4991.45–4994.54) | 4988.71 (4988.04–4992.75) |
| CPU % | 53.41 (51.43–55.40) | 47.86 (47.73–49.10) |
| RSS median, MiB | 373.42 (372.80–376.30) | 374.47 (369.20–375.64) |
| RSS peak, MiB | 431.20 (431.01–440.43) | 426.56 (421.19–431.25) |
| JS heap peak, MiB | 142.99 (137.88–144.56) | 146.07 (137.94–149.88) |
| Event-loop lag p95, ms | 6.50 (5.90–7.41) | 5.33 (4.92–5.95) |

Runtime input SHA-256 before and after.
- `053da4d3630ea7744b7c34bfb0944450440af0b57da5b0198fdaacdcad78114d`
- `1127fdd6ad07bd401a1f3f94a455e92616cfd5194df16c59d19fbc2e615e7702`

## Development chat matrix

The default matrix runs 15 workloads with development React, three seconds
of warmup and 12 seconds of measurement per workload. CPU is percent of one
core. Memory is in MiB. Each cell lists before → after.

| Channels | Panes | Offered msg/s | Processed msg/s | CPU % | RSS median | RSS peak | JS heap peak | Lag p95, ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 0.00 → 0.00 | 0.99 → 1.00 | 246.12 → 246.47 | 247.30 → 247.61 | 54.83 → 54.73 | 0.06 → 0.06 |
| 1 | 1 | 100 | 99.80 → 99.75 | 30.03 → 30.05 | 333.40 → 340.57 | 370.55 → 376.41 | 85.58 → 87.44 | 2.79 → 2.23 |
| 1 | 1 | 1000 | 995.91 → 995.82 | 38.62 → 36.68 | 384.67 → 374.18 | 447.14 → 428.88 | 117.58 → 117.80 | 4.77 → 5.06 |
| 1 | 1 | 5000 | 4979.52 → 4985.20 | 41.33 → 40.92 | 379.66 → 387.71 | 446.59 → 432.16 | 133.42 → 139.24 | 4.37 → 5.57 |
| 10 | 1 | 0 | 0.00 → 0.00 | 1.11 → 1.22 | 251.30 → 251.79 | 251.93 → 252.33 | 56.49 → 56.49 | 0.06 → 0.06 |
| 10 | 1 | 100 | 99.67 → 99.58 | 17.75 → 17.88 | 310.50 → 309.24 | 336.87 → 334.77 | 81.59 → 81.37 | 0.14 → 0.49 |
| 10 | 1 | 1000 | 998.67 → 999.49 | 28.24 → 30.29 | 336.26 → 337.25 | 375.73 → 370.15 | 97.81 → 93.19 | 2.21 → 2.57 |
| 10 | 1 | 5000 | 4975.62 → 4983.11 | 37.98 → 45.93 | 389.98 → 376.33 | 450.21 → 456.71 | 138.04 → 147.29 | 3.95 → 6.31 |
| 50 | 1 | 0 | 0.00 → 0.00 | 1.07 → 1.14 | 263.09 → 263.60 | 263.54 → 264.30 | 62.97 → 62.98 | 0.06 → 0.06 |
| 50 | 1 | 100 | 99.75 → 99.75 | 6.64 → 5.94 | 275.47 → 276.55 | 281.73 → 284.07 | 69.41 → 69.56 | 0.06 → 0.06 |
| 50 | 1 | 1000 | 997.74 → 994.24 | 24.69 → 28.73 | 346.23 → 345.06 | 366.36 → 368.16 | 100.50 → 97.14 | 1.45 → 1.08 |
| 50 | 1 | 5000 | 4989.27 → 4994.79 | 26.73 → 30.92 | 368.44 → 373.23 | 411.09 → 407.19 | 114.87 → 113.91 | 1.91 → 1.27 |
| 50 | 4 | 1000 | 997.77 → 997.41 | 48.93 → 63.89 | 496.83 → 507.09 | 601.04 → 626.27 | 128.42 → 131.46 | 7.99 → 12.54 |
| 50 | 4 | 5000 | 4985.87 → 4980.21 | 63.08 → 74.98 | 556.29 → 536.26 | 713.91 → 671.11 | 171.44 → 165.52 | 13.78 → 19.20 |
| 100 | 4 | 5000 | 4987.62 → 4985.02 | 55.14 → 71.54 | 533.61 → 522.11 | 621.00 → 669.97 | 138.26 → 156.84 | 9.05 → 16.20 |

The first matrix pass showed higher CPU in several text scenarios. Repeating
three of the largest increases with the original and candidate binaries under
the same settings yielded the measurements below. The text fixture generates
messages with empty emote and badge lists. The production target processed at
least 99.76% of the offered rate in each candidate run.

| Scenario | Initial CPU % before → after | Repeat CPU % before → after | Repeat RSS median MiB before → after | Repeat RSS peak MiB before → after |
| --- | ---: | ---: | ---: | ---: |
| c10-r5000-p1 | 37.98 → 45.93 | 39.81 → 33.45 | 387.13 → 373.15 | 486.62 → 439.02 |
| c50-r1000-p4 | 48.93 → 63.89 | 51.53 → 50.93 | 495.05 → 498.30 | 609.74 → 579.22 |
| c100-r5000-p4 | 55.14 → 71.54 | 57.67 → 59.23 | 516.33 → 527.58 | 624.69 → 653.57 |

## Functional checks

- The candidate held 140.625 MiB across 40 simultaneously visible animations,
  with zero evictions and 40 decodes. After 20 images left the screen, the
  cache reached 94.92 MiB and retired 13 cold entries. The 20 visible
  animations kept uploading frames and the decode count stayed at 40.
- The native emote QA verified source selection, playback in focused and
  unfocused windows, decode sharing, and resource release on close.
- The Linux native release build and 384 native unit tests passed.

```sh
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
bun run --cwd packages/desktop qa:gui --node-env production --compositor weston --weston-shell desktop --keep --timeout 90 -- bun dist/bench-image-pressure.tsx
bun run --cwd packages/desktop qa:gui --node-env production --compositor weston --weston-shell desktop --keep --timeout 60 -- bun dist/qa-image-pressure-pinned.tsx
```
