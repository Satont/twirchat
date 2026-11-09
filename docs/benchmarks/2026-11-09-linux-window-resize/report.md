# Linux window resizing

Wayland windows with client decorations reserve a six-pixel strip on each free edge.
GPUI passes the pointer press and resize direction to the compositor. The window
stays at the same reported size, with the resize strip inside the surface.

## Windowed production workload

The default benchmark runs Weston kiosk shell, which puts every test window in
fullscreen. The resize frame is only present in a normal window. For the comparison
below, temporary checkouts passed `--weston-shell desktop` to the same QA launcher and
asserted that each measured window was windowed. The underlying workload stayed
the same.

Three alternating pairs of fresh 30-second measurements used hardware-backed Weston on Linux,
Bun 1.4.4, a 1200×800 window, four panes and 50 channels retaining 200 messages each.
The generator offered 5,000 messages/s after a 3-second warmup. The benchmark
verified the loaded React, JSX and reconciler mode. Values are medians (min–max).
Memory is in MiB and event-loop lag is in milliseconds.

| Version | Actual msg/s | CPU % of one core | Median RSS | Peak RSS | Peak JS heap | Lag p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Main | 4991.0 (4991.0–4992.7) | 38.9 (38.2–39.9) | 363.3 (359.0–370.2) | 468.7 (449.9–471.5) | 165.1 (156.8–166.0) | 3.2 (3.0–4.1) |
| Resize frame | 4987.0 (4986.9–4988.6) | 43.5 (40.0–45.9) | 364.6 (362.3–365.8) | 462.2 (444.0–481.7) | 169.8 (156.2–184.1) | 3.3 (3.1–3.5) |

The slowest candidate run processed 4986.9 messages/s (99.74% of offered load).
Median CPU increased by 4.7 percentage points of one core (+12.0%). Median RSS
changed by +0.4% and peak RSS by −1.4%. The generator shares the application's event loop.

The candidate also drew more full frames in every pair. The median increased from
524 (520–526) to 688 (552–796) full draws per 30 seconds. The pairs with the largest
increases in draw count also used the most additional CPU. The results measure
total process CPU and draw cadence together.

The first uncached candidate used 42.1% median CPU against 34.8% in the initial
baseline runs. A later pair used 41.0% versus 38.9% and performed 608 versus 514
full draws. The final patch caches the resize hitboxes and paints only the strips.
The final comparison above uses fresh alternating runs on the same host.

A geometry-only control on `.22` applied six pixels of padding to the chat body
in the benchmark fixture, with the same 1200×800 window. That narrowed the four
panes to the same available width as the resize frame. The control used 45.7% of
one core and produced 735 full draws at 4991.8 messages/s. The narrower viewport
reproduced the higher CPU and draw cadence without the new resize hitboxes.
This was one diagnostic run and is excluded from the comparison above.
Its runtime input SHA-256 was
`d81eea948edaa27b2c2cf62d526d54d656382c061364e0c35e1738f403c3f780`.

| Version | Git revision | Native version and patch digest | Native SHA-256 | Runtime input SHA-256 |
| --- | --- | --- | --- | --- |
| Main | `aaea2cad72aa5e5ae4aec23c84176162ca21d888` | `0.11.0-twirchat.22 / 9633a5b247439369` | `cf30bd8f2cb1fb3ea0d68ae03be5fc693447e37588f702d2092cac8a9137b45e` | `69fd0241392992fc388e4e68e9965afe02a3c8e37988f56d9d667dfcd10b3ab0` |
| Resize frame | `b1a220bd13d9a0e38b8fdabed90e603ffe6a81e1` | `0.11.0-twirchat.23 / 70e3729616abe8e4` | `92699a8ef5a26d4d28ca526e68ecadab1a664aac7ae0370a29be3dcf7662f132` | `97b172fc796d6e2215cde589cddcdd474ba9186b31d26b105d16f307d9c6164d` |

## Default development matrix

The standard kiosk-shell command completed all 15 scenarios on the first resize
commit, `5dd7025`. That run is reused because the cache change only affects the
windowed resize frame. Each case measured 12 seconds after a 3-second warmup.

| Channels | Panes | Offered msg/s | Actual msg/s | CPU % of one core | Median RSS | Peak RSS | Peak JS heap | Lag p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 0.0 | 1.1 | 242.1 | 243.1 | 53.0 | 0.1 |
| 1 | 1 | 100 | 99.7 | 28.3 | 373.8 | 431.3 | 120.5 | 2.3 |
| 1 | 1 | 1000 | 997.3 | 38.3 | 407.0 | 507.5 | 172.0 | 5.1 |
| 1 | 1 | 5000 | 4980.9 | 40.2 | 388.7 | 485.6 | 159.6 | 5.5 |
| 10 | 1 | 0 | 0.0 | 1.1 | 249.9 | 251.0 | 54.7 | 0.1 |
| 10 | 1 | 100 | 99.7 | 15.8 | 305.1 | 329.2 | 79.1 | 0.1 |
| 10 | 1 | 1000 | 997.0 | 27.8 | 371.9 | 444.3 | 135.6 | 1.9 |
| 10 | 1 | 5000 | 4979.9 | 37.5 | 396.2 | 495.2 | 161.6 | 4.4 |
| 50 | 1 | 0 | 0.0 | 1.2 | 261.7 | 262.1 | 61.0 | 0.1 |
| 50 | 1 | 100 | 99.7 | 5.7 | 272.1 | 277.8 | 67.3 | 0.1 |
| 50 | 1 | 1000 | 997.7 | 24.1 | 355.1 | 406.9 | 114.8 | 1.0 |
| 50 | 1 | 5000 | 4987.1 | 28.2 | 408.2 | 503.9 | 181.9 | 1.3 |
| 50 | 4 | 1000 | 997.5 | 54.5 | 516.0 | 585.2 | 172.8 | 8.9 |
| 50 | 4 | 5000 | 4987.2 | 69.7 | 549.9 | 687.5 | 196.5 | 15.2 |
| 100 | 4 | 5000 | 4981.9 | 61.1 | 519.3 | 589.1 | 151.4 | 10.7 |

## Native pointer checks

The same Weston desktop smoke passed at 640×460 and 360×280 with the final native
artifact. A right-edge drag increased width by 48 pixels. A bottom-right drag
changed width by −24 and height by +32 pixels. The compositor received each
resize request and the painted content followed the new dimensions. Releasing
the pointer allowed the next drag. Maximizing removed the frame and an edge
press produced no resize request. Restoring brought the frame back. Minimize,
close to tray, the X11 multi-window smoke, and the Linux release build also passed.
