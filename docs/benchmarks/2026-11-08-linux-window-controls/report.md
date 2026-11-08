# Linux client window controls

The first version rebuilt the client title bar every time the chat window rendered.
In the initial production comparison at `308d0d5`, median CPU went from 49.0% to 52.0%
of one logical core. The final implementation lets GPUI reuse the header layout, paint
and hitboxes while the window state stays the same.

## Production comparison

Three fresh runs per version on Linux, Bun 1.4.4 and isolated hardware-backed Weston
on a Ryzen 7 9800X3D and Radeon RX 7800 XT.
Each 1200×800 window had four visible panes, 50 channels, 200 retained messages per channel
and 5000 offered messages/s. Warmup was 3 seconds, measurement 30 seconds. The benchmark
verified the loaded React, JSX and reconciler mode. Values are medians (min–max) across
the three runs. Memory is in MiB and lag is in milliseconds.

| Version | Actual msg/s | CPU % | Median RSS | Peak RSS | Peak JS heap | Lag p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Main | 4995.8 (4995.0–4997.5) | 47.4 (47.0–49.4) | 360.6 (355.9–366.8) | 456.2 (453.4–467.9) | 161.0 (142.0–164.0) | 2.7 (2.5–3.0) |
| Client title bar | 4996.5 (4992.6–4997.4) | 46.5 (46.2–47.2) | 364.4 (359.0–367.3) | 455.5 (446.4–461.6) | 161.2 (150.8–169.9) | 2.6 (2.4–2.9) |

The slowest candidate run processed 4992.6 messages/s (99.85% of offered load).
Median CPU changed by −1.9%, median RSS by +1.0%, and median peak RSS by −0.2%.
All three metrics stayed within the 5% regression threshold.
The generator shares the application's event loop, so this is a workload comparison.

## Source and native provenance

| Version | Git revision | Native version and patch digest | Native SHA-256 | Runtime input SHA-256 |
| --- | --- | --- | --- | --- |
| Main | `149e97c98f5028f3d61d031a1d74bb997926b9d6` | `0.11.0-twirchat.21 / 497da172581fc4ac` | `c666e70a10a66ee0d7b8c97d1d8e18f0d62b0cc98dc4db018aa858f1f3ea46c7` | `c97e263ef92f7e38698cd2b996184dc771c8553990c90ea92316767ad76eb1d9` |
| Client title bar | `b6becc210d115812ce446b230e14bd6621be2d8d` | `0.11.0-twirchat.22 / 9633a5b247439369` | `cf30bd8f2cb1fb3ea0d68ae03be5fc693447e37588f702d2092cac8a9137b45e` | `3688318ae3bcaf4c4f90f6d3e1803dcb243cbb88d0eefc3ec834b3bb5eed622b` |

## Default development matrix

The same candidate source and artifact completed all 15 default scenarios. Each case ran
for 12 seconds after a 3-second warmup. Units match the production comparison.

| Channels | Panes | Offered msg/s | Actual msg/s | CPU % | Median RSS | Peak RSS | Peak JS heap | Lag p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 0.0 | 1.0 | 241.3 | 242.1 | 52.9 | 0.1 |
| 1 | 1 | 100 | 99.7 | 25.7 | 371.2 | 429.4 | 120.2 | 1.4 |
| 1 | 1 | 1000 | 995.6 | 34.3 | 390.3 | 493.4 | 175.3 | 4.7 |
| 1 | 1 | 5000 | 4978.5 | 36.9 | 408.7 | 507.1 | 162.3 | 4.9 |
| 10 | 1 | 0 | 0.0 | 1.0 | 246.5 | 247.2 | 54.6 | 0.1 |
| 10 | 1 | 100 | 99.7 | 16.5 | 306.4 | 329.7 | 79.3 | 0.3 |
| 10 | 1 | 1000 | 993.2 | 27.7 | 365.4 | 441.2 | 131.4 | 2.4 |
| 10 | 1 | 5000 | 4979.6 | 36.1 | 378.8 | 486.7 | 155.8 | 4.1 |
| 50 | 1 | 0 | 0.0 | 1.1 | 257.2 | 258.0 | 60.9 | 0.1 |
| 50 | 1 | 100 | 99.6 | 5.4 | 272.1 | 276.7 | 67.2 | 0.1 |
| 50 | 1 | 1000 | 997.9 | 22.0 | 353.7 | 406.8 | 115.1 | 0.4 |
| 50 | 1 | 5000 | 4990.0 | 26.9 | 396.7 | 495.0 | 169.8 | 0.8 |
| 50 | 4 | 1000 | 996.5 | 52.1 | 536.0 | 630.0 | 167.1 | 8.0 |
| 50 | 4 | 5000 | 4989.6 | 69.5 | 551.7 | 656.8 | 159.2 | 15.6 |
| 100 | 4 | 5000 | 4984.8 | 59.6 | 504.4 | 593.2 | 162.6 | 10.3 |

## Native window checks

In the isolated Weston desktop shell, actual pointer clicks maximized and restored
both 640×460 and 360×280 windows. Minimize sent an xdg-toplevel request and the window
lost focus. Close with the tray enabled unmapped the window without destroying the
renderer; explicit quit still closed it. The existing Wayland kiosk close/restore
smoke and X11 multi-window smoke also passed. Weston desktop shell did not remap a
tray-hidden window with the baseline runtime either.

A private desktop settings portal provided a dark scheme and a left-aligned Close.
The running app moved Close to the right when the portal sent a layout change.
GNOME Shell and Hyprland were not launched directly.
