# Twitch chat join and part notices

Measured on a Ryzen 7 9800X3D with Bun 1.4.4 and Linux 7.3.3-1-cachyos. Each case used a private
Weston display, a 1200×800 window, 200 retained messages per channel, three seconds of warmup,
and two seconds of drain. The harness verified the loaded React, JSX, and reconciler modes.

## Production comparison

Three 30-second runs per revision used 50 channels, four visible panes, and 5,000 offered
messages/s. Values are medians with the full observed range.

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Processed messages/s | 4989.7 (4988.8–4993.4) | 4988.8 (4987.4–4996.1) |
| App CPU, % of one core | 44.20 (43.56–44.41) | 45.16 (44.18–50.70) |
| Median RSS, MiB | 369.1 (367.7–376.1) | 373.2 (371.5–374.8) |
| Peak RSS, MiB | 438.2 (430.2–463.7) | 449.7 (427.3–457.8) |
| Peak JS heap, MiB | 135.5 (134.1–143.8) | 137.3 (131.1–142.3) |
| Event-loop lag p95, ms | 3.85 (3.50–4.04) | 4.68 (4.35–5.79) |

Every candidate run processed at least 99.7% of the offered rate. Median CPU rose by 2.2%,
median RSS by 1.1%, peak RSS by 2.6%, and p95 event-loop lag by 0.83 ms. One candidate run
used 50.70% CPU. The other two measured 44.18% and 45.16%. The coupled generator injects
ordinary chat messages through DesktopEvents and measures the existing live chat path.

## Default development matrix

| Scenario | Msg/s | App CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c1-r0-p1 | 0.0 | 1.02 | 245.9 | 246.7 | 55.0 | 0.06 |
| c1-r100-p1 | 99.7 | 24.98 | 339.3 | 369.5 | 88.0 | 1.66 |
| c1-r1000-p1 | 995.1 | 34.00 | 367.4 | 420.9 | 121.1 | 3.44 |
| c1-r5000-p1 | 4977.8 | 38.45 | 381.8 | 462.3 | 140.1 | 5.33 |
| c10-r0-p1 | 0.0 | 1.13 | 250.4 | 251.1 | 56.7 | 0.06 |
| c10-r100-p1 | 99.7 | 16.42 | 310.0 | 334.3 | 81.7 | 0.07 |
| c10-r1000-p1 | 997.9 | 25.37 | 340.7 | 372.5 | 94.2 | 1.35 |
| c10-r5000-p1 | 4980.5 | 34.63 | 367.0 | 421.7 | 109.2 | 4.39 |
| c50-r0-p1 | 0.0 | 1.13 | 263.3 | 263.8 | 63.2 | 0.06 |
| c50-r100-p1 | 99.7 | 5.62 | 276.4 | 284.3 | 69.6 | 0.06 |
| c50-r1000-p1 | 997.5 | 24.42 | 339.1 | 370.8 | 91.4 | 0.73 |
| c50-r5000-p1 | 4991.9 | 30.89 | 359.3 | 391.0 | 112.0 | 2.15 |
| c50-r1000-p4 | 998.1 | 50.25 | 491.8 | 574.7 | 129.3 | 8.33 |
| c50-r5000-p4 | 4989.5 | 68.49 | 531.3 | 705.4 | 157.8 | 18.03 |
| c100-r5000-p4 | 4983.5 | 53.17 | 512.6 | 618.8 | 166.8 | 8.62 |

All 15 cases completed their 12-second measurements. The four-pane 5,000 msg/s case had the
highest CPU in the matrix. An isolated follow-up at the same settings measured 61.77% CPU and
689.2 MiB peak RSS on baseline, then 60.75% CPU and 687.5 MiB peak RSS on candidate. The
follow-up processed 4,996 and 4,982 msg/s, with p95 event-loop lag of 13.48 and 13.89 ms,
respectively.

## Functional verification

Isolated native GUI checks at 460 and 760 px confirmed that the muted JOIN and PART rows appear
in order between chat messages, remain inside the pane, and are scoped to the selected channel.
Disabling the setting hid existing rows immediately, skipped incoming membership notices, and
allowed ordinary chat to continue updating. Native pointer and keyboard input verified that the
switch is searchable and that Save persists the disabled value. The My Channels pane displayed
a Russian PART notice and excluded events from the watched-channel route.

## Provenance

| Revision | Commit | Runtime inputs SHA-256 |
| --- | --- | --- |
| Baseline | `1cb41c555482537e3c53b75d54b0f2bf21f91a03` | `1a20c7a3a5107d3ef582a6902597ee651fe3d52c82e2f10524a7eda0695b2170` |
| Candidate | `5134d0a48d27c3f6934935265be80b64e670cf66` | `cc536eead083b92d2b043cd2875a3a4cda722c10da3d8652d64165bd71bb9722` |

Both revisions used GPUIX `0.11.0-twirchat.27`, API 3, patch digest `14284b5e45d28bee`, and native
SHA-256 `ae97bab7d71bb610e4fb93aa7cccdf247d9d88f8b9495fdc5ed25fa961d93b22`.

```sh
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```
