# Animated emote memory and inline resolution

Native Path/URI images now use a per-view cache instead of GPUI's retain-all asset cache.
The cache accounts for every decoded frame, shares repeated resources, owns cancellable load
notifications, and releases CPU images and GPU atlas entries on eviction or view close.
Cold resources have a 64 MiB / 256-entry budget. Images used by the current/previous paint are
protected; a live working set can exceed the cold budget. A coalesced settling callback prunes
retired images even when the chat becomes idle. Epochs follow actual native draws, including
deferred virtual rows. The bounds are per view, not a process-RSS limit.

Inline 7TV images choose the smallest sufficient 1x–4x raster for logical height × cached
window scale. Default 28px inline art uses 1x; preview/catalog URLs remain authoritative.
A once-per-window scale event updates the context; rows do not poll native geometry.
The combined result includes [PR #86](https://github.com/Satont/twirchat/pull/86)'s background,
synchronized and deadline-driven animation behavior.

## Focused production measurements

Ten channels retain 200 messages each; one 1200×800 pane is visible. Each message contains two
copies of one animated image. The eight initial sources are 96×96, 32 frames, 100ms per frame.
The before/after encoded bytes are identical. Warmup is 3s; idle measurements are 12s in three
fresh processes/profiles per version. Native overlay statistics are read only at boundaries;
no overlay is enabled. CPU 100% is one logical core; memory is process RSS in MiB.

| Workload | Before | After |
|---|---:|---:|
| Idle CPU, median (range) | 29.41% (29.26–30.00) | 7.82% (7.67–8.03) |
| Idle native draws/s | 60.00 | 10.08 |
| Idle RSS medians, median | 285.0 | 283.8 |
| 20s distinct-image churn RSS median | 560.1 | 428.7 |
| 20s churn RSS peak | 830.0 | 470.9 |
| RSS after removing all message rows | 832.2 | 470.4 |

Churn adds 20 messages/s to the visible channel, each with a new image identity. Both versions
processed 399/399 generated messages (~19.95/s), preserving all 2000 retained messages until
the explicit post-measurement clear. The fixed cache then held 56 cold images / **63 MiB**,
with 351 evictions and zero pending loads. Idle repeated images decoded exactly eight times;
the byte counter included all 32 frames of each image. CPU/RSS samples, GPU counters, actual
rate, JS heap, lag and fixture/source hashes are preserved in [before](before/churn.json) and
[after](after/churn.json), plus all three idle JSON files in each directory.

A separately labelled 30s / 600-offered-image soak processed 599/599 generated messages
(~19.97/s): RSS median 451.3 MiB, peak 514.4 MiB, after-clear RSS 441.0 MiB; the same 56 cold
images / 63 MiB remained, with 551 evictions. [Raw soak](after/soak.json).
RSS includes allocator capacity, JS, code and driver mappings and is not capped at 64 MiB.
These short runs establish this resource-retention fix, not whole-application lifetime bounds.

## Default performance gate

All 15 default **development** cases completed; [matrix](development/report.md) and
[raw samples](development/results.json). Production is a separate mode. The three 30s
production repetitions preserve 50 channels, four panes, 5000 total offered messages/s and
200 retained messages per channel. React/JSX/reconciler mode was verified against loaded modules.

| Run | Actual msg/s | CPU % | RSS median MiB | RSS peak MiB | Heap peak MiB | Lag p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| Before 1 | 4996.1 | 113.62 | 501.5 | 595.4 | 208.0 | 2.85 |
| Before 2 | 4995.4 | 114.35 | 503.8 | 586.7 | 226.9 | 2.46 |
| Before 3 | 4993.6 | 113.05 | 507.8 | 592.7 | 235.9 | 2.76 |
| After 1 | 4996.5 | 114.54 | 511.2 | 633.1 | 227.4 | 2.62 |
| After 2 | 4995.7 | 114.78 | 499.5 | 586.7 | 238.1 | 2.76 |
| After 3 | 4995.8 | 114.11 | 505.9 | 600.0 | 245.7 | 2.76 |

Median CPU: **113.62 → 114.54%** (+0.81%); median of RSS medians: **503.78 → 505.91 MiB**
(+0.42%); median RSS peak: **592.70 → 600.03 MiB** (+1.24%). One after-run peak was 633.13 MiB;
the other peaks were 586.71 and 600.03 MiB. There is no repeated CPU/RSS regression above 5%
at the acceptance target, and each repetition preserved over 99% of the offered rate.
Lag-p95 medians stayed **2.761 → 2.760 ms**. Raw per-run results and provenance are retained
under `before/target-*` and `after/target-*`.

The supplementary development comparison reuses the separately recorded PR #86 matrix,
with the same timings/mode/window/retention: `c1-r5000-p1` CPU +6.7%.
Those are single-case differences, not repeated regressions or a claim of uniform speedup.
The text matrix excludes provider networking, enrichment and SQLite chat logging. The coupled
generator is not proof of maximum sustainable external throughput.

## Native and packaged QA

- [Synthetic animations](qa/functional-synthetic.json): 420×300 and 900×600; 10fps and 50fps
  encoded timelines, real native focus/blur/refocus, continued background motion, shared images
  and independent window close. A closed renderer retained in JS reports zero entries,
  pending loads and decoded bytes; the remaining window continues animating.
- [Inline 7TV selection](qa/functional-seventv.json): actual native source paths use 32px 1x
  files at scale 1; all frames/delays survive; original 128px 4x preview URLs/files are preserved.
  Fractional/HiDPI selection and scale-event/HMR/root cleanup are covered by unit tests.
  Native virtual-display pixel QA exercised scale 1; physical HiDPI and macOS/Windows runtime
  verification are not claimed.
- A downloaded public [RAGEY 1x GIF](https://cdn.7tv.app/emote/01GBFAYKGR000FWWN7MDZZ8XQN/1x.gif)
  (45×32, input hash in [real-asset.json](qa/real-asset.json)) passed the ordinary artwork,
  quoted-name, pending and failed-image native probe at 420/900px.
- Native chat keyboard/pointer behavior passed the existing production chat probe.
- The actual compiled production executable passed release smoke, executable-adjacent native
  resolution/database checks, and three native close-to-tray/restore cycles through `qa:gui`.
  [Packaged runtime](qa/packaged-runtime-result.json); [built app](qa/built-app-result.json).
- `bun run fix`, `bun run check`, `bun run test`: 1154 workspace tests passed, plus the quality
  suite; 15 PostgreSQL integration tests skipped. The release Rust suite passed, including nine
  new resource-budget regressions. The focused TypeScript cases passed (9 tests, 63 assertions).

## Provenance and reproduction

Ryzen 7 9800X3D / RX 7800 XT, Linux 7.3.1-1-cachyos, Bun 1.4.4, Rust 1.97.1.
Resource cases used private headless Weston GL; functional/pixel cases used private Xvfb,
with isolated profiles and D-Bus. No host window or desktop capture was used. A shared flock
serialized builds, tests, profilers and app resource measurements. No forced GC, allocator
trimming, performance-entry clearing, retention reduction or refresh-rate reduction was added.
The fixed 10fps fixture is redrawn at its actual encoded cadence rather than display cadence.

Before: source commit `1455a1dd59690e5e17aed753825f1b1c120c25f1`, runtime hash
`be50e6db29621cb85002b22e177392a9ee4768a8bfe8af9c277cb6a054e875e3` (355 files), native
`ad7fc24cef2eaf2f`, SHA-256 `cd10c5ab9042a0ef0c485c3b320f7862128b78e6809fba8aa4181ad1a379d248`.
After: parent `5c4f706ba2fe21bdad9bc065bf690ba3e2389c74` plus this diff, runtime hash
`3a70a065cd949a806304a6b536803336309ef2ffd8121b5bec649b929ef93738` (370 files), native
`0.11.0-twirchat.6` / `cb782c083032b0ed`, SHA-256
`459aa1d3165395c0fbb97f7bb10abf2daf03a1996a7e59659114f29bc2ff6c26`.
Native manifests, every case's actual source/probe hashes and all raw samples are included.
Later QA-only fixes to 20ms fixture generation and native-source capture did not change the
100ms measured payload (byte identity verified) or the application/native inputs.

```sh
bun run --cwd packages/desktop bench:chat --output /tmp/emote-matrix
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30 --output /tmp/emote-target-1
# Repeat target with fresh output directories for runs 2 and 3.
# qa-emote-resources takes configuration JSON then readBenchmarkProvenance JSON:
bun run --cwd packages/desktop qa:gui --node-env production --compositor weston --timeout 90 -- bun scripts/qa-emote-resources.tsx '{"case":"churn","durationSeconds":20}' '<provenance JSON>'
bun run --cwd packages/desktop qa:gui --node-env production --dbus --timeout 120 -- bun scripts/qa-emote-resources.tsx '{"case":"functional","source":"seventv","backgroundAnimation":true}' '<provenance JSON>'
```
