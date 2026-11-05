# StreamX OBS delivery and native chat rows

The built-in workload ran with Bun 1.4.4 on a Ryzen 7 9800X3D. Each case ran in isolated Weston at
1200×800 with a fresh profile, three seconds of warmup, two seconds of drain and 200 retained
messages per channel. The benchmark verified the loaded React, JSX and reconciler modes.

## Production target

Three 30-second runs per version used 50 channels, four visible panes and 5000 offered messages/s.
Values are medians with the range across runs.

| Metric | Baseline | Candidate | Median change |
| --- | --- | --- | --- |
| Processed messages/s | 4995.9 (4995.8–4996.5) | 4996.3 (4995.5–4996.6) | +0.01% |
| App CPU, % of one core | 86.36 (83.74–86.37) | 84.21 (83.52–85.38) | -2.49% |
| App median RSS, MiB | 492.2 (489.5–503.7) | 494.4 (493.0–502.9) | +0.44% |
| App peak RSS, MiB | 605.7 (593.8–611.0) | 588.2 (571.9–596.7) | -2.88% |
| App peak JS heap, MiB | 236.0 (219.3–242.7) | 216.9 (215.5–231.4) | -8.08% |
| App event-loop lag p95, ms | 1.74 (1.52–1.92) | 1.59 (1.58–2.27) | -8.54% |

The candidate processed at least 99.91% of offered messages/s during the timed window.

## Default development matrix

The candidate completed all 15 cases at the default 12-second measurement duration.

| Scenario | Processed messages/s | App CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | --- | --- | --- | --- | --- | --- |
| c1-r0-p1 | 0.0 | 1.1 | 278.5 | 279.1 | 63.4 | 0.1 |
| c1-r100-p1 | 99.7 | 46.4 | 484.5 | 576.4 | 162.0 | 1.0 |
| c1-r1000-p1 | 996.8 | 65.3 | 496.0 | 570.7 | 148.3 | 3.8 |
| c1-r5000-p1 | 4964.6 | 109.4 | 565.0 | 679.3 | 204.8 | 25.0 |
| c10-r0-p1 | 0.0 | 1.1 | 281.8 | 282.3 | 64.1 | 0.1 |
| c10-r100-p1 | 99.7 | 16.3 | 341.3 | 368.5 | 92.7 | 0.4 |
| c10-r1000-p1 | 997.0 | 44.1 | 473.9 | 551.6 | 169.7 | 0.8 |
| c10-r5000-p1 | 4987.1 | 54.6 | 478.1 | 596.8 | 134.7 | 2.4 |
| c50-r0-p1 | 0.0 | 1.1 | 293.8 | 294.7 | 70.4 | 0.1 |
| c50-r100-p1 | 99.7 | 6.9 | 309.4 | 316.3 | 77.7 | 0.1 |
| c50-r1000-p1 | 997.8 | 27.1 | 412.8 | 481.2 | 138.6 | 0.1 |
| c50-r5000-p1 | 4992.9 | 49.6 | 471.8 | 558.6 | 158.0 | 1.6 |
| c50-r1000-p4 | 997.7 | 74.6 | 662.7 | 822.2 | 201.2 | 2.4 |
| c50-r5000-p4 | 4988.1 | 113.9 | 884.2 | 1137.4 | 260.2 | 10.0 |
| c100-r5000-p4 | 4988.2 | 107.5 | 905.4 | 1090.8 | 285.1 | 6.5 |

The matrix uses built-in sources, with no OBS client or plugin source configured. It checks that
regular chat keeps its throughput and resource profile. The coupled generator does not measure
maximum external throughput.

## Functional verification

In isolated Chromium, a locally installed copy of StreamX connected to a GraphQL fixture. Live
messages appeared in OBS with their author color. The history stayed in desktop chat, a live copy
overlapping history appeared once, and the overlay followed changes to selected sources and URL
platform filters. Isolated native QA verified the mixed feed at 680×720 and 1180×820, both chat
layouts, text wrapping, the timestamp toggle, and live delivery after resuming paused chat.

## Provenance

| Stage | Commit | Runtime inputs SHA-256 |
| --- | --- | --- |
| Baseline | `6fb1d43d32fb834dc9b1cbd6a9625715ed6588ca` | `4764418bd1828e211c7371300e64710e5ce0d4ebfec1b09060e011264f152ae5` |
| Candidate | `c8ee61c337a1558629884397724c1ca9284d2639` | `ca8b020efdd25c967a1d9895b62d5ccffaa9b125a5921d4b8ab119b5d0e21e71` |

Both stages used GPUIX `0.11.0-twirchat.16` with patch digest `c5169bd136c262de`
and native SHA-256 `ad81b54afb06d85152e866da398c5b0b1b8f27042ac2f398a9ed179de82ec802`.

[Per-run metrics and resource samples](results.json.gz)
