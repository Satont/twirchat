# Twir now playing

The benchmark uses ordinary chat messages and the default settings, with the new track switch off.
Isolated Linux GUI checks covered saving the Twir switches independently, command autocomplete and
reload, and changing the current track during live chat. The screenshots use simulated platform and
Twir data.

The artwork follow-up reuses these measurements because the now-playing component is unmounted
with the switch off. Focused native checks verified the artwork at 720 and 320 px, replacement on
refresh, and the note placeholder when artwork is absent or cannot be loaded.

## Production target

Three runs per revision used 50 channels, four panes, 200 retained messages per channel,
and 5,000 offered messages/s for 30 seconds after a 3-second warmup.
The harness verified the production React, JSX runtime, and reconciler modes.
Both revisions used Bun 1.4.4 and a 1200×800 window on isolated headless Weston.
The message generator and renderer share the same process.

| Metric | Baseline median and range | Candidate median and range |
| --- | ---: | ---: |
| Processed messages/s | 4988.79 (4988.11–4990.51) | 4989.92 (4989.31–4990.16) |
| CPU % of one core | 53.80 (53.39–53.96) | 54.06 (53.19–54.33) |
| Median RSS MiB | 389.86 (387.69–401.66) | 394.06 (388.43–397.72) |
| Peak RSS MiB | 472.95 (468.74–506.29) | 476.81 (474.75–494.86) |
| Peak JS heap MiB | 159.64 (158.62–166.12) | 160.84 (157.04–176.52) |
| Event-loop lag p95 ms | 3.32 (3.24–3.68) | 3.99 (3.50–4.15) |

Every candidate run processed at least 99.79% of the offered rate during measurement.
Median CPU changed by +0.5%, median RSS by +1.1%,
and median peak RSS by +0.8%.

## Default development matrix

Each scenario ran for 12 seconds after a 3-second warmup.
Each cell shows baseline → candidate.

| Scenario | Messages/s | CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Event-loop lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c1-r0-p1 | 0.00 → 0.00 | 1.01 → 1.05 | 256.51 → 253.16 | 257.26 → 253.73 | 56.81 → 56.53 | 0.06 → 0.06 |
| c1-r100-p1 | 99.67 → 99.67 | 26.40 → 28.89 | 354.68 → 363.93 | 390.70 → 400.57 | 90.23 → 98.91 | 1.63 → 1.69 |
| c1-r1000-p1 | 997.99 → 996.49 | 39.05 → 38.31 | 392.73 → 381.36 | 499.88 → 442.52 | 133.10 → 134.36 | 5.00 → 5.36 |
| c1-r5000-p1 | 4983.86 → 4981.39 | 42.05 → 40.35 | 413.37 → 406.29 | 494.62 → 507.34 | 160.41 → 162.48 | 5.20 → 5.17 |
| c10-r0-p1 | 0.00 → 0.00 | 1.09 → 1.03 | 261.37 → 257.73 | 261.92 → 258.45 | 58.47 → 58.51 | 0.06 → 0.06 |
| c10-r100-p1 | 99.67 → 99.67 | 17.79 → 16.15 | 325.20 → 320.50 | 364.30 → 353.98 | 90.93 → 86.60 | 0.25 → 0.41 |
| c10-r1000-p1 | 998.57 → 997.99 | 26.38 → 28.11 | 353.15 → 357.51 | 408.46 → 394.61 | 103.43 → 99.89 | 1.98 → 1.54 |
| c10-r5000-p1 | 4984.45 → 4982.77 | 38.88 → 38.73 | 405.54 → 399.91 | 514.79 → 506.94 | 158.59 → 154.01 | 4.45 → 5.09 |
| c50-r0-p1 | 0.00 → 0.00 | 1.10 → 1.08 | 273.88 → 273.61 | 274.78 → 274.39 | 64.97 → 65.00 | 0.06 → 0.06 |
| c50-r100-p1 | 99.58 → 99.67 | 6.61 → 6.35 | 291.94 → 292.30 | 296.69 → 302.58 | 73.16 → 73.30 | 0.07 → 0.06 |
| c50-r1000-p1 | 996.24 → 997.41 | 24.69 → 23.60 | 356.23 → 359.64 | 378.00 → 389.35 | 104.01 → 106.24 | 1.32 → 1.47 |
| c50-r5000-p1 | 4994.62 → 4993.54 | 29.31 → 30.14 | 373.52 → 382.38 | 439.16 → 426.66 | 118.21 → 124.45 | 1.44 → 2.19 |
| c50-r1000-p4 | 997.49 → 997.99 | 57.26 → 58.08 | 529.67 → 518.30 | 622.59 → 668.56 | 145.76 → 142.88 | 8.32 → 8.30 |
| c50-r5000-p4 | 4982.44 → 4987.02 | 74.82 → 75.79 | 620.46 → 582.51 | 744.32 → 740.21 | 152.12 → 166.12 | 18.29 → 18.88 |
| c100-r5000-p4 | 4987.85 → 4984.20 | 64.19 → 66.18 | 576.05 → 562.84 | 684.03 → 699.05 | 179.62 → 162.56 | 10.72 → 12.18 |

## Provenance

- Baseline commit `eac1906be6fc03d4db377535049138455f9683ed`.
  Runtime source hash `3b5734502c8f7e601180750bcb7831f00dab7bfabd4539b994c2cd20b2779b9f`.
- Candidate commit `1e02cfb27d80cd1443978a2e34d33c9b192bf823`.
  Runtime source hash `b4a530c84e4f8979cba422ea54d6ce5fe5962f3352c0f3fdaabf760495e6c362`.
- GPUIX `0.11.0-twirchat.27`, API 3, patch digest `14284b5e45d28bee`.
  Native binary SHA-256 `ae97bab7d71bb610e4fb93aa7cccdf247d9d88f8b9495fdc5ed25fa961d93b22` on both revisions.
