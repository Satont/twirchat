# StreamX in the My channels timeline

The built-in chat workload used Bun 1.4.4 on a Ryzen 7 9800X3D. Each case ran in an
isolated Weston session at 1200×800 with a fresh profile, three seconds of warmup and
two seconds of drain. The generator sent compact text and retained 200 messages per channel.
The production repetitions verified the loaded React, JSX runtime and reconciler mode.

## Production target

Three 30-second runs per version used 50 channels, four visible panes and 5000 offered
messages/s. The table gives the median and range across repetitions.

| Metric | Baseline | Candidate | Median change |
| --- | --- | --- | --- |
| Processed messages/s | 4994.7 (4993.9–4996.4) | 4996.6 (4996.4–4996.6) | +0.04% |
| App CPU, % of one core | 86.79 (82.12–88.35) | 87.44 (84.93–89.55) | +0.75% |
| App median RSS, MiB | 498.2 (495.1–503.4) | 498.7 (495.2–500.0) | +0.10% |
| App peak RSS, MiB | 616.9 (588.9–623.5) | 615.6 (588.4–636.9) | -0.20% |
| App peak JS heap, MiB | 221.2 (217.2–254.9) | 237.4 (218.9–251.8) | +7.33% |
| App event-loop lag p95, ms | 1.90 (1.54–2.12) | 1.87 (1.77–2.21) | -1.73% |

All production runs processed at least 99.88% of the offered rate during the timed window.

## Default development matrix

Each case measured 12 seconds with development React. Values are baseline → candidate.

| Scenario | Processed messages/s | App CPU % | App median RSS MiB | App peak RSS MiB |
| --- | --- | --- | --- | --- |
| c1-r0-p1 | 0.0 → 0.0 | 1.1 → 1.0 | 278.7 → 279.7 | 279.5 → 280.3 |
| c1-r100-p1 | 99.7 → 99.7 | 45.0 → 48.5 | 486.2 → 473.1 | 574.1 → 555.1 |
| c1-r1000-p1 | 996.9 → 997.5 | 64.0 → 66.7 | 496.1 → 508.1 | 584.8 → 628.7 |
| c1-r5000-p1 | 4965.5 → 4958.6 | 110.3 → 112.8 | 590.3 → 569.5 | 686.7 → 673.0 |
| c10-r0-p1 | 0.0 → 0.0 | 1.1 → 1.0 | 279.2 → 281.6 | 280.3 → 282.2 |
| c10-r100-p1 | 99.7 → 99.7 | 17.0 → 17.1 | 337.6 → 337.9 | 368.5 → 366.7 |
| c10-r1000-p1 | 997.2 → 998.0 | 49.0 → 55.5 | 463.6 → 466.0 | 556.0 → 548.8 |
| c10-r5000-p1 | 4991.5 → 4993.0 | 59.2 → 55.3 | 485.0 → 466.7 | 608.2 → 578.5 |
| c50-r0-p1 | 0.0 → 0.0 | 1.1 → 1.2 | 294.0 → 292.8 | 295.0 → 293.1 |
| c50-r100-p1 | 99.8 → 99.7 | 6.4 → 7.0 | 306.8 → 305.5 | 314.9 → 313.2 |
| c50-r1000-p1 | 998.0 → 997.7 | 29.1 → 29.7 | 405.4 → 402.1 | 471.8 → 478.9 |
| c50-r5000-p1 | 4986.0 → 4991.6 | 46.6 → 46.7 | 493.3 → 482.6 | 553.1 → 568.1 |
| c50-r1000-p4 | 998.5 → 997.2 | 70.5 → 71.6 | 660.2 → 645.4 | 784.8 → 796.9 |
| c50-r5000-p4 | 4989.0 → 4986.4 | 114.8 → 117.4 | 889.8 → 884.8 | 1021.0 → 1128.9 |
| c100-r5000-p4 | 4986.2 → 4984.6 | 107.5 → 109.1 | 834.2 → 870.5 | 993.3 → 987.8 |

Selected development cases were repeated with fresh profiles.

| Scenario | Baseline CPU % / peak RSS MiB | Candidate CPU % / peak RSS MiB |
| --- | --- | --- |
| c50-r5000-p4 | 114.8 / 1021.0 · 117.8 / 1094.9 · 116.4 / 1181.1 | 117.4 / 1128.9 · 121.2 / 1131.5 |
| c10-r1000-p1 | 49.0 / 556.0 | 55.5 / 548.8 · 47.7 / 577.1 |
| c1-r1000-p1 | 64.0 / 584.8 | 66.7 / 628.7 · 65.3 / 578.6 |

The candidate's four-pane RSS peaks fell inside the range of the three baseline runs.
Median CPU and peak RSS changed by +2.5% and +3.2% in that development case. The
CPU increase at ten channels and the RSS increase at one channel did not recur.

The matrix measures built-in watched panes without plugin sources configured. It includes
in-process message generation, stores and native rendering. It excludes provider networking
and persistence. The coupled generator does not measure maximum external throughput.

## Combined feed verification

The isolated native test moved a read-only plugin split at 680×720, verified the persisted
source and checked that the older plugin row appeared before the built-in Kick row. At
1180×820, a new plugin message stayed out of the paused view and appeared on resume.
Removing the source left the Kick message visible. An anonymous StreamX smoke test loaded
50 recent messages through the installed plugin. All carried a valid nickname color.

## Provenance

| Stage | Commit | Runtime inputs SHA-256 |
| --- | --- | --- |
| Baseline | `fd3ecb107bfe25cbee8094a5724cc047e33e7ca1` | `8873f4e82a4d70de2dc08581316b6722e62a9976e5d65540b76b6bdb9d98721c` |
| Candidate | `f1c3327c0ea20a54300485967d87d720bf9e439b` | `a844e2453aa0afa0af1b1a4b1b82a51fa2eeacc0da631a04eeee0d40154195dc` |

Both stages used GPUIX `0.11.0-twirchat.15` with patch digest `279b40c830eed623`
and native SHA-256 `206590819b17afc5347eba3defb5e2f92c74997d4b57f1f004a71619f9c3af31`.

[Per-run metrics and resource samples](results.json.gz)
