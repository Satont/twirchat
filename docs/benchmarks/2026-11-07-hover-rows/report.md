# Hover across chat rows

Moving the pointer quickly over the messages of one chat used a lot of CPU. Each time the
pointer entered another row, the row's hover background and toolbar colours changed. GPUI
redraws the whole window for any change, so every row crossing rebuilt, laid out and painted
every visible message, about 5–7 ms per frame. Crossing 14 rows in a quarter of a second
produced 60–85 such frames per second.

## Profile

Windows 11, `bench:flood`, one chat in a 600×1000 window, pointer sweeping down over 14 rows
every 250 ms. The native renderer thread was sampled with matching symbols.

- Half of the native frame was virtual-list item layout. Taffy alone took 26% of the busy
  time, for about 45 elements per modern row.
- The mutation batches were colour-only, so they already took the paint-only path. That path
  still lays out every visible row.
- The existing message-body cache never helped in the modern theme. Its row was a flex row of
  avatar and content, and the body cache accepts only column ancestry.
- In a live chat the body cache was dropped by every new message. Every Full commit also
  refreshed the whole window, so a cached body only replayed on the third frame after a
  message. At 20 messages per second that third frame rarely came.
- A font family that the system lacks formatted its cached `anyhow` error and retried every
  fallback on each text shaping call, about 4% of the frame.

## Change

- **Modern row layout.** The modern row is a column, with the platform icon and avatar
  absolutely positioned. In the automation tree, every painted row has the same height and
  element bounds as `main` with default settings, with the platform icon, without avatars,
  and at font sizes 10 and 20.
- **Native `0.11.0-twirchat.18`.**
  - Whole virtual-list rows go through the entity-backed view cache. A row entry is keyed by
    its own subtree, the list's space, the inherited text style, the list's ancestor styles
    and the frame context. It survives commits elsewhere in the tree, such as a new message.
  - A Full commit no longer refreshes the whole window.
  - A layout revision ignores colour-only restyles, so a hover change re-renders the row once,
    at its measured size.
- **Font resolution.** GPUI remembers the font `resolve_font` settled on.
- **`bench:flood` pointer mode.** `--hover <moves/s>`, `--hover-path rows|row` and
  `--hover-sweep-ms` drive native pointer moves during the measurement.

## Results

`main` `c5eb207` with native `f92669c4…` (`0.11.0-twirchat.17`) against this branch with native
`d81f088e…`, built from the same sources as `0.11.0-twirchat.18`. Production React, Windows 11,
real workload with badges, avatars and emotes. 3 s warmup, 15 s measurement, three fresh
processes per cell. Values are median (min–max). The pointer moves 120 times per second.

| Scenario | CPU % main | CPU % branch | Native thread % main | Native thread % branch | ms per draw main | ms per draw branch |
| --- | --- | --- | --- | --- | --- | --- |
| Quiet chat, pointer over rows | 48.4 (46.2–60.3) | 35.5 (35.4–35.8) | 37.6 (35.4–48.6) | 24.0 (23.0–25.1) | 6.5 (6.1–7.2) | 3.5 (3.4–3.7) |
| 20 msg/s, pointer over rows | 67.5 (66.6–68.3) | 48.1 (47.1–52.6) | 52.1 (50.9–52.2) | 36.2 (35.5–37.4) | 6.2 (6.1–6.4) | 4.3 (4.2–4.5) |
| 20 msg/s, no pointer | 20.5 (19.7–22.0) | 18.9 (18.6–19.5) | 12.4 (12.1–12.8) | 10.4 (10.3–10.9) | 7.9 (7.6–8.1) | 6.6 (6.4–6.9) |
| 100 msg/s, no pointer | 27.1 (26.0–27.9) | 24.3 (23.9–25.7) | 14.7 (13.0–15.0) | 12.9 (12.4–13.7) | 9.2 (8.1–9.4) | 8.1 (7.8–8.6) |
| 2×2 split, 16 msg/s, 1380×1080, pointer moving | 33.4 (32.5–36.2) | 25.0 (24.7–25.5) | 25.1 (23.9–27.2) | 17.1 (15.8–17.1) | 15.7 (15.2–16.5) | 10.5 (9.9–10.8) |

- **Throughput.** Both versions processed the full offered rate in every run: 0, 20, 100 or 16
  messages per second.
- **Memory.** RSS stayed within 2% between the versions.
- **Event-loop lag.** Event-loop lag p95 fell, for example from 4.2 to 2.5 ms with 20 msg/s
  and the pointer moving.
- **Repeated rows.** In a quiet chat about 86% of row draws replay the previous frame. Only
  the two rows whose hover colour changed render again.

## Not covered

- `bench:chat` and its production target need x86-64 Linux with the isolated launcher and
  were not run.
- The load matrix in [2026-11-03 interactions](../2026-11-03-interactions/report.md) is not
  refreshed by this report.
- A message still shifts every row, and GPUI cannot translate cached ranges. Frames that
  follow a new message therefore render every visible row, as before.
