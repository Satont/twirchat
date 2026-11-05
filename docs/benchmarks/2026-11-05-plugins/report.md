# TypeScript plugins and desktop chat performance

## Production target

Three fresh 30-second runs per version used 50 channels, four visible panes, 5000 total offered
messages/s and 200 retained messages per channel. Plugins were inactive in this comparison.
The 1200×800 window, three-second warmup and two-second drain matched across all runs. The
launcher verified production React, JSX and reconciler modules.

| Metric | Baseline median (range) | Candidate median (range) |
| --- | --- | --- |
| Processed messages/s | 4996.3 (4996.0–4996.6) | 4996.6 (4994.8–4996.7) |
| App CPU, % of one core | 81.77 (81.07–82.55) | 84.89 (82.97–90.36) |
| App RSS median, MiB | 490.0 (484.4–490.9) | 488.0 (486.7–491.8) |
| App RSS peak, MiB | 580.6 (579.6–592.5) | 585.8 (584.1–587.4) |
| App JS heap peak, MiB | 221.4 (213.6–227.6) | 228.1 (218.0–241.3) |
| App event-loop lag p95, ms | 1.46 (1.07–1.46) | 1.84 (1.65–2.32) |

App CPU increased 3.82% at the median. One candidate run reached
90.36% CPU, above the baseline range. The other two were
82.97% and 84.89%.
Median RSS changed -0.40% and peak RSS +0.89%.
Every target run processed over 99% of the offered rate during the timed window.

## Active subscriber

One real plugin counted all incoming message events in a separate process. The host workload
and timing matched the production target above. App CPU and RSS exclude the plugin process.

| Subscriber starts | Delivered/generated | App messages/s | App CPU % | App median RSS MiB | App lag p95 ms | Plugin final RSS MiB |
| --- | --- | --- | --- | --- | --- | --- |
| Before prefill | 149,998/149,998 | 4996.4 | 86.18 | 492.9 | 1.80 | 45.8 |
| After prefill | 149,980/149,980 | 4996.0 | 89.25 | 495.8 | 2.09 | 45.6 |

The first run enabled the plugin before synchronous prefill of 10,000 messages. The plugin
reported queue overflow outside the measurement window. The second enabled it after prefill
and before warmup, and reported no overflow. The subscriber used 0.58 and
0.61 seconds of CPU across each 30-second measurement and two-second drain.
The active feature adds projection and IPC work in the app and a separate process, while the
chat and subscriber both sustained the offered workload. The real-process regression tests
also exercise overload, handler errors and disabling a plugin stuck in a synchronous loop.

## Default development matrix

All 15 cases completed before and after, using 12-second measurements and the same 200-message
retention. This is development React. CPU includes React's development instrumentation.

| Scenario | Processed messages/s | App CPU % | App median RSS MiB | App peak RSS MiB |
| --- | --- | --- | --- | --- |
| c1-r0-p1 | 0.0 → 0.0 | 1.0 → 1.1 | 273.3 → 274.0 | 273.9 → 274.5 |
| c1-r100-p1 | 99.7 → 99.7 | 44.3 → 48.1 | 483.4 → 483.9 | 557.3 → 584.2 |
| c1-r1000-p1 | 997.4 → 997.9 | 63.3 → 68.0 | 488.3 → 488.0 | 575.8 → 623.5 |
| c1-r5000-p1 | 4970.7 → 4949.1 | 109.5 → 111.2 | 566.0 → 578.5 | 680.7 → 702.8 |
| c10-r0-p1 | 0.0 → 0.0 | 1.1 → 1.1 | 273.3 → 275.1 | 273.9 → 275.8 |
| c10-r100-p1 | 99.7 → 99.7 | 18.4 → 16.4 | 337.5 → 333.4 | 363.4 → 361.7 |
| c10-r1000-p1 | 997.9 → 998.1 | 44.9 → 45.3 | 459.9 → 484.5 | 539.2 → 577.2 |
| c10-r5000-p1 | 4991.0 → 4985.0 | 55.3 → 57.1 | 457.9 → 477.2 | 539.6 → 599.5 |
| c50-r0-p1 | 0.0 → 0.0 | 1.1 → 1.1 | 286.8 → 286.1 | 287.7 → 286.6 |
| c50-r100-p1 | 99.7 → 99.7 | 6.9 → 6.6 | 296.1 → 298.6 | 304.1 → 305.1 |
| c50-r1000-p1 | 998.1 → 997.7 | 31.4 → 30.3 | 406.2 → 411.8 | 467.1 → 472.9 |
| c50-r5000-p1 | 4987.2 → 4987.1 | 50.5 → 52.6 | 466.1 → 493.4 | 530.4 → 562.0 |
| c50-r1000-p4 | 997.4 → 997.2 | 73.2 → 76.4 | 648.6 → 648.8 | 803.0 → 761.8 |
| c50-r5000-p4 | 4989.0 → 4981.0 | 116.9 → 122.7 | 828.8 → 822.0 | 1053.3 → 988.8 |
| c100-r5000-p4 | 4982.9 → 4982.7 | 108.5 → 108.3 | 891.9 → 846.9 | 1085.9 → 1071.8 |

Paired development repeats used fresh profiles and the same timings. The selected increases
in CPU or peak RSS did not repeat.

- `c1-r1000-p1` repeated at 68.9% → 65.0% CPU and 612.9 → 581.6 MiB peak RSS. The matrix pair was 63.3% → 68.0% CPU and 575.8 → 623.5 MiB peak RSS.
- `c10-r5000-p1` repeated at 54.9% → 54.1% CPU and 608.6 → 578.3 MiB peak RSS. The matrix pair was 55.3% → 57.1% CPU and 539.6 → 599.5 MiB peak RSS.

The coupled generator and compact text workload cover the in-process DesktopEvents route and
native rendering. Provider networking, protocol parsing, emote enrichment and SQLite chat
logging are outside this measurement.

## Native verification

The isolated Linux GUI run exercised installation, enablement, disablement and removal in
Settings. It verified autocomplete and command execution in the standard composer, then opened
a plugin channel, sent a message, ran a command and reconnected the saved channel. Settings
were checked at 680×820 and chat at 1180×820.
The Linux release build launched the packaged plugin runner through the compiled executable
and exercised command registration and dispatch. The workspace suite passed 1216 tests and
skipped 15 PostgreSQL integration tests. Lint, typecheck and formatting checks passed.

## Provenance

All runs use Bun 1.4.4 on the same host and GPUIX `0.11.0-twirchat.15` with patch digest
`279b40c830eed623` and native artifact SHA-256
`206590819b17afc5347eba3defb5e2f92c74997d4b57f1f004a71619f9c3af31`.
The git base is `b190ee533ab897cfd4fab5584053e280ad00d0b0`.

| Stage | Runtime input SHA-256 |
| --- | --- |
| Baseline | `a74619ad83b5dd6b16a49080521360382d458bbe6f14b9940e1304e4d3141518` |
| Candidate matrix, targets and first subscriber | `1dca2be8591dd629244d074190d44913ede9693e0f38f5e02bfd9d02a7430a9f` |
| Subscriber after prefill and candidate repeats | `8f867c432963fd7361610d3d39611fbdc36268fb6932d1de959eb13704335d11` |

The second candidate snapshot moves subscriber activation after prefill in the opt-in driver.
A later cold-path fix preserves the result of successful installation and removal if cleaning a
staging directory fails. Functional checks cover that final code. [Run JSON and QA result](results.json.gz)

```bash
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30 --plugin-subscriber
bun run --cwd packages/desktop qa:gui --dbus --keep --timeout 80 -- bun scripts/qa-plugins.tsx
```
