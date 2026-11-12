# Bot command completion

Measured on a Ryzen 7 9800X3D with Bun 1.4.4 and Linux 7.3.3-1-cachyos. Each run used private
Weston, a 1200×800 window, 200 retained messages per channel, three seconds of warmup, and
two seconds of drain. The harness verified the loaded React, JSX, and reconciler modes.

## Production comparison

Three interleaved 30-second runs per revision used 50 channels, four panes, and 5,000 offered
messages/s. Values are medians with the full observed range.

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Processed messages/s | 4990.2 (4985.1–4991.6) | 4988.4 (4987.8–4988.8) |
| App CPU, % of one core | 58.52 (48.80–68.88) | 59.37 (46.86–61.23) |
| Median RSS, MiB | 372.0 (368.0–375.7) | 375.8 (374.9–377.9) |
| Peak RSS, MiB | 445.9 (431.6–479.0) | 449.1 (432.8–467.2) |
| Peak JS heap, MiB | 164.0 (141.3–169.4) | 154.4 (136.8–160.2) |
| Event-loop lag p95, ms | 11.39 (5.02–14.70) | 8.16 (4.64–8.28) |

Every candidate run processed at least 99.7% of the offered rate. Median CPU rose by 1.5%,
median RSS by 1.0%, and median peak RSS by 0.7%. This workload injects normalized chat events
within the app process. The native composer QA below exercises active command entry.

## Default development matrix

All 15 cases completed their 12-second measurements.

| Scenario | Msg/s | App CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c1-r0-p1 | 0.0 | 1.03 | 243.9 | 245.3 | 54.9 | 0.06 |
| c1-r100-p1 | 99.7 | 25.59 | 340.5 | 386.8 | 95.0 | 1.56 |
| c1-r1000-p1 | 997.0 | 35.10 | 372.8 | 424.9 | 121.9 | 3.59 |
| c1-r5000-p1 | 4976.1 | 36.64 | 384.5 | 478.5 | 145.7 | 4.67 |
| c10-r0-p1 | 0.0 | 1.01 | 250.7 | 251.3 | 56.6 | 0.06 |
| c10-r100-p1 | 99.6 | 16.08 | 300.3 | 314.6 | 75.7 | 0.43 |
| c10-r1000-p1 | 997.7 | 26.29 | 342.2 | 385.8 | 96.0 | 1.92 |
| c10-r5000-p1 | 4980.0 | 35.15 | 364.2 | 428.1 | 124.6 | 2.77 |
| c50-r0-p1 | 0.0 | 1.07 | 262.4 | 263.4 | 63.1 | 0.06 |
| c50-r100-p1 | 99.7 | 5.30 | 275.9 | 282.4 | 69.5 | 0.06 |
| c50-r1000-p1 | 997.8 | 22.41 | 339.8 | 369.2 | 94.0 | 1.25 |
| c50-r5000-p1 | 4989.2 | 31.19 | 369.1 | 419.5 | 124.8 | 1.73 |
| c50-r1000-p4 | 994.1 | 57.90 | 514.1 | 561.6 | 131.3 | 10.26 |
| c50-r5000-p4 | 4987.1 | 75.10 | 548.0 | 709.6 | 155.3 | 19.39 |
| c100-r5000-p4 | 4989.4 | 62.57 | 533.6 | 622.4 | 166.3 | 12.33 |

## Native composer verification

The isolated X11 test used native keyboard input while injecting live chat at window widths
of 420 px and 900 px. It checked popup bounds, Escape dismissal and reopening, and Tab
insertion with `#`, `~~`, `$`, and `$$`. It also checked sender-account changes and settings
toggles. The live Supibot client returned both commands and personal aliases. The PotatBotat
endpoints returned Cloudflare HTTP 403 from the test environment, so the PotatBotat tests used
fixtures following the upstream response format.

## Provenance

| Revision | Commit | Runtime inputs SHA-256 |
| --- | --- | --- |
| Baseline | `d59786d410a04ed5c8707eb94f7ab2a7ac15e03b` | `420da82b26b94c0445728c738d8d05251f175e5ecc51a786c8e319a08ad6abd0` |
| Candidate | `10bc2c8058b3017d75e4f1f1f2be4f1d9b4cdbca` | `35cf640aa5937efbbc1d524ceee075b6e02ae35ae52913a06062769cf70858aa` |

Both revisions used GPUIX `0.11.0-twirchat.26`, API 3, patch digest `46ad1c77faaaec77`, and
native SHA-256 `56f0c097ece427490e1a2214ab9b17aade1f0bb09b58763e0149dc03b1125e00`.

```sh
bun run --cwd packages/desktop qa:gui --timeout 90 -- bun scripts/qa-autocomplete.tsx
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```
