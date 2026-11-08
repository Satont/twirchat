# Desktop memory for font fallback and image downloads

A character absent from every installed font caused Linux text shaping to retain the entire
fallback search. The desktop also held each image response in memory until its last byte and
then copied the accumulated bytes into a single buffer. These fixes target separate workloads.

## Missing glyph in a native window

Production React, 800×600 on isolated hardware-backed Weston, one fresh process per build.
The fixture paints Latin, Cyrillic, CJK, Arabic and emoji, adds U+0378, then removes it and paints
the original text again. Counts and MiB come from Linux procfs. The window uses the same
Inter font registration and native runtime as TwirChat. The before/after difference is for this
fixture, with system fonts installed on this host.

| Phase | RSS before | RSS after | Anonymous PSS before | Anonymous PSS after | Font RSS before | Font RSS after | Mapped font files before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Mixed text | 157.6 | 157.1 | 42.1 | 41.8 | 3.0 | 2.5 | 8 → 5 |
| Missing glyph | 311.8 | 159.8 | 72.6 | 43.8 | 125.9 | 2.5 | 888 → 5 |
| Back to mixed text | 316.1 | 161.8 | 76.6 | 45.6 | 125.9 | 2.5 | 888 → 5 |

The patch keeps the existing shaping order and temporarily maps candidate fonts. Only fonts
that supply a glyph join the persistent cache. A small cache records complete misses for short
runs. Nine text cases gave identical fonts, glyph IDs, cluster positions and advances in a
standalone test, including Cyrillic, CJK, Arabic, Hebrew bidirectional text, combining marks,
ligatures, ZWJ and skin tone emoji, and missing glyphs.

Three fresh runs per version in that standalone test reduced retained RSS from **157.2 to
5.1 MiB** after the first U+0378. The first miss took **34.0 → 15.1 ms** and ten exact repeats
took **24.8 → 0.03 ms**. Eight distinct unsupported scalars took **18.4 → 112.3 ms** in total
after the first miss. Each fresh miss still searches the available fonts, while the old
implementation could reuse all the fonts retained by its first miss. This tradeoff applies to
the distinct missing input fixture. Standard text throughput is measured separately below.

## Concurrent image downloads

Six loopback responses each sent 16 MiB in 128 KiB chunks, stalled for 250 ms, then sent one
last byte. Three alternating fresh processes per version ran the same fixture on Bun 1.4.4 with
production environment settings. Values are medians (min–max) across runs in MiB. Every run
published six files of 16,777,217 bytes with the expected final byte. The stall values are the
medians of five samples per run. Completion is a single snapshot per run.

| Metric | Buffered | Streamed |
| --- | ---: | ---: |
| RSS during stall | 145.0 (143.0–145.0) | 60.0 (50.0–61.8) |
| Anonymous PSS during stall | 121.5 (119.6–121.9) | 32.7 (22.4–34.0) |
| JS heap used during stall | 64.2 | 5.5 |
| External memory during stall | 63.4 | 4.5 |
| RSS at completion | 236.2 (235.6–236.5) | 51.0 (49.3–53.9) |

This measures the cache process with the server in a separate process. It models memory pressure
from simultaneous large downloads. The 20 MiB limit and six-download limit still apply. An image
becomes visible in the cache after the file stream completes and its temporary path is renamed.

## Chat load

Linux 7.3.1-1-cachyos, Ryzen 7 9800X3D, Radeon RX 7800 XT, Bun 1.4.4 and private Weston.
Each case used a fresh 1200×800 window and 200 messages retained per channel. The runner
verified the loaded React, JSX and reconciler mode. The two builds share the same main revision
with the idle garbage collection change. The synthetic workload contains compact text chat.

Three alternating 30-second production pairs used 50 channels, four panes and 5000 total
messages/s. Values are medians (min–max) of the three runs. Memory is in MiB, CPU is percent
of one logical core, and latency is in milliseconds.

| Variant | Actual msg/s | CPU % | Median RSS | Peak RSS | Peak JS heap | Lag p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before | 4995.6 (4994.6–4995.8) | 49.0 (48.0–49.5) | 366.0 (358.9–375.0) | 459.8 (439.6–461.9) | 161.4 (149.5–181.4) | 2.8 (2.4–3.4) |
| After | 4996.7 (4995.3–4996.8) | 50.2 (49.5–50.3) | 364.8 (361.1–367.2) | 452.8 (450.5–471.3) | 156.1 (153.4–159.9) | 2.5 (2.5–2.8) |

Every target run processed more than 99.8% of the offered rate. Median CPU changed by +2.5%,
median RSS by −0.3% and median peak RSS by −1.5%.

### Provenance

| Variant | Chat source | Native | Native SHA-256 | Runtime input SHA-256 |
| --- | --- | --- | --- | --- |
| Before | `308d0d53e40f53661a78c9a6aefc7727c9d35683` | `0.11.0-twirchat.20` | `29517007304494574e40b73c8b041e536455c752bcdd9f4c2d042f356a653e62` | `6ebe9e2e4be592360e843df4d976fcfd60a816ae04b7fa4be348e8a323fb7667` |
| After | `2508974c89c13984bb21496d18f5cf54d0bd78a5` | `0.11.0-twirchat.21` | `c666e70a10a66ee0d7b8c97d1d8e18f0d62b0cc98dc4db018aa858f1f3ea46c7` | `950842d9e3adaabccd03ef7e72ecedf7d605b117d7b396dfda6ff4fd47046e9c` |

The focused window used these same native bytes with `8b8df66` and `3d7a45c` before the rebase.
It creates the renderer directly. The image download probe imported the cache module at the
same pre-rebase base and candidate runtime sources. Those focused workloads exercise the
changes independently of the application window manager.

### Default development matrix

All 15 cases completed after the change. Each measured 12 seconds after a 3-second warmup.
Units match the production table.

| Channels | Panes | Offered msg/s | Actual msg/s | CPU % | Median RSS | Peak RSS | Peak JS heap | Lag p95 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 0.0 | 1.0 | 241.1 | 241.9 | 52.9 | 0.1 |
| 1 | 1 | 100 | 99.7 | 27.6 | 372.8 | 441.9 | 116.3 | 1.6 |
| 1 | 1 | 1000 | 996.3 | 34.8 | 410.7 | 509.1 | 166.5 | 3.9 |
| 1 | 1 | 5000 | 4980.8 | 38.9 | 393.5 | 515.0 | 175.9 | 4.7 |
| 10 | 1 | 0 | 0.0 | 1.1 | 247.2 | 248.1 | 54.6 | 0.1 |
| 10 | 1 | 100 | 99.6 | 16.1 | 306.0 | 329.1 | 78.6 | 0.1 |
| 10 | 1 | 1000 | 997.2 | 26.7 | 382.3 | 446.6 | 135.6 | 2.3 |
| 10 | 1 | 5000 | 4982.5 | 35.4 | 393.5 | 476.3 | 157.3 | 4.2 |
| 50 | 1 | 0 | 0.0 | 1.1 | 257.9 | 258.9 | 60.9 | 0.1 |
| 50 | 1 | 100 | 99.6 | 5.3 | 271.2 | 277.7 | 67.0 | 0.1 |
| 50 | 1 | 1000 | 997.6 | 23.7 | 356.5 | 399.3 | 114.7 | 1.3 |
| 50 | 1 | 5000 | 4972.2 | 29.3 | 381.1 | 485.9 | 165.7 | 2.3 |
| 50 | 4 | 1000 | 993.3 | 57.0 | 514.5 | 586.5 | 168.9 | 11.3 |
| 50 | 4 | 5000 | 4987.0 | 67.5 | 539.6 | 669.3 | 164.1 | 14.8 |
| 100 | 4 | 5000 | 4968.8 | 57.2 | 521.7 | 623.3 | 148.9 | 9.7 |

### Functional verification

- The locked Linux release native build succeeded. The isolated chat interaction suite passed.
- The production animated flood stand fetched 16 distinct WebP files from its local server,
  painted chat messages, and uploaded animation frames at 20 incoming messages/s.
- Workspace type, lint and format checks passed. All 1292 tests executed locally passed.
  The 15 PostgreSQL integration tests were skipped by the workspace test command.
