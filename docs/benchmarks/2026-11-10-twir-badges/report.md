# Twir chat badge rendering verification

## Native GUI

- Isolated Xvfb runs reproduced rough edges and a zero-pixel nickname gap with the original Twir Contributor and Translator SVGs. The same fixture showed smoother edges and a visible gap after the change.
- Badge-tooltip QA verified a transparent 32×32 PNG for a 16 px badge and measured a 5 px nickname gap in compact and modern chat. Both themes passed the tooltip and live traffic checks at 420×300 and 900×600.
- Message appearance QA passed at both window widths. The thumbnail tests cover rectangular SVGs, transparency, cache isolation between fit modes and worker IPC.

## Production target

Three 30-second measurements per revision used a three-second warmup, private Weston at 1200×800, 50 channels, four panes, 5,000 offered messages/s and 200 retained messages per channel. The benchmark uses text-only compact chat with avatars and provider cosmetics disabled. It measures the shared chat path. The SVG thumbnail path is covered by native GUI and thumbnail tests.

Medians and ranges. CPU is a percentage of one logical core. Memory is in MiB.

| Revision | Processed msg/s | CPU % | Median RSS | Peak RSS | Peak JS heap | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 4991.61 (4989.61–4994.01) | 51.01 (50.74–52.69) | 370.37 (369.09–371.85) | 468.27 (465.51–469.00) | 172.21 (159.26–179.12) | 5.32 (5.14–6.09) |
| Candidate | 4990.05 (4987.21–4992.15) | 46.87 (46.29–47.11) | 374.52 (363.62–376.75) | 464.19 (459.98–480.94) | 167.22 (165.96–171.17) | 5.26 (4.61–5.36) |

Every candidate run processed at least 99.74% of the offered rate. Median CPU changed by -8.12%, median RSS by +1.12% and median peak RSS by -0.87%.

## Development matrix

All 15 default scenarios completed with a three-second warmup and a 12-second measurement. This matrix uses development React. The four-pane target processed 99.78% of offered load.

| Scenario | Processed msg/s | CPU % | Median RSS | Peak RSS | Peak JS heap | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c1-r0-p1 | 0.00 | 1.01 | 239.49 | 240.66 | 53.14 | 0.07 |
| c1-r100-p1 | 99.58 | 26.68 | 375.88 | 447.28 | 124.92 | 1.96 |
| c1-r1000-p1 | 996.24 | 35.45 | 406.94 | 516.51 | 169.02 | 4.11 |
| c1-r5000-p1 | 4979.78 | 36.87 | 398.66 | 510.20 | 157.09 | 4.56 |
| c10-r0-p1 | 0.00 | 1.04 | 247.74 | 248.68 | 54.90 | 0.06 |
| c10-r100-p1 | 99.58 | 15.88 | 305.27 | 330.57 | 79.05 | 0.40 |
| c10-r1000-p1 | 997.91 | 23.99 | 375.11 | 440.83 | 136.98 | 1.95 |
| c10-r5000-p1 | 4978.53 | 34.53 | 376.79 | 489.75 | 155.99 | 3.55 |
| c50-r0-p1 | 0.00 | 1.13 | 260.36 | 260.76 | 61.38 | 0.06 |
| c50-r100-p1 | 99.67 | 5.35 | 273.54 | 280.37 | 67.65 | 0.06 |
| c50-r1000-p1 | 998.24 | 23.30 | 358.34 | 406.41 | 115.25 | 1.26 |
| c50-r5000-p1 | 4989.82 | 26.54 | 386.78 | 481.96 | 160.02 | 1.88 |
| c50-r1000-p4 | 997.16 | 48.50 | 534.04 | 635.03 | 171.88 | 7.85 |
| c50-r5000-p4 | 4988.78 | 64.79 | 541.57 | 663.07 | 191.02 | 13.79 |
| c100-r5000-p4 | 4987.33 | 54.37 | 527.72 | 627.97 | 179.52 | 10.86 |

## Provenance

- Baseline commit `c53028bc590e2baed081b463720c177e32bb54e2` and runtime input SHA-256 `9ebe8ffca627385c7c4d0793185da5796ae81c9385b2bbd68a80f46f0923567b`.
- Candidate commit `271a1e5a14b116d0dc32de564dc71463642f76d1` and runtime input SHA-256 `0f6e6c79c9672e2a78d1c01a55e75228488a07b1aab88650d619411dc0ace8aa`.
- Both revisions were measured from a clean checkout and used Bun 1.4.4 and GPUIX 0.11.0-twirchat.25 with native artifact SHA-256 `ce789deb4d66695747865d79691dfd2400034bb7d5350c177255bdaf83ec4819`.

The badge patch was rebased unchanged onto the desktop OAuth update (`4c5f2de`). Workspace checks and native badge QA passed on the rebased tree. A production spot check on `aa06e56ed36481ac84078cbc40746351f157bb23` (runtime input SHA-256 `04b88c6870716bb28d625e1735be91ece28f492c5739943bbc76c57dd280ef13`) processed 4987.38 messages/s at 47.24% CPU, 370.86 MiB median RSS, 480.02 MiB peak RSS, 180.36 MiB peak JS heap and 5.62 ms lag p95.

```sh
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```
