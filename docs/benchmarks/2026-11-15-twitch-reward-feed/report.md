# Twitch Channel Points redemption notices

Native GUI QA passed in compact and modern chat at 580×530 and 320×240. It covered
reward text from the active account and another viewer, late title and cost, Shared Chat
source attribution, deduplication, the unknown reward label, and an ordinary neighboring row.
The fixture used simulated Twitch data.

The follow-up removes the generic caption from reward notices. The benchmark workload
contains ordinary chat messages, which never mount the reward notice header. The tables
retain the original measured revision. Focused native QA covers the updated header.

## Production target

Three runs per revision used 50 channels, four panes, 200 retained messages per channel,
and 5,000 offered messages/s for 30 seconds after a 3-second warmup. The harness verified
the production React, JSX runtime, and reconciler modes and checked that chat text painted.
Measurements used Bun 1.4.4, a 1200×800 window, and private headless Weston.

| Metric | Before median and range | After median and range |
| --- | ---: | ---: |
| Processed msg/s | 4990.71 (4988.51–4995.21) | 4994.01 (4993.95–4994.64) |
| CPU % of one core | 52.21 (52.03–52.67) | 48.14 (47.79–48.16) |
| RSS median MiB | 383.97 (382.11–388.70) | 381.82 (377.80–390.96) |
| RSS peak MiB | 471.55 (469.62–477.87) | 465.17 (455.05–475.31) |
| JS heap peak MiB | 151.35 (145.63–162.12) | 159.44 (140.49–165.70) |
| Event-loop lag p95 ms | 3.29 (2.79–3.36) | 1.99 (1.90–2.28) |

Every candidate run processed at least 99.88% of offered traffic.
Median CPU changed by -7.8%, median RSS by -0.6%,
and median peak RSS by -1.4%. The generator and renderer run in the same process.

## Default development matrix

All 15 scenarios completed on both revisions. Each ran for 12 seconds after a
3-second warmup with the development runtime.

| Scenario | Before msg/s | After msg/s | Before CPU % | After CPU % | Before peak RSS MiB | After peak RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c1-r0-p1 | 0.00 | 0.00 | 0.99 | 1.07 | 252.75 | 247.37 |
| c1-r100-p1 | 99.67 | 99.83 | 29.83 | 28.47 | 399.26 | 400.01 |
| c1-r1000-p1 | 995.82 | 996.24 | 36.37 | 37.53 | 464.55 | 444.15 |
| c1-r5000-p1 | 4982.95 | 4980.53 | 39.14 | 39.97 | 482.54 | 517.41 |
| c10-r0-p1 | 0.00 | 0.00 | 1.04 | 1.07 | 258.23 | 254.19 |
| c10-r100-p1 | 99.75 | 99.75 | 17.43 | 20.07 | 331.73 | 332.85 |
| c10-r1000-p1 | 997.41 | 998.82 | 27.78 | 27.82 | 398.23 | 394.29 |
| c10-r5000-p1 | 4979.03 | 4978.62 | 37.68 | 37.54 | 476.11 | 485.82 |
| c50-r0-p1 | 0.00 | 0.00 | 1.19 | 1.20 | 274.12 | 267.60 |
| c50-r100-p1 | 99.58 | 99.58 | 7.38 | 6.99 | 305.32 | 297.14 |
| c50-r1000-p1 | 997.07 | 996.32 | 24.83 | 26.73 | 377.26 | 376.27 |
| c50-r5000-p1 | 4965.37 | 4989.28 | 30.23 | 31.49 | 439.39 | 412.01 |
| c50-r1000-p4 | 997.54 | 996.82 | 55.13 | 54.55 | 607.58 | 596.17 |
| c50-r5000-p4 | 4985.28 | 4989.76 | 74.00 | 73.27 | 752.39 | 756.75 |
| c100-r5000-p4 | 4988.62 | 4986.04 | 62.99 | 61.29 | 675.10 | 697.54 |

## Provenance

- Baseline `8350131fdc834d1290d74b1d556af71c168cbbca` with clean sources. Runtime SHA-256 `809aafbbe1712d47ed8633fecb6cf4e5bafe534ad342609295be3d16e90b56e7`.
- Candidate working tree on `satont/twitch-reward-feed` based on `8350131fdc834d1290d74b1d556af71c168cbbca`.
  Runtime SHA-256 `05fe0cb78f6e575e208b07a3d5014566b126d3ba4e44e32539df9ba732a9655f` and measured diff SHA-256 `4d72532c5f170917194d52d175839f773eb7455d35016da1ff395f814aba068f`.
- Linux x64 native runtime `0.11.0-twirchat.27`, API 3, patch digest `14284b5e45d28bee`.
  Native SHA-256 `ae97bab7d71bb610e4fb93aa7cccdf247d9d88f8b9495fdc5ed25fa961d93b22` on both revisions.

```sh
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
bun run --cwd packages/desktop qa:gui --keep --display-width 900 --display-height 660 --timeout 45 -- bun tests/channel-points-qa.tsx --reward-feed
```
