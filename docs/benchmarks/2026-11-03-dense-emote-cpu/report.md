# Dense animated-emote CPU — 2026-11-03

The remaining idle CPU was native scene reconstruction on every encoded image boundary. The deadline timer refreshed the entire uncached GPUIX tree: native elements, text/layout, focus bookkeeping and scroll maps were rebuilt despite no arriving messages. The existing inactive-window throttle explains much of the focus difference. The shipped AppImage inspected during diagnosis already contained native .6, patch digest cb782c083032b0ed.

Native .7 gives each painted synchronized source a window-owned atlas slot and updates only changed frame pixels before presenting the saved scene. Dirty UI, varying dimensions, tile relocation and GPU recovery use normal drawing. Slot retirement follows actual scene allocations; clipped/offscreen images create no animation demand. WGPU reuses per-texture bindings within a frame and immutable instance bindings only during explicit cached presentations; normal draws, instance-storage growth and device-resource replacement invalidate that cache.

A separate visibility defect was confirmed: GPUIX forwarded the list's wheel-scroll handler as onVisibleRange, so initial layout, programmatic jumps and resize could leave media loading gated to an old range. It now publishes changed ranges after completed list prepaint. ChatView already uses a native virtual-list with 512 px native overdraw; retaining 200 React/native message nodes did not mean painting all 200. Another small fix skips fresh/pending provider catalogs in the 1 Hz maintenance tick, preserving force refresh, expiry and preferences.

## Dense quiet chat

Production React/JSX/reconciler, compiled release addon, Bun 1.4.4, private headless Weston desktop shell on hardware AMD GPU, actual 770×1300 client on 1280×1500 display. 23 channels×200 retained messages, one visible pane, timestamps, static avatars/badges, replies/wrapping, 12 synthetic 7TV-style 1x sources with 32 preserved frames and delays 40/50/70/90/110/130/60/80/100/120/140/150 ms. Local frozen assets avoid network variation. 5 s warmup, 20 s measurement, three fresh processes per state. Focused and unfocused both keep the same blank second window; activation and geometry are checked before and after sampling. CPU is percent of one core. Cells show median (range).

| Window | Before CPU% | Final CPU% | Presentations/s before→after | RSS median MiB before→after | Full native draws/20 s before→after |
| --- | --- | --- | --- | --- | --- |
| focused | 56.32 (54.17–57.28) | 3.32 (3.18–3.32) | 55.25 (54.65–55.30) → 57.85 (57.85–57.90) | 347.43 (346.37–347.97) → 346.28 (344.58–346.67) | 1105 (1093–1106) → 1 (1–1) |
| unfocused | 29.80 (29.48–30.35) | 2.30 (2.29–2.35) | 25.50 (25.35–25.60) → 21.70 (21.70–21.70) | 348.92 (348.16–349.91) → 345.96 (345.80–348.43) | 510 (507–512) → 1 (1–1) |

No refresh-rate setting, retention limit, source resolution, feature or message-processing policy was reduced. The existing inactive ~30 fps throttle remains; actual aggregate cadence is recorded above. Final focused uploads are about 149 source frames/s, matching the encoded-delay sum 148.57/s; unfocused uploads are about 145/s under the existing inactive throttle. Functional pixel checks prove continuing motion and shared phase, rather than relying on frame counters alone.

The default observer samples every /proc/self/fdinfo file for GPU accounting four times/s. A separate, explicitly labeled observer-overhead experiment removes only those timed QA reads, retaining initial/final hardware verification, memory/CPU/lag sampling and the same application workload: focused 2.88%, unfocused 2.02%, one 20 s run each. These are not substituted for the repeated default measurements. The ≤2% ideal is not yet achieved in the focused fixture.

The fixture omits application chrome, real platform connections/provider networking and SQLite logging; it validates this rendering path, not the user's complete live profile. The Xvfb exploration had software/occlusion distortions and is excluded from resource comparisons. Xvfb is used only for isolated pixel/input checks. Kernel perf attachment was denied at perf_event_paranoid=2; no kernel settings were changed.

## Throughput and host variation

The original main baseline's production target CPU was 109.01 (108.15–109.49)%. After the first result crossed the 5% investigation threshold, three native .6 controls were repeated on the final JS tree with fresh directories: 115.96 (115.22–117.31)%. This exposed host drift; the initial measurements are preserved. The comparable .7 sixteen-patch target series is 114.62 (114.46–115.78)%, RSS 513.06 (505.41–524.39) MiB, peak 619.24 (610.51–635.34) MiB, JS heap peak 242.85 (234.70–247.51) MiB, lag p95 2.82 (2.38–2.98) ms, processed 4994.51 (4994.08–4995.88) msg/s. Controls use the actual pinned .6 artifact and sidecar, not a claim that current source.json built that binary.

The complete default 15-case development matrix was repeated for those native controls and for .7. No case increased CPU or RSS by more than 5% in the fresh comparison. Production and development results are separate. The coupled generator is not proof of maximum external throughput; the development single-channel 5000/s case processed about 4923/s. The required production 50-channel/four-pane/5000/s target retains 200/channel and exceeds 99% offered throughput.

The seventeenth, image-only immutable-instance cache is bypassed for the text-only workload (no explicit cached-scene hint). Its prior full matrix and three target runs are reused with exact sixteen-patch provenance. A fresh final-addon target guard processed 4995.15/s, CPU 116.18%, RSS 504.09 MiB and lag p95 3.12 ms, consistent with the fresh controls. Dense image resource and native functional checks were rerun on the final seventeen-patch binary.

| Scenario | Control CPU% | .7 CPU% | CPU change | RSS change | Processed/s |
| --- | --- | --- | --- | --- | --- |
| c1-r0-p1 | 1.20 | 1.13 | -5.8% | 0.4% | 0.00 |
| c1-r100-p1 | 61.11 | 61.77 | 1.1% | 3.5% | 99.75 |
| c1-r1000-p1 | 94.52 | 82.60 | -12.6% | -14.1% | 997.07 |
| c1-r5000-p1 | 167.69 | 131.48 | -21.6% | -12.8% | 4923.08 |
| c10-r0-p1 | 1.17 | 1.16 | -1.1% | 0.7% | 0.00 |
| c10-r100-p1 | 22.65 | 23.08 | 1.9% | 0.4% | 99.75 |
| c10-r1000-p1 | 66.87 | 61.23 | -8.4% | 1.1% | 997.57 |
| c10-r5000-p1 | 74.25 | 72.56 | -2.3% | -6.9% | 4987.51 |
| c50-r0-p1 | 1.27 | 1.21 | -4.8% | 0.5% | 0.00 |
| c50-r100-p1 | 7.57 | 7.86 | 3.9% | 1.1% | 99.75 |
| c50-r1000-p1 | 38.89 | 39.72 | 2.1% | -0.3% | 998.21 |
| c50-r5000-p1 | 65.80 | 60.42 | -8.2% | 0.3% | 4991.45 |
| c50-r1000-p4 | 95.03 | 95.77 | 0.8% | 0.4% | 997.57 |
| c50-r5000-p4 | 142.28 | 143.13 | 0.6% | 0.8% | 4981.77 |
| c100-r5000-p4 | 137.82 | 138.68 | 0.6% | -2.6% | 4987.65 |

The separate 23-channel×1500-emote catalog workload, 12 s per run with three repetitions, goes from 0.653 (0.617–0.662)% CPU to 0.341 (0.271–0.389)%. Exactly 23 catalog fetches occur in each run; fresh ticks perform no catalog traversal, while regression tests cover expiry and preference changes.

## Functional and source evidence

Final native pixel/input QA passed in the private Xvfb launcher at 420×300 and 770×1300. Foreground/background images change pixels with zero full draws during sampled animation windows; 12 source groups/36 copies share identical frame colors over six stable-frame samples. Real keyboard, pointer hover, scrolling and resize continue to trigger ordinary drawing. Draft latency was 38.1/105.6 ms in the software-rendered functional environment.

With 200 retained messages and 50 animated rows kept in history, a static viewport reports liveSlots=0 and unchanged uploads/presentations. Scrolling back exposes 12 slots, changes 509 pixels and resumes pure presentations with no full draw; scrolling away again returns to zero. The app is resumed through its native Pause control before generic teardown. See [functional-evidence.json](functional-evidence.json).

Base Git head: 1a1ebfc92edf8f464366bc23daae839146486c33 plus each recorded working diff. Initial dense runtime hash: 523e987ff05b1a2350b4cb2382cdd7ee6218924a8746dd387755bb6a3c0dc07e; fresh native-control hash: eb11437dfc21a374580bc256e8fb1daa7ebf6a29f48ecf0448740f2d11f7a7c7; sixteen-patch hash: dd0bee57b5d474731254fb2c4b95ec76ec2feed782d8febc6910e2bc78feb76f; final hash: 623fd1fb738aaad65ec61e8513a6977b52d5f9a2685e15930b10bfcc6c56fe13. Runtime/native inputs were frozen per measured process; builds, unit tests and other agent app instances were serialized outside resource runs. Both source revisions, Rust 1.97.1, API 3 and binary hashes are in [native-before.json](native-before.json), [native-after16.json](native-after16.json), and [native-final.json](native-final.json).

[summary.json](summary.json) contains medians/ranges including CPU, RSS, heap and lag. Exact original JSON bytes and frozen driver sources are gzip archived; [raw-index.json](raw-index.json) records uncompressed SHA-256 and size. Frozen drivers are gzip archived in drivers/. Read an archive with gunzip -c raw/final-target-guard.json.gz. Baseline/final image drivers have their own SHA in every result. Native source pins and all ordered patch checksums remain in packages/desktop/native/gpuix/source.json.

## Validation

- Workspace suites: 1161 passed, 15 existing PostgreSQL-dependent tests skipped. Project quality suite: 31 passed.
- Pinned native unit suite passed. The actual GPUI crate passed all 10 image-scene tests and the initial/programmatic-scroll/resize layout test. GPUI tests ran offline after dependency retrieval, with release profile debug=0, LTO=true and codegen-units=16 matching the native build profile.
- Workspace typecheck, lint and formatting checks passed. Existing upstream/native warnings remain.
- Compiled release smoke verified Bun 1.4.4, production React/JSX and native API 3.
- Executable-adjacent native loading, compiled app close/tray restoration, chat behavior, the real RAGEY 1x GIF/notices, and two image windows with close/retained-renderer cleanup all passed through the isolated launcher.
- Final dense pixel/input/visibility acceptance was repeated after the immutable GPU-instance cache. No host window, compositor rule or kernel setting was changed.

See [validation.json](validation.json) and the archived GUI result files in [raw-index.json](raw-index.json).
