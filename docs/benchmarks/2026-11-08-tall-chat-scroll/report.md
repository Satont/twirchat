# Tall chat virtual scrolling

GPUI reported an empty visible range while following the bottom of a list. ChatView kept only
the 24 newest rows mounted. A tall compact viewport could fit those rows without overflowing,
leaving older messages inaccessible to the wheel. GPUI now uses the offset resolved during
prepaint. ChatView uses the exclusive end of the range.

With 80 short messages in the isolated Linux GUI fixture, the old build painted exactly 24
at 1600×1380. The fix passed at 1600×1380 and 620×520. The check covers more than 24 painted
rows, a new message moving previous rows upward at the tail, scrolling to the oldest message,
live arrivals while reading history, and returning to live chat. All 35 GPUI list tests passed.

## Provenance

Bun 1.4.4, Linux 7.3.1-1-cachyos, Ryzen 7 9800X3D, private hardware-backed Weston.
All load cases used a fresh process at 1200×800 with 200 retained messages per channel.
The runner verified the loaded React, JSX runtime and reconciler for each mode.

| Build | Source commit | Native | Native SHA-256 | Runtime input SHA-256 |
| --- | --- | --- | --- | --- |
| Before | `3be3b037866140d23dd3fcb8ff20044d3eb4fda2` | `0.11.0-twirchat.18` | `8d2b8e7543b2fc7246cc7120a6ff41bc425321c1c7c166da6b7dda18720fbed0` | `0fee2f74a151e408669b36bb37ed1b80abfac51184277c4c684513dbc0f1dde7` |
| After | `b736b9ac28862659a03ea933b9c1eae3c8a6e06a` | `0.11.0-twirchat.19` | `391028fafbfd24b555959afd21707e7002e2bb9bc37d1790faf3d8f612f737d6` | `8579587c3b8c9127c1bb225bd7fd2878be8e5305203a1b0a398df45cd5f9c6d0` |

## Production target

Three initial runs per build, followed by two alternating before/after pairs. Each run used
50 channels, four panes and 5000 total messages/s, with 3 s warmup, 30 s measurement and
2 s drain. Values are median (min–max). CPU is percent of one logical core. Memory is in MiB.

| Runs | Actual msg/s | CPU % | RSS median | RSS peak | JS heap peak | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial before | 4992.5 (4991.7–4992.8) | 44.6 (44.2–45.2) | 364.8 (359.0–365.2) | 454.0 (446.8–460.1) | 169.1 (150.7–178.4) | 1.73 (1.65–2.18) |
| Initial after | 4991.8 (4990.5–4995.3) | 49.0 (45.0–51.4) | 363.1 (362.8–364.8) | 460.1 (430.4–461.5) | 153.2 (151.8–155.9) | 1.96 (1.96–2.88) |
| Paired before | 4994.2 (4993.8–4994.6) | 48.4 (47.9–48.9) | 359.2 (355.2–363.2) | 453.4 (448.9–458.0) | 167.0 (165.0–169.0) | 2.44 (2.26–2.62) |
| Paired after | 4989.1 (4988.5–4989.6) | 51.9 (51.4–52.4) | 367.6 (358.2–377.0) | 472.7 (465.5–479.9) | 170.6 (167.1–174.1) | 3.34 (3.21–3.47) |

Initial CPU medians moved from 44.6% to 49.0%. Another host task started a Rust build
during the third run after the fix. The follow-up pairs used checksum-verified local copies
of both native artifacts. Earlier pairs using a rebuilt baseline artifact were excluded.

CPU moved from 48.9% to 51.4% in the first confirmed pair and from 47.9% to 52.4% in the
second. The paired median rose 7.1%. Paired median RSS grew 2.3% and peak RSS grew 4.2%.
Every target run processed at least 99.7% of the offered rate.

A separate instrumented two-second run on each build at the same target counted visible-range
events and ChatView renders across all four panes. The old addon reported four empty tail
ranges. The new addon reported 32 range changes as differently wrapped messages moved through
the viewport. ChatView rendered 209 times before and 237 times after. Both runs stayed at
24 mounted rows per live tail. The extra React work came from receiving real changes to the
visible range. ChatView uses those changes to grow the tail when a taller window needs more
rows and to update which rows can prepare artwork.

## Default development matrix

Each case used 3 s warmup, 12 s measurement and 2 s drain with the fixed build.
The synthetic workload uses compact text chat with provider artwork disabled. The matrix
resumed from completed cases after host builds interrupted measurement. Overlapping cases
were rerun.

| Channels | Panes | Offered msg/s | Actual msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 0.0 | 1.0 | 243.7 | 244.6 | 53.1 | 0.06 |
| 1 | 1 | 100 | 99.7 | 25.8 | 374.6 | 429.5 | 118.3 | 1.88 |
| 1 | 1 | 1000 | 996.2 | 35.2 | 416.5 | 508.6 | 167.5 | 4.70 |
| 1 | 1 | 5000 | 4982.4 | 39.5 | 386.5 | 499.9 | 169.9 | 4.36 |
| 10 | 1 | 0 | 0.0 | 1.1 | 243.4 | 244.0 | 54.5 | 0.06 |
| 10 | 1 | 100 | 99.7 | 16.4 | 305.2 | 329.1 | 78.8 | 0.12 |
| 10 | 1 | 1000 | 997.2 | 24.4 | 384.9 | 444.2 | 139.2 | 1.60 |
| 10 | 1 | 5000 | 4971.8 | 34.5 | 391.3 | 488.1 | 172.1 | 3.16 |
| 50 | 1 | 0 | 0.0 | 1.0 | 257.2 | 257.8 | 60.9 | 0.06 |
| 50 | 1 | 100 | 99.7 | 5.4 | 272.2 | 277.9 | 67.1 | 0.06 |
| 50 | 1 | 1000 | 997.5 | 28.1 | 358.9 | 406.9 | 114.4 | 1.52 |
| 50 | 1 | 5000 | 4993.3 | 29.9 | 380.3 | 471.7 | 158.1 | 2.06 |
| 50 | 4 | 1000 | 996.7 | 52.6 | 526.6 | 582.5 | 164.9 | 8.65 |
| 50 | 4 | 5000 | 4989.8 | 65.9 | 545.8 | 682.4 | 161.1 | 13.95 |
| 100 | 4 | 5000 | 4989.0 | 56.4 | 503.4 | 611.7 | 160.2 | 9.80 |
