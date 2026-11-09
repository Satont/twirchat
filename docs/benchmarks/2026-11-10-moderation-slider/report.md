# Chat moderation slider

The Moderation setting controls whether chat rows mount the moderation slider.
The chat pane computes the flag once using the preference, existing moderation mode
and channel capability. The load fixture uses watched channels without moderator
accounts, so the slider stays hidden in this workload.

## Setup

Linux 7.3.1-1-cachyos, Ryzen 7 9800X3D, Bun 1.4.4 and isolated hardware-backed Weston.
Each process used a fresh profile, 1200×800 window and 200 retained messages per
channel. The runner verified the React, JSX and reconciler modes.

Both revisions used GPUIX `0.11.0-twirchat.25`, API 3,
patch digest `f6ff95b61fce09c8` and SHA-256
`ce789deb4d66695747865d79691dfd2400034bb7d5350c177255bdaf83ec4819`.

| Revision | Commit | Runtime inputs SHA-256 |
| --- | --- | --- |
| Baseline | `ac3a4892fa2d9a108d84d945f1caa28825bb88ff` | `f39e362258ba82686e8417e6d8c4af585ab834e67df31791b4337d1498342eb2` |
| Candidate | `e895f1099eafea20fc6d6ef477d5088883ff019d` | `a634ff0670d8d629e4ecdbbb7f3b44787bd0f24e1978381cd62716b4bce7d5c2` |

## Production target

Three fresh runs per revision at 50 channels, four panes and 5000 offered messages/s.
Each run measured 30 s after 3 s of warmup. Values are medians (min–max).
CPU is percent of one logical core.

```sh
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```

| Revision | Actual msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 4988.01 (4986.98–4992.71) | 46.49 (46.01–46.68) | 369.68 (367.59–370.14) | 466.19 (444.38–475.00) | 160.28 (150.80–170.41) | 4.85 (4.13–5.40) |
| Candidate | 4990.51 (4986.51–4991.29) | 48.07 (46.91–48.98) | 361.53 (359.17–370.31) | 452.61 (444.27–454.27) | 163.69 (153.18–165.70) | 5.47 (4.85–5.62) |

Every candidate run processed at least 99.73% of the offered rate. Median
CPU changed +3.4%, median RSS -2.2%, and median peak RSS
-2.9%. The in-process generator measures this fixture's workload.

## Default development matrix

All 15 candidate cases completed with 3 s of warmup, 12 s of measurement and
2 s of drain.

```sh
bun run --cwd packages/desktop bench:chat
```

| Channels | Panes | Offered msg/s | Actual msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 0.00 | 1.01 | 238.69 | 239.82 | 52.07 | 0.06 |
| 1 | 1 | 100 | 99.65 | 25.49 | 370.84 | 424.26 | 114.42 | 2.14 |
| 1 | 1 | 1000 | 996.24 | 35.15 | 398.16 | 510.93 | 158.53 | 4.01 |
| 1 | 1 | 5000 | 4981.55 | 37.98 | 406.03 | 509.71 | 166.07 | 4.73 |
| 10 | 1 | 0 | 0.00 | 1.03 | 241.36 | 242.35 | 53.79 | 0.06 |
| 10 | 1 | 100 | 99.58 | 16.47 | 303.19 | 329.35 | 78.13 | 0.56 |
| 10 | 1 | 1000 | 998.99 | 24.92 | 371.60 | 438.86 | 129.63 | 1.54 |
| 10 | 1 | 5000 | 4975.48 | 34.97 | 386.29 | 488.27 | 161.69 | 3.35 |
| 50 | 1 | 0 | 0.00 | 1.07 | 258.73 | 259.31 | 60.29 | 0.06 |
| 50 | 1 | 100 | 99.67 | 5.26 | 270.20 | 277.84 | 66.33 | 0.06 |
| 50 | 1 | 1000 | 997.74 | 21.79 | 346.93 | 400.71 | 112.67 | 1.47 |
| 50 | 1 | 5000 | 4991.21 | 28.23 | 382.29 | 467.93 | 161.60 | 2.03 |
| 50 | 4 | 1000 | 996.57 | 52.09 | 531.24 | 609.09 | 167.99 | 8.67 |
| 50 | 4 | 5000 | 4988.94 | 66.59 | 566.79 | 637.09 | 149.10 | 14.54 |
| 100 | 4 | 5000 | 4988.13 | 58.90 | 511.13 | 692.37 | 148.86 | 11.53 |

## Isolated native QA

X11 pointer input in the 680 px and 1280 px settings windows verified live
preview, discard, saving both values and search. The SQLite regression test
verified the default for older profiles and a round-trip with the slider disabled.

In the 620×520 and 1200×800 chat windows, a watched-channel moderator with a
populated chat previewed a timeout and cancelled the drag. After disabling the
slider, another message appeared and dragging its left edge sent no request.
Re-enabling the slider restored the preview and sent one five-minute timeout
request to the test backend.
