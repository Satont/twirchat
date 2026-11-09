# Shared decoded image resources

GPUIX shares decoded Path and URI image data across native windows. Each window retains
its own current scene and atlas. Cold entries expire after four minutes without use,
with a sweep once per minute. Images in the last painted scene stay pinned.
The minute sweep runs outside drawing. The final lease releases the shared entry.
The disk cache still stores encoded sources. GIF and WebP animations above 20 MiB of decoded pixels are scaled before frame
storage. Frame count and timing are preserved for the oversized fixture below.

## Provenance

Linux 7.3.1-1-cachyos, Ryzen 7 9800X3D, Radeon RX 7800 XT, Bun 1.4.4, and
private hardware-backed Weston. Each repetition had a fresh process and profile.
Production probes used production React. The standard text matrix uses development React.

| Variant | Native version and patch digest | Native SHA-256 | Runtime inputs SHA-256 |
| --- | --- | --- | --- |
| Before | `0.11.0-twirchat.23` / `ec8d738268da160e` | `2136fb4bc568d34f6a243b218c2e4631466fa1367b379915981cc972b1fd2d3d` | `5e52e0b97ae390bf9c67343515ee049c84867832a286764c0a6858385698ed3b` |
| Final | `0.11.0-twirchat.24` / `74ae2d4f71fc9b59` | `71327b75a3411066aae09f0cdaa1849b1f80df283910a68cc81e1623ddad0afc` | `8d9a77e253329287e844f668ffaf6d21b1449aa166bbc137bf4e76b6474e8329` |

Both source trees have HEAD `e0ff18f39bb903d3d3aa8d6bf61ccf1a434955f3`. The previous desktop RSS
report's text runs used the same baseline runtime input hash and native bytes. They
are reused for the production target and development matrix comparison below. The final native artifact is Linux x64.
The isolated image probes verified both the loaded addon and the fixture; benchmark
resource numbers exclude the separate compositor process.

## Same animation in two windows

Three fresh processes per variant rendered the same 140×140 WebP, 492 frames, in
two separate 640×360 native windows on a 1200×800 display. The rendered image box
stayed 140×140. The encoded input SHA-256 was
`b5e17484dd481adc40245939e35dbcd4f2d1aa7df0f75e6300553f10befd3d18`.

The baseline decoded 140×140 pixels per frame twice and retained 73.57 MiB of
frame pixels. The candidate decoded once and retained 19.91 MiB at 103×103 per
frame. Each view reported the full 19.91 MiB it referenced. PSS apportions shared
process mappings. Memory is in MiB, with medians (min–max).

| Variant | RSS | PSS | Anonymous PSS |
| --- | ---: | ---: | ---: |
| Before | 265.79 (264.86–265.81) | 211.01 (210.00–211.04) | 136.48 (135.63–136.55) |
| After | 208.35 (207.80–208.60) | 151.75 (151.17–151.90) | 79.55 (79.07–79.79) |

Median process RSS fell by 57.44 MiB (21.6%). Median PSS fell by 59.26 MiB (28.1%).
Both windows advanced animation before closure. The second window continued after
the first closed. A new window started a fresh decode after both leases ended.

## Lifetime checks

The gated loopback test made 1 HTTP request for two concurrent
loads. The window that started the decode closed before the response. The surviving
window received the bounded frames and kept animating. Closing both windows retired
both views' entries.

The idle test removed the image from one view and let it expire after
300.05 seconds. A second view kept showing the animation.
Returning to the image reused that view's lease and the total decode count stayed
at 1. These two probes ran on native patch digest
`8c19ed58018ad476`, SHA-256 `43e9acc1e1b1416d08fa447ceaef3745657fe1a4359bb4bc1702e389a1a12d3b`. The final patch
changed the expiry loop to equivalent `while let` syntax. The final addon repeated
the two-window probe, the image resource unit tests, and the standard image QA.

## Animated chat workloads

Three production repetitions per variant. The standard churn case retained 200
messages in each of 10 channels, with one visible 1200×800 pane, 20 offered
messages/s and 20 seconds of measurement. The incoming messages reference distinct 96×96 WebP sources
with 32 frames. This scenario keeps eight previously decoded images on screen.
Native image counters show zero new decodes and zero evictions during measurement. The dense idle case retained 200 messages in each of 23 channels,
with one 770×1300 chat window on a 1280×1500 desktop-shell display. It measured
12 seconds after 3 seconds of warmup.

| Workload | Actual msg/s | CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Churn before | 19.95 (19.95–19.95) | 4.77 (4.73–5.14) | 263.72 (262.40–264.93) | 284.97 (269.30–287.14) | 58.51 (58.50–58.51) | 0.06 (0.06–0.06) |
| Churn after | 19.95 (19.95–19.95) | 5.79 (5.30–6.16) | 263.17 (262.95–264.42) | 285.45 (285.37–285.91) | 58.49 (58.49–58.51) | 0.06 (0.06–0.06) |
| Dense before | 0.00 (0.00–0.00) | 3.45 (2.45–3.55) | 303.44 (302.13–305.84) | 304.86 (302.78–306.57) | 66.27 (66.24–66.28) | 0.07 (0.06–0.07) |
| Dense after | 0.00 (0.00–0.00) | 2.63 (2.37–2.81) | 304.18 (302.48–306.11) | 304.82 (303.08–306.79) | 66.27 (66.24–66.27) | 0.06 (0.06–0.06) |

Initial churn measurements showed higher CPU with more full draws. The cache
counters stayed constant and the expiry timer never fired during those samples.
To separate the native change from run order, six more runs alternated the same
two binaries against the identical final TypeScript and QA inputs
(`before, after, after, before, before, after`). Both variants verified the
native SHA-256 before launch.

| Variant | Actual msg/s | CPU % | Median RSS MiB | Peak RSS MiB | Full draws | Animation presents |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before | 19.95 (19.95–19.95) | 6.22 (6.19–6.30) | 263.85 (263.78–265.09) | 285.48 (285.46–287.00) | 289.00 (269.00–301.00) | 200.00 (200.00–200.00) |
| After | 19.95 (19.95–19.95) | 6.36 (6.06–6.40) | 264.32 (263.99–266.12) | 288.34 (287.09–288.91) | 285.00 (274.00–306.00) | 200.00 (199.00–200.00) |

The alternating series measured +0.14 percentage points of CPU (+2.2% relative)
and +0.47 MiB of median RSS. CPU and full-draw ranges overlap. The initial 21%
CPU difference did not repeat when the binaries alternated on the same inputs.
The dense idle measurements kept median RSS within 1 MiB.

## Production text target

Three 30-second production runs per variant with 50 channels, four panes and
5,000 offered messages/s. Each channel retained 200 messages. CPU is percent of
one logical core. The text fixture uses an in-process generator.

| Variant | Actual msg/s | CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before | 4991.95 (4988.65–4994.81) | 44.55 (43.78–44.58) | 361.71 (361.16–362.25) | 455.89 (443.05–471.83) | 157.13 (151.53–161.25) | 1.57 (1.57–1.88) |
| After | 4991.55 (4987.61–4993.91) | 43.85 (43.44–44.29) | 362.15 (357.32–365.39) | 448.60 (446.53–474.60) | 158.34 (151.06–161.59) | 2.33 (1.39–2.46) |

## Default development matrix

Each candidate scenario measured 12 seconds after 3 seconds of warmup. The matrix
checks the standard development workload separately from the production comparison.
Against the prior matching one-pass matrix, median RSS changed between −2.7%
and +2.2%. Individual CPU changes ranged from −4.6% to +12.9%. The largest
peak RSS difference was +9.8% in the four-pane 5,000 msg/s scenario. Its repeated
production runs had comparable throughput and median RSS and a lower median peak.

| Channels | Panes | Offered msg/s | Actual msg/s | CPU % | Median RSS MiB | Peak RSS MiB | Peak JS heap MiB | Lag p95 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 0.0 | 0.97 | 238.6 | 239.7 | 51.6 | 0.06 |
| 1 | 1 | 100 | 99.8 | 23.11 | 371.9 | 437.5 | 113.8 | 1.43 |
| 1 | 1 | 1000 | 996.0 | 32.75 | 392.3 | 475.5 | 167.9 | 3.66 |
| 1 | 1 | 5000 | 4978.0 | 33.89 | 390.4 | 492.8 | 164.0 | 4.10 |
| 10 | 1 | 0 | 0.0 | 1.03 | 243.5 | 244.1 | 53.3 | 0.06 |
| 10 | 1 | 100 | 99.7 | 14.79 | 300.4 | 325.9 | 77.4 | 0.07 |
| 10 | 1 | 1000 | 998.6 | 23.69 | 363.3 | 441.2 | 130.0 | 1.12 |
| 10 | 1 | 5000 | 4976.4 | 36.38 | 385.4 | 477.9 | 156.7 | 4.47 |
| 50 | 1 | 0 | 0.0 | 1.08 | 256.6 | 257.0 | 59.8 | 0.06 |
| 50 | 1 | 100 | 99.6 | 5.46 | 268.7 | 276.6 | 66.0 | 0.06 |
| 50 | 1 | 1000 | 998.7 | 22.95 | 353.1 | 402.8 | 112.3 | 1.39 |
| 50 | 1 | 5000 | 4965.6 | 26.10 | 379.1 | 459.5 | 159.3 | 2.04 |
| 50 | 4 | 1000 | 997.2 | 48.14 | 525.3 | 601.4 | 162.6 | 8.37 |
| 50 | 4 | 5000 | 4988.0 | 61.46 | 531.7 | 682.6 | 149.5 | 13.62 |
| 100 | 4 | 5000 | 4984.1 | 53.24 | 526.1 | 638.9 | 135.9 | 9.09 |

## Verification

- The Linux release addon and compiled desktop smoke build passed.
- The native unit suite passed 381 tests. A standalone harness ran five decoder
  tests with the exact pinned codec versions, including the under-budget GIF and
  WebP pixel and timing checks.
- Strict native Clippy emitted the same 38 existing diagnostics on the baseline
  and final sources.
- The workspace test suite passed 1,358 tests and skipped 15 PostgreSQL
  integration tests. Typecheck and workspace lint passed.
- Native QA checked background playback, scaling and cross-window cleanup at
  420 px and 900 px window widths. The second window used eight warm sources
  without starting a decode.
- Raw results remain in the local
  `/tmp/twirchat-shared-images-baseline.6FHCkh`,
  `/tmp/twirchat-process-images-candidate.uPvVwY` and
  `/tmp/ti-final.FtCVlg` directories. The alternating churn runs are in
  `/tmp/ti-alt.5MeJ63`.
