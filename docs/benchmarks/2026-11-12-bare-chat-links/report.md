# Bare chat domain links

Measured on a Ryzen 7 9800X3D with Bun 1.4.4 and Linux 7.3.3-1-cachyos. Each run used a private
Weston display, a 1200×800 window, 200 retained messages per channel, three seconds of warmup,
and two seconds of drain. The harness verified the loaded React, JSX, and reconciler modes.

## Production comparison

Four 30-second runs per revision used 50 channels, four panes, and 5,000 offered messages/s.
Values are medians with the full observed range.

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Processed messages/s | 4989.9 (4987.4–4998.2) | 4990.3 (4986.7–4999.0) |
| App CPU, % of one core | 41.48 (40.65–42.60) | 41.55 (39.94–41.87) |
| Median RSS, MiB | 374.7 (373.3–376.1) | 371.6 (369.6–374.4) |
| Peak RSS, MiB | 457.4 (438.9–475.1) | 443.3 (423.6–453.0) |
| Peak JS heap, MiB | 160.7 (156.3–178.0) | 137.0 (133.1–142.1) |
| Event-loop lag p95, ms | 3.11 (2.42–3.76) | 3.55 (3.32–3.88) |

Every candidate run processed at least 99.7% of the offered rate. The follow-up pair measured
p95 event-loop lag of 3.32 ms on both revisions. The coupled generator sends ordinary chat text.

## Default development matrix

All 15 cases completed their 12-second measurements.

| Scenario | Msg/s | App CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c1-r0-p1 | 0.0 | 0.96 | 246.2 | 246.8 | 54.8 | 0.06 |
| c1-r100-p1 | 99.7 | 25.76 | 337.1 | 384.6 | 86.7 | 1.52 |
| c1-r1000-p1 | 995.7 | 36.40 | 364.1 | 417.8 | 123.6 | 3.33 |
| c1-r5000-p1 | 4973.5 | 37.89 | 392.1 | 448.3 | 131.6 | 3.75 |
| c10-r0-p1 | 0.0 | 0.96 | 253.0 | 254.2 | 56.4 | 0.06 |
| c10-r100-p1 | 99.7 | 16.76 | 298.8 | 311.7 | 72.1 | 0.25 |
| c10-r1000-p1 | 997.7 | 26.05 | 335.5 | 371.9 | 91.2 | 1.41 |
| c10-r5000-p1 | 4965.9 | 33.35 | 373.4 | 444.0 | 106.3 | 3.13 |
| c50-r0-p1 | 0.0 | 0.99 | 264.9 | 265.7 | 62.9 | 0.06 |
| c50-r100-p1 | 99.7 | 5.61 | 279.4 | 286.6 | 69.3 | 0.08 |
| c50-r1000-p1 | 997.3 | 23.81 | 331.9 | 362.6 | 87.2 | 0.46 |
| c50-r5000-p1 | 4989.1 | 28.08 | 363.5 | 413.8 | 123.5 | 1.90 |
| c50-r1000-p4 | 996.2 | 49.99 | 502.3 | 582.3 | 118.7 | 7.55 |
| c50-r5000-p4 | 4988.5 | 54.72 | 535.3 | 634.2 | 159.0 | 9.80 |
| c100-r5000-p4 | 4989.0 | 52.02 | 507.2 | 622.7 | 147.1 | 9.14 |

## Functional verification

Isolated native chat QA painted `twir.app` and verified that a click passed `https://twir.app`
to the opener. The fixture also verified that Enter passes an existing percent-encoded URL
through unchanged. Tokenizer tests cover subdomains, internationalized domains, URL components,
punctuation, and ambiguous text such as email addresses.

## Provenance

| Revision | Commit | Runtime inputs SHA-256 |
| --- | --- | --- |
| Baseline | `a7e8812485cc1e5e036d1ec526a74b957e078cd8` | `d0164985d6f8d3df1fbd5179a4118e2a574cdb47eefeb622b2566db41879e8b5` |
| Candidate | `aa0ed10341817d9be76fc72cb86f254efea0296a` | `4604b6357bf15e9510c7b723a6d0ec4c064577ae967e5263f4738d2472a97d88` |

Both revisions were measured from clean trees with GPUIX `0.11.0-twirchat.25`, API 3, patch digest
`f6ff95b61fce09c8`, and native SHA-256
`ce789deb4d66695747865d79691dfd2400034bb7d5350c177255bdaf83ec4819`.

```sh
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```
