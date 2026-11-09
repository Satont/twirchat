# Chat link label performance

The native chat QA verified that the Cyrillic label paints correctly and Enter passes the original
encoded URL to the opener. Tokenizer tests cover wrapped labels, malformed escapes and invisible
characters.

## Setup

AMD Ryzen 7 9800X3D with 16 logical CPUs, Linux 7.3.1-1-cachyos and Bun 1.4.4. Each run used a fresh
process and private Weston display with a 1200×800 window, three seconds of warmup and two seconds
of drain. Channels retained 200 messages each. React mode was verified against the loaded
runtime. The runtime hashes cover the native artifact and were checked before and after each case.

GPUIX `0.11.0-twirchat.23`, API 3, patch digest `ec8d738268da160e`.
Native SHA-256 `7968a5ca95675c1d8a2a06e7d4a6fb82e0cc82e50881c5fd6a9e7839871cd41c`.
Both revisions were measured from clean trees.

- Baseline commit `b879983643d6b36e3f7051feb71a7364fa50557f`, runtime SHA-256
  `eb02d57d59e6421cec6601cd23fbd0be1696d497fc8107af3c4f842eed3128a3` (439 files).
- Candidate commit `65db1739a9d120664a7ad59f434139701085b57f`, runtime SHA-256
  `f4168b5ac839e28ecb05594a07dc077add710195eb263687856c34aa4cd8110e` (439 files).

## Production target

Each run offered 5000 messages/s across 50 channels with four visible panes for 30 seconds.
Run 4 is an additional before/after pair to check variation in event-loop lag.

```sh
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```

| Run | Msg/s | CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline 1 | 4991.2 | 44.3 | 376.1 | 469.3 | 161.0 | 2.23 |
| Baseline 2 | 4994.9 | 47.5 | 366.5 | 438.6 | 162.6 | 2.25 |
| Baseline 3 | 4995.2 | 46.2 | 361.2 | 459.7 | 153.8 | 2.24 |
| Baseline 4 | 4993.2 | 45.1 | 368.4 | 455.6 | 152.8 | 2.22 |
| Candidate 1 | 4995.9 | 44.9 | 360.1 | 445.8 | 155.6 | 3.02 |
| Candidate 2 | 4992.7 | 45.1 | 362.5 | 459.7 | 140.5 | 2.15 |
| Candidate 3 | 4986.1 | 49.7 | 362.2 | 468.5 | 154.2 | 3.10 |
| Candidate 4 | 4998.3 | 45.0 | 362.1 | 455.2 | 177.8 | 2.30 |

Medians and ranges across all four runs per revision.

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Processed messages/s | 4994.1 (4991.2–4995.2) | 4994.3 (4986.1–4998.3) |
| CPU, % of one core | 45.7 (44.3–47.5) | 45.1 (44.9–49.7) |
| Median RSS, MiB | 367.4 (361.2–376.1) | 362.2 (360.1–362.5) |
| Peak RSS, MiB | 457.7 (438.6–469.3) | 457.5 (445.8–468.5) |
| Peak JS heap, MiB | 157.4 (152.8–162.6) | 154.9 (140.5–177.8) |
| Event-loop lag p95, ms | 2.24 (2.22–2.25) | 2.66 (2.15–3.10) |

Every production run processed at least 99.7% of the offered rate. Median CPU and RSS stayed within
the baseline ranges. The candidate's median p95 lag was 0.42 ms higher across the four runs. The
additional pair measured 2.22 ms on the baseline and 2.30 ms on the candidate. The larger gap in
two runs did not repeat in that pair. The generator sends no URLs, so these samples measure
ordinary chat load.

## Development matrix

All 15 default cases completed. Each measurement lasted 12 seconds.

```sh
bun run --cwd packages/desktop bench:chat
```

| Scenario | Msg/s | CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c1-r0-p1 | 0.0 | 1.3 | 240.3 | 240.8 | 53.2 | 0.07 |
| c1-r100-p1 | 99.4 | 31.3 | 382.1 | 440.4 | 119.3 | 3.04 |
| c1-r1000-p1 | 996.2 | 34.2 | 386.0 | 519.5 | 168.0 | 4.42 |
| c1-r5000-p1 | 4980.5 | 38.8 | 401.5 | 486.8 | 161.3 | 4.41 |
| c10-r0-p1 | 0.0 | 1.0 | 247.2 | 247.6 | 54.8 | 0.06 |
| c10-r100-p1 | 99.6 | 16.3 | 303.9 | 334.9 | 79.9 | 0.06 |
| c10-r1000-p1 | 997.2 | 23.9 | 372.1 | 441.7 | 131.2 | 2.15 |
| c10-r5000-p1 | 4978.0 | 32.0 | 389.2 | 464.5 | 169.0 | 3.18 |
| c50-r0-p1 | 0.0 | 1.1 | 260.3 | 261.1 | 61.0 | 0.06 |
| c50-r100-p1 | 99.7 | 5.5 | 274.8 | 280.3 | 67.2 | 0.06 |
| c50-r1000-p1 | 998.2 | 23.5 | 355.7 | 401.2 | 115.9 | 1.25 |
| c50-r5000-p1 | 4968.4 | 25.5 | 384.9 | 482.8 | 164.7 | 2.14 |
| c50-r1000-p4 | 995.8 | 46.5 | 536.8 | 603.3 | 167.0 | 7.62 |
| c50-r5000-p4 | 4986.4 | 66.2 | 541.8 | 648.6 | 168.3 | 14.19 |
| c100-r5000-p4 | 4989.4 | 52.4 | 510.1 | 574.5 | 156.0 | 9.83 |
