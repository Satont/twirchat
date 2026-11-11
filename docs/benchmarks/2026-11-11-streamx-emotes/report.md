# StreamX emote rendering

Measured on a Ryzen 7 9800X3D with Bun 1.4.4 and isolated Weston. Each run used a fresh profile,
a 1200×800 window, 200 retained messages per channel, three seconds of warmup, and two seconds
of drain. The harness verified the loaded React, JSX, and reconciler modes.

## Production comparison

Three 30-second runs per revision used 50 channels, four panes, and 5,000 offered messages/s.
Values are medians with the full observed range.

| Metric | Baseline | Candidate | Median change |
| --- | --- | --- | --- |
| Processed messages/s | 4989.0 (4987.8–4997.7) | 4987.7 (4987.3–4989.3) | -0.03% |
| App CPU, % of one core | 43.59 (42.94–43.69) | 43.70 (42.01–43.84) | +0.25% |
| Median RSS, MiB | 380.4 (373.5–380.7) | 375.1 (372.3–384.3) | -1.41% |
| Peak RSS, MiB | 466.3 (438.2–502.1) | 480.7 (477.6–488.1) | +3.09% |
| Peak JS heap, MiB | 175.0 (163.3–178.9) | 177.9 (161.2–181.1) | +1.66% |
| Event-loop lag p95, ms | 4.10 (3.88–4.26) | 4.09 (3.99–4.11) | -0.46% |

The candidate processed at least 99.75% of the offered rate in every production run.
The workload exercises built-in text chat and uses a coupled generator. StreamX parsing and
emote artwork were verified separately with fixtures and a public history smoke test.

## Default development matrix

| Scenario | Processed messages/s | App CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | --- | --- | --- | --- | --- | --- |
| c1-r0-p1 | 0.0 | 1.0 | 243.3 | 244.2 | 54.5 | 0.06 |
| c1-r100-p1 | 99.7 | 23.7 | 381.9 | 450.0 | 120.4 | 1.88 |
| c1-r1000-p1 | 997.7 | 31.9 | 405.2 | 491.4 | 166.6 | 2.94 |
| c1-r5000-p1 | 4985.4 | 35.2 | 399.5 | 519.0 | 162.0 | 3.49 |
| c10-r0-p1 | 0.0 | 1.0 | 249.9 | 251.2 | 56.2 | 0.06 |
| c10-r100-p1 | 99.7 | 15.6 | 307.7 | 333.7 | 80.7 | 0.50 |
| c10-r1000-p1 | 997.7 | 23.1 | 373.6 | 443.3 | 137.2 | 1.79 |
| c10-r5000-p1 | 4973.7 | 31.8 | 405.7 | 503.6 | 166.4 | 2.96 |
| c50-r0-p1 | 0.0 | 1.1 | 264.2 | 265.2 | 62.7 | 0.06 |
| c50-r100-p1 | 99.7 | 5.1 | 276.9 | 283.8 | 69.0 | 0.06 |
| c50-r1000-p1 | 999.1 | 20.4 | 361.0 | 410.0 | 116.9 | 0.55 |
| c50-r5000-p1 | 4989.0 | 26.1 | 392.3 | 482.2 | 169.2 | 2.18 |
| c50-r1000-p4 | 998.2 | 48.0 | 508.7 | 630.7 | 172.5 | 8.24 |
| c50-r5000-p4 | 4984.1 | 61.7 | 538.9 | 692.6 | 158.8 | 14.23 |
| c100-r5000-p4 | 4985.7 | 52.2 | 533.5 | 600.1 | 184.2 | 9.50 |

## Functional verification

- The StreamX transport read a 7TV emote from public history with its HTTPS URL and dimensions.
  The local GraphQL fixture verified history and live delivery, repeated emotes, UTF-16 positions,
  and plain-text fallback.
- Isolated native QA painted a cached inline image in the plugin pane and My channels.
- The built OBS overlay displayed the inline image in headless Chromium. History stayed out of the overlay.

## Provenance

| Revision | Commit | Runtime inputs SHA-256 |
| --- | --- | --- |
| Baseline | `d52c7125153bb8f1f67fe8c73abb56cfd88e2098` | `c437818a6a477d34efadb8a265842a3fbc877b2dd887be43f87a2ddd7660d466` |
| Candidate | `7ac3023627da064a41ff4d4ce28c119e0bfce344` | `578cba096c12efc73adfded6cffcee5390f3a75352302e6e310d901ca9e63047` |

Both revisions used GPUIX `0.11.0-twirchat.25` with patch digest `f6ff95b61fce09c8` and native
SHA-256 `ce789deb4d66695747865d79691dfd2400034bb7d5350c177255bdaf83ec4819`.
