# Twitch chat notices and AutoMod

Linux 7.3.1-1-cachyos, AMD Ryzen 7 9800X3D 8-Core Processor, Radeon RX 7800 XT, Bun 1.4.4,
hardware-backed isolated Weston. The runner used a 1200×800 window, 200 retained messages
per channel and verified the loaded React, JSX and reconciler mode. This workload exercises
the DesktopEvents-to-ChatView path under ordinary text load. The generator runs in the
same process and can defer or miss offers when the event loop falls behind.

## Repeated production target

50 channels, four panes, 5000 total messages/s, 3 seconds of warmup and 30 seconds of
measurement per fresh process. The table reports medians and ranges. Memory is in MiB
and CPU is percent of one logical core.

| Runs | Actual msg/s | CPU % | Median RSS | Peak RSS | Peak JS heap | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline, initial (3) | 4995.8 (4995.0–4997.5) | 47.4 (47.0–49.4) | 360.6 (355.9–366.8) | 456.2 (453.4–467.9) | 161.0 (142.0–164.0) | 2.7 (2.5–3.0) |
| Notices (3) | 4995.8 (4986.9–4997.5) | 49.8 (47.4–50.3) | 368.8 (359.9–381.8) | 481.9 (440.0–490.1) | 171.7 (161.2–190.5) | 3.2 (2.8–3.7) |
| Baseline, repeat (3) | 4990.5 (4990.0–4991.6) | 43.6 (43.5–43.7) | 362.0 (361.9–364.9) | 458.2 (441.1–459.9) | 154.5 (147.9–157.5) | 2.2 (1.8–2.3) |
| Notices, repeat (3) | 4992.9 (4992.8–4993.0) | 44.0 (43.3–44.5) | 362.3 (356.0–374.6) | 457.9 (449.0–466.1) | 166.1 (158.8–179.6) | 2.4 (2.2–2.5) |
| Baseline, all (6) | 4993.3 (4990.0–4997.5) | 45.4 (43.5–49.4) | 361.9 (355.9–366.8) | 457.2 (441.1–467.9) | 156.0 (142.0–164.0) | 2.4 (1.8–3.0) |
| Notices, all (6) | 4993.0 (4986.9–4997.5) | 45.9 (43.3–50.3) | 365.6 (356.0–381.8) | 462.0 (440.0–490.1) | 168.9 (158.8–190.5) | 2.6 (2.2–3.7) |

All candidate runs processed at least 99.74% of the offered rate.
Against the initial baseline, median CPU changed +5.0%, median RSS +2.3%,
and peak RSS +5.6%. After the peak crossed 5%, we repeated both versions
with the same runtime. In the second series the corresponding changes were +0.9%,
+0.1%, and -0.1%. Across both series they were +1.3%,
+1.0%, and +1.0%.

Across both series, median peak JS heap rose from 156.0 to 168.9 MiB and median p95 event-loop
lag rose from 2.4 to 2.6 ms.

### Provenance

| Variant | Source commit | Runtime input SHA-256 |
| --- | --- | --- |
| Baseline | `149e97c98f5028f3d61d031a1d74bb997926b9d6` | `c97e263ef92f7e38698cd2b996184dc771c8553990c90ea92316767ad76eb1d9` |
| Notices, initial and matrix | `bb37e7081af5a5f71fa8ac0a1bb10fc67fdb335a` | `4fe35c550719160bf79dc47eb25895f9bea6776c2f6d74f47357750643c13718` |
| Notices, repeat | `181164544ff9f0c9453ae7cbfc0150174be2fbfe` | `4fe35c550719160bf79dc47eb25895f9bea6776c2f6d74f47357750643c13718` |

Both variants loaded native `0.11.0-twirchat.21` with patch digest `497da172581fc4ac`
and SHA-256 `c666e70a10a66ee0d7b8c97d1d8e18f0d62b0cc98dc4db018aa858f1f3ea46c7`.
The repeat candidate includes a packaging fix. Its measured runtime inputs are identical.

## Default development matrix

All 15 scenarios completed with 3 seconds of warmup and 12 seconds of measurement.

| Channels | Panes | Offered msg/s | Actual msg/s | CPU % | Median RSS | Peak RSS | Peak JS heap | Lag p95 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 0.0 | 1.0 | 242.4 | 242.9 | 53.3 | 0.1 |
| 1 | 1 | 100 | 99.8 | 27.7 | 371.1 | 439.1 | 119.3 | 1.9 |
| 1 | 1 | 1000 | 995.6 | 33.5 | 380.8 | 505.7 | 166.9 | 4.0 |
| 1 | 1 | 5000 | 4981.5 | 34.2 | 394.4 | 502.7 | 158.1 | 3.6 |
| 10 | 1 | 0 | 0.0 | 0.9 | 242.9 | 243.6 | 54.7 | 0.1 |
| 10 | 1 | 100 | 99.7 | 14.8 | 305.6 | 328.7 | 79.0 | 0.1 |
| 10 | 1 | 1000 | 997.1 | 24.1 | 379.7 | 442.6 | 131.6 | 0.8 |
| 10 | 1 | 5000 | 4979.0 | 32.4 | 399.1 | 487.8 | 169.2 | 3.3 |
| 50 | 1 | 0 | 0.0 | 1.0 | 259.1 | 259.5 | 61.0 | 0.1 |
| 50 | 1 | 100 | 99.7 | 5.2 | 271.0 | 277.8 | 67.2 | 0.1 |
| 50 | 1 | 1000 | 995.9 | 21.3 | 353.4 | 400.4 | 114.6 | 1.3 |
| 50 | 1 | 5000 | 4995.3 | 25.2 | 409.2 | 502.0 | 173.8 | 1.9 |
| 50 | 4 | 1000 | 995.8 | 47.2 | 512.2 | 582.2 | 170.9 | 7.9 |
| 50 | 4 | 5000 | 4983.9 | 64.6 | 545.4 | 617.8 | 158.9 | 12.9 |
| 100 | 4 | 5000 | 4989.4 | 60.7 | 531.1 | 596.6 | 154.5 | 11.7 |

## Functional verification

- Private Linux Xvfb captured the native UI in dark and light themes at 842px and 450px.
  The fixture exercised both moderation buttons with a local command recorder and verified
  that Streamer Mode hid moderation actions and held text for blocked terms.
- Workspace checks passed. The workspace test command passed 1,302 tests and skipped 15
  PostgreSQL integration tests.
- The local Linux production package staged the pinned native runtime and passed the
  compiled release smoke check after the packaging fix.
