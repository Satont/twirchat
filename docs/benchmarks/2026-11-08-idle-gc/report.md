# Idle JavaScript garbage collection

The desktop window manager starts one GPUIX idle collector after restoring the window session.
The collector is shared across windows and survives hot reload. The session stops it when
the last window closes. GPUIX samples renderer mutation batches and process CPU every five
seconds. After two quiet samples it runs a full Bun collection once, then waits for new
activity. [GPUIX documentation](https://gpuix.dev/#give-memory-back-when-idle)

## Provenance

Linux 7.3.1-1-cachyos, Ryzen 7 9800X3D, Bun 1.4.4, and private hardware-backed Weston.
All runs used the same GPUIX `0.11.0-twirchat.20` addon with patch digest `c7562b459b2a122c`
and SHA-256 `29517007304494574e40b73c8b041e536455c752bcdd9f4c2d042f356a653e62`.
The runner verified the loaded React, JSX runtime and reconciler modes.

| Build | Source commit | Runtime input SHA-256 |
| --- | --- | --- |
| Baseline | `8b8df6670084f55e4c8556f380e7cfae4de614df` | `77ccad35654edf0880cbf7a086b5a31ec3f485c46717831ef2c00d1deb010d2c` |
| Idle collection | `de015e6697e9e37cfa48cb7de940da782429bb4c` | `3472d02c2bd99ea47124416de82455b0ce0907d903589dbcbf96c6458aa9e39d` |

## Idle probe

A separate isolated production probe used the benchmark's text-only ChatView fixture at
1200×800, with 50 channels, four panes and 200 retained messages per channel. It alternated
two 16-second bursts at 5,000 total messages/s with 24-second idle periods. A wrapper around
`Bun.gc` recorded calls and delegated to the original collector. Both builds processed at
least 99.8% of offered traffic and retained all 10,000 messages across both cycles.

| Cycle | Baseline heap at end of idle | Heap immediately before → after collection | Baseline → changed RSS at end of idle |
| --- | ---: | ---: | ---: |
| 1 | 69.4 MiB | 69.3 → 67.5 MiB | 307.8 → 300.6 MiB |
| 2 | 70.0 MiB | 67.7 → 67.3 MiB | 302.4 → 304.4 MiB |

The two collector calls took 7.2 and 7.0 ms and both occurred during idle. The baseline
also reclaimed heap and RSS during idle. The controlled probe showed an additional
0.4–1.8 MiB reduction in JS heap at the collector call, while RSS remained around
300 MiB across both builds.

## Production target

Three fresh processes per build, with 50 channels, four panes, 5,000 total messages/s
and 200 retained messages per channel. Each used a 1200×800 window, 3 s warmup, 30 s
measurement and 2 s drain. Values are medians (min–max), with CPU as percent of one
logical core.

| Build | Actual msg/s | CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 4995.8 (4994.8–4997.5) | 48.26 (47.90–48.90) | 363.6 (356.9–367.8) | 473.7 (431.6–478.4) | 160.1 (157.9–165.1) | 3.06 (2.67–3.14) |
| After | 4993.1 (4987.6–4996.4) | 48.06 (47.58–49.17) | 368.0 (367.1–371.9) | 444.1 (438.8–465.0) | 149.3 (144.8–154.8) | 2.33 (2.28–3.31) |

Every run processed at least 99.7% of offered messages. Median CPU was 48.26% before and
48.06% after. Median RSS rose 1.2% and peak RSS varied across runs.

## Default development matrix

The standard benchmark ran all 15 cases with 3 s warmup, 12 s measurement and 2 s drain.
Each case used a fresh 1200×800 window with compact text chat and 200 retained messages per
channel. The zero-rate cases include the app's idle behavior.

| Channels | Panes | Offered msg/s | Actual msg/s | CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 0.0 | 0.99 | 241.7 | 242.5 | 53.0 | 0.06 |
| 1 | 1 | 100 | 99.4 | 26.34 | 375.9 | 440.1 | 117.2 | 2.71 |
| 1 | 1 | 1000 | 996.2 | 36.39 | 396.4 | 508.7 | 160.5 | 4.61 |
| 1 | 1 | 5000 | 4976.3 | 39.01 | 397.0 | 478.2 | 162.8 | 4.03 |
| 10 | 1 | 0 | 0.0 | 1.01 | 248.1 | 249.4 | 54.6 | 0.06 |
| 10 | 1 | 100 | 99.7 | 16.99 | 303.9 | 330.1 | 79.2 | 0.08 |
| 10 | 1 | 1000 | 997.2 | 25.12 | 372.8 | 445.1 | 133.3 | 1.17 |
| 10 | 1 | 5000 | 4981.6 | 34.41 | 395.5 | 499.2 | 163.7 | 4.36 |
| 50 | 1 | 0 | 0.0 | 1.13 | 256.9 | 258.0 | 60.9 | 0.06 |
| 50 | 1 | 100 | 99.7 | 5.43 | 270.7 | 276.1 | 67.1 | 0.06 |
| 50 | 1 | 1000 | 996.2 | 22.00 | 353.0 | 405.9 | 115.6 | 1.54 |
| 50 | 1 | 5000 | 4995.3 | 28.46 | 382.9 | 471.0 | 157.8 | 1.45 |
| 50 | 4 | 1000 | 996.2 | 54.40 | 527.1 | 607.8 | 167.9 | 7.57 |
| 50 | 4 | 5000 | 4988.8 | 66.77 | 551.8 | 652.0 | 155.3 | 14.62 |
| 100 | 4 | 5000 | 4983.7 | 58.57 | 517.0 | 668.8 | 168.6 | 10.22 |

## Functional checks

`bun run check`, `bun run test`, and isolated Linux `qa:app` and `qa:hmr` passed.
Local GUI and resource measurements cover Linux.
