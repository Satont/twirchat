# Desktop memory for inline BetterTTV emotes and startup

The inline emote renderer selects a BetterTTV raster by physical display height.
At up to 28 px it requests 1x, at up to 56 px it requests 2x, and above that it
requests 3x. The YouTube adapter loads the gRPC client when an authenticated chat
connection first needs it.

## Setup

Bun 1.4.4, production React 19.3.1, Linux 7.3.1-1-cachyos, Ryzen 7 9800X3D and
Radeon RX 7800 XT. Isolated hardware-backed Weston, a fresh profile and a
1200×800 display for each process. PSS apportions shared mappings. Anonymous PSS
and decoded-frame bytes are reported separately. No forced collection or allocator
trim was used.

Both variants used native GPUIX `0.11.0-twirchat.23`, API 3, patch digest
`ec8d738268da160e` and SHA-256
`2136fb4bc568d34f6a243b218c2e4631466fa1367b379915981cc972b1fd2d3d`.

| Variant | Revision and worktree diff SHA-256 | Runtime input SHA-256 |
| --- | --- | --- |
| Baseline | `e0ff18f39bb903d3d3aa8d6bf61ccf1a434955f3`, clean | `a2df155ea054e21c733c7226b8a0faf4c63a6c31955b6467fb0fddb3baac44a4` |
| Candidate | Same revision, diff `db946787aeef7749032011782567da592f5324818167aa3139f7ff3db64ea9e4` | `5e52e0b97ae390bf9c67343515ee049c84867832a286764c0a6858385698ed3b` |

## Animated BetterTTV emote

The production `EmoteArtwork` component rendered SourPls at 28×28 logical px
with scale 1. Each run seeded the three encoded WebP variants in the private
disk cache. The raster used was 140×140 before and 35×35 after. Both inputs
contained 492 frames and identical frame delays, 14.76 s in total. All three
candidate runs painted the same 28×28 box and uploaded 100 animation frames by
the sample. Baseline runs uploaded 97–98 frames. The sample was taken three
seconds after mounting the image.

Medians (min–max) from three fresh processes per variant, in MiB.

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Decoded frames in GPUIX | 36.79 | 2.30 |
| RSS | 198.26 (197.94–198.73) | 164.23 (163.79–164.43) |
| PSS | 144.14 (143.71–144.47) | 109.83 (109.51–110.19) |
| Anonymous PSS | 79.82 (79.41–80.18) | 45.31 (45.05–45.55) |

This is the cost of one large animation in a small isolated view. The impact
during chat depends on which assets are decoded and at what scale.

| Fixture | SHA-256 |
| --- | --- |
| 1x WebP | `f0939e5effe77aff814e59f5975e3019d96509b88c3f9436ced3d5aa18eb31b4` |
| 2x WebP | `eae7c42bfb2cfd86cdd71a5af1bee9e13e8ac9362c1d6569995b4c845bf27c13` |
| 3x WebP | `b5e17484dd481adc40245939e35dbcd4f2d1aa7df0f75e6300553f10befd3d18` |

## Compiled application startup

Three alternating baseline/candidate pairs ran full local production builds
with a fresh profile and loopback backend URL. The sample was taken three
seconds after the first Wayland buffer commit. The packaged startup smoke
verified the production React and JSX runtimes. Medians (min–max) in MiB.

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| RSS | 213.98 (213.96–214.40) | 211.53 (211.20–211.56) |
| PSS | 175.43 (175.27–175.76) | 172.86 (172.57–172.99) |
| Anonymous PSS | 63.94 (63.62–64.21) | 61.15 (60.96–61.32) |

Compiled executable SHA-256 values were
`df598d39130915244ee5d1052ec9f018311a2637c034dcbdebdcc62c30e2e170` before
and `7862518f4525f5e44da260ee28b11703a8e92a958c86760b490f43a0db5b2ff0`
after. A separate source-mode probe of the same app found PSS 165.15 → 158.65
MiB. The compiled measurements are the relevant startup comparison for a
released executable.

## Production text chat

Three fresh runs per variant with 50 channels, four panes and 5,000 offered
messages/s. Each measured 30 s after 3 s warmup, with 200 retained messages per
channel. Values are medians (min–max). CPU is percent of one logical core.
The text fixture and in-process generator measure a different workload from
live provider traffic and animated chat.

| Variant | Actual msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 4993.65 (4993.08–4994.41) | 45.95 (44.63–46.65) | 366.51 (364.91–368.65) | 451.77 (444.09–461.41) | 161.16 (153.54–164.59) | 2.42 (2.03–2.46) |
| Candidate | 4991.95 (4988.65–4994.81) | 44.55 (43.78–44.58) | 361.71 (361.16–362.25) | 455.89 (443.05–471.83) | 157.13 (151.53–161.25) | 1.57 (1.57–1.88) |

All candidate runs processed at least 99.77% of offered messages. Median CPU
changed −3.0%, median RSS −1.3%, and median peak RSS +0.9%.

```sh
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```

## Default development matrix

All 15 development cases completed. Each used a fresh process, 3 s warmup,
12 s measurement and 2 s drain. These are candidate measurements.

| Channels | Panes | Offered msg/s | Actual msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 0.0 | 1.00 | 236.7 | 237.4 | 51.6 | 0.06 |
| 1 | 1 | 100 | 99.6 | 23.59 | 363.9 | 419.8 | 113.0 | 1.24 |
| 1 | 1 | 1000 | 994.9 | 33.29 | 390.3 | 489.0 | 162.2 | 2.99 |
| 1 | 1 | 5000 | 4981.9 | 35.53 | 401.4 | 477.2 | 166.9 | 4.40 |
| 10 | 1 | 0 | 0.0 | 0.96 | 242.5 | 243.4 | 53.3 | 0.06 |
| 10 | 1 | 100 | 99.7 | 15.06 | 297.5 | 323.0 | 77.3 | 0.07 |
| 10 | 1 | 1000 | 997.2 | 23.81 | 364.1 | 443.0 | 130.0 | 1.21 |
| 10 | 1 | 5000 | 4969.4 | 32.24 | 378.6 | 448.9 | 144.7 | 2.73 |
| 50 | 1 | 0 | 0.0 | 1.10 | 257.2 | 257.9 | 59.8 | 0.06 |
| 50 | 1 | 100 | 99.7 | 5.29 | 268.2 | 276.0 | 65.9 | 0.06 |
| 50 | 1 | 1000 | 996.5 | 20.78 | 352.0 | 401.7 | 110.9 | 0.96 |
| 50 | 1 | 5000 | 4995.2 | 25.97 | 384.5 | 461.7 | 158.9 | 2.06 |
| 50 | 4 | 1000 | 996.7 | 46.32 | 516.8 | 606.0 | 162.9 | 7.83 |
| 50 | 4 | 5000 | 4989.5 | 60.55 | 546.2 | 621.5 | 174.0 | 11.94 |
| 100 | 4 | 5000 | 4988.4 | 51.57 | 515.2 | 629.4 | 135.4 | 8.26 |

## Verification

- Workspace typecheck and lint completed. 1,358 tests passed and 15 PostgreSQL
  integration tests were skipped.
- The isolated production chat behavior suite passed. The focused animation
  probe also verified the selected raster and the 28×28 painted box.
- Raw run data and QA results are in the local
  `/tmp/twirchat-rss-ad35-baseline.Y4TEK1` and
  `/tmp/twirchat-rss-ad35-candidate.lrxgXL` directories.
