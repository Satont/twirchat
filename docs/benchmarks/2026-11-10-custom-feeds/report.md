# Custom chat feed performance

The three production target runs processed 4,992–4,998 messages/s at a target of 5,000.
Median process RSS was 377.00 MiB on the baseline and 369.98 MiB on the feature. Median peak
RSS rose from 469.95 to 483.89 MiB. Baseline CPU varied from 47.12% to 62.39% across runs on
the shared host. Feature CPU ranged from 46.03% to 47.89%.

## Reproduction

```sh
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30 --feeds
```

- AMD Ryzen 7 9800X3D 8-Core Processor, 16 logical CPUs, Linux 7.3.1-1-cachyos, Bun 1.4.4.
- Private headless Weston GL, 1200×800, three-second warmup, two-second drain, and 200 retained
  messages per source. CPU 100% represents one logical core.
- Baseline revision `8cc2d00c3d118bfb8160f31e46477f4af38f843d` with runtime SHA-256
  `483add2fb40bda27c1de7f148eea24078938859d30e6b4c742fa0f0e3ebfb5a0` (553 files).
- Feature revision `67cf14399779624ef18749726d535ed00d6901b2` with runtime SHA-256
  `e3893e240f0dc19162992a2bee80233e593e6b94e6a6a25234e5c8ebc95d59c4` (556 files).
- Native GPUIX 0.11.0-twirchat.25, API 3, patch digest `f6ff95b61fce09c8`. Binary SHA-256
  `ce789deb4d66695747865d79691dfd2400034bb7d5350c177255bdaf83ec4819`.

The default matrix loads development React. The 30-second target and four-feed workload load
production React. The runner verifies the loaded React, JSX runtime and reconciler modules.
This harness uses a coupled generator and synthetic chat events. It measures the native UI and
store pipeline with generated traffic.

After the benchmark, the branch was rebased over the keyboard focus styling fix
`ddfd9f3` and the backend 7TV reconnect fix `4a1f8c2`. The benchmark injects chat
events directly and has no keyboard input. The native interaction check was rerun
on the rebased branch.

## Production target

| Run | Processed msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| Baseline 1 | 4986.25 | 47.12 | 370.62 | 469.95 | 173.65 | 4.94 |
| Baseline 2 | 4951.84 | 62.39 | 386.94 | 473.05 | 182.26 | 16.75 |
| Baseline 3 | 4992.61 | 61.38 | 377.00 | 445.06 | 176.45 | 10.80 |
| Baseline median | 4986.25 | 61.38 | 377.00 | 469.95 | 176.45 | 10.80 |
| Baseline range | 4951.84–4992.61 | 47.12–62.39 | 370.62–386.94 | 445.06–473.05 | 173.65–182.26 | 4.94–16.75 |
| Feature 1 | 4993.52 | 47.77 | 368.14 | 469.59 | 168.91 | 4.48 |
| Feature 2 | 4991.85 | 47.89 | 377.34 | 485.43 | 181.03 | 5.43 |
| Feature 3 | 4998.40 | 46.03 | 369.98 | 483.89 | 169.38 | 5.37 |
| Feature median | 4993.52 | 47.77 | 369.98 | 483.89 | 169.38 | 5.37 |
| Feature range | 4991.85–4998.40 | 46.03–47.89 | 368.14–377.34 | 469.59–485.43 | 168.91–181.03 | 4.48–5.43 |
| Change in median | +0.15% | -22.18% | -1.86% | +2.97% | -4.01% | -50.28% |

## Four visible combined feeds

The workload assigns all 50 sources to four feeds with 12 or 13 sources each. The ordinary
matrix shows one source in each visible pane. The combined panes keep up to 500 rows each.
Rendering messages from all 50 sources sustained 4,989 messages/s with 444.39 MiB median RSS
and a 24.69 ms event-loop lag p95.

| Run | Processed msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| Four combined feeds | 4988.88 | 64.58 | 444.39 | 573.92 | 162.57 | 24.69 |

## Development matrix

Each cell shows baseline → feature from the default 12-second matrix.

| Scenario | Processed msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| c1-r0-p1 | 0.00 → 0.00 | 0.99 → 1.03 | 242.32 → 242.33 | 243.18 → 243.16 | 54.12 → 54.14 | 0.06 → 0.06 |
| c1-r100-p1 | 99.75 → 99.67 | 25.82 → 24.69 | 382.45 → 373.50 | 445.43 → 432.74 | 118.15 → 119.21 | 1.57 → 1.74 |
| c1-r1000-p1 | 996.82 → 995.99 | 33.55 → 34.00 | 414.17 → 413.02 | 496.15 → 504.23 | 168.64 → 168.22 | 3.32 → 4.02 |
| c1-r5000-p1 | 4980.53 → 4980.45 | 39.11 → 37.31 | 407.28 → 412.31 | 531.24 → 501.30 | 178.50 → 155.21 | 4.25 → 4.74 |
| c10-r0-p1 | 0.00 → 0.00 | 1.05 → 1.07 | 251.42 → 247.30 | 251.94 → 248.08 | 55.77 → 55.89 | 0.06 → 0.06 |
| c10-r100-p1 | 99.75 → 99.67 | 16.74 → 16.73 | 308.25 → 304.98 | 331.33 → 332.54 | 80.79 → 80.94 | 0.13 → 0.07 |
| c10-r1000-p1 | 998.81 → 997.49 | 24.66 → 24.03 | 374.85 → 374.51 | 443.46 → 447.79 | 138.08 → 136.67 | 1.81 → 1.71 |
| c10-r5000-p1 | 4979.37 → 4977.77 | 38.31 → 34.18 | 401.93 → 400.47 | 503.59 → 500.97 | 175.89 → 167.42 | 4.81 → 3.30 |
| c50-r0-p1 | 0.00 → 0.00 | 1.15 → 1.14 | 263.95 → 260.44 | 265.20 → 261.55 | 62.26 → 62.38 | 0.06 → 0.06 |
| c50-r100-p1 | 99.67 → 99.67 | 5.78 → 5.29 | 274.55 → 273.61 | 279.41 → 281.79 | 68.47 → 68.64 | 0.07 → 0.09 |
| c50-r1000-p1 | 992.99 → 997.41 | 26.94 → 21.14 | 357.67 → 353.87 | 405.33 → 408.00 | 114.80 → 115.82 | 1.06 → 1.51 |
| c50-r5000-p1 | 4991.78 → 4991.62 | 30.88 → 27.03 | 393.11 → 384.16 | 497.87 → 482.89 | 167.32 → 160.72 | 2.95 → 2.04 |
| c50-r1000-p4 | 997.78 → 996.16 | 76.04 → 49.62 | 561.54 → 535.21 | 665.61 → 642.55 | 169.87 → 165.22 | 27.45 → 7.93 |
| c50-r5000-p4 | 4989.31 → 4988.97 | 72.64 → 63.32 | 568.14 → 557.68 | 680.48 → 648.20 | 162.05 → 170.61 | 15.63 → 13.27 |
| c100-r5000-p4 | 4985.20 → 4988.16 | 61.98 → 57.29 | 543.52 → 543.07 | 617.93 → 649.85 | 160.73 → 150.46 | 11.38 → 10.56 |

## Native interaction check

```sh
bun run --cwd packages/desktop qa:gui --node-env production --dbus \
  --display-width 900 --display-height 570 --keep --timeout 45 -- bun scripts/qa-custom-feed.tsx
```

Native pointer and keyboard input exercised creating, editing and restoring feeds, search in a
long source list, Escape during incoming traffic, choosing between same-platform destinations,
and routing a Twitch reply while the Kick composer destination was selected. The 900×570 and
540×420 windows used a private profile and generated messages.
