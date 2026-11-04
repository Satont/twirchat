# Chat hover CPU: bounded plain-text reuse

Sustained cross-row pointer motion reduced process CPU from **57.28% to 35.56% of one logical core
(−37.91%)** in three fresh production runs per version. RSS medians fell 1.93%; the window kept approximately 60 native
presentations/s and visible emotes kept animating. This is an improvement, but the desired
Chatterino-like **≤2% CPU** during sustained chat hover is still unmet.

These are native-source fixtures with synthetic animated 7TV-shaped assets, not a compiled AppImage
or a measurement of the user's account/profile. Hardware resource results use private headless
Weston GL. Xvfb checks below use software rendering and establish functional behavior only.

[Machine-readable summary](summary.json), [exact evidence index](raw-index.json).

## Cause and change

Mouse movement within one row was inexpensive. Crossing rows changed hover backgrounds/action
colors, requesting a root repaint and rebuilding and laying out the visible word-sized text elements.
The chat already uses a native virtual list; this was not evidence that every retained emote or
message was being painted. Native UI layout and allocation dominated the sampled CPU profile.

The change removes redundant raw/selectable-text wrappers and reuses eligible eventless plain
text hosts inside virtual-list rows for background/color-only hover changes. It does not merge
words across inline images or cache whole chat rows. Text selection registries, painted text and
painted automation bounds are replayed in order with cached glyphs. The per-window map is bounded
at 4096 entries and retired identities are removed; full mutations, window close and incompatible
contexts invalidate reuse. Resize, typography/scale, selection, accessibility and active-motion
conditions retain the full path. A tree-generation guard prevents a later full mutation from
reusing a paint-only frame snapshot.

No message dropping, retention reduction, explicit FPS reduction, forced GC, allocator trimming,
image-animation disabling or User Timing entry clearing was used.

## Headline: final artifact, deterministic motion fixture

Three fresh processes per version; production React/JSX/reconciler verified; 770×1300 chat window,
23 channels × 200 retained messages, 12 distinct 32-frame animated sources, avatars/badges/replies
and wrapping text. Five-second warmup, 20-second measurement, 120 offered native pointer calls/s,
0.25-second one-way sweep across 13 visible rows. Both versions use the exact fixed-timestamp
`07b278…` driver and identical path: x=550, y=114→1186, viewport (0,44,770,1205).
Configuration, path, window, retention and driver bytes were compared strictly for all six runs.

Values are median (minimum–maximum) across three fresh runs.

| Metric | Baseline .7 | Final generation-guard .9 |
|---|---:|---:|
| CPU % | 57.28 (56.11–58.56) | 35.56 (34.78–36.06) |
| RSS median MiB | 374.7 (371.7–375.4) | 367.5 (365.3–369.1) |
| RSS peak MiB | 390.8 (378.5–391.5) | 383.8 (380.9–386.0) |
| JS heap peak MiB | 103.1 (101.5–104.8) | 101.7 (101.3–103.2) |
| Event-loop lag p95 ms | 0.119 (0.095–0.123) | 0.074 (0.070–0.076) |
| Event-loop lag max ms | 11.00 (10.96–11.19) | 5.62 (4.85–6.33) |
| Native pointer calls/s | 119.93 (119.92–119.93) | 119.95 (119.95–119.95) |
| Native mutation batches | 961 (961–961) | 961 (961–961) |
| Native full draws | 960 (959–960) | 939 (933–940) |
| Total presents | 1200 (1199–1200) | 1200 (1199–1200) |
| Total presents/s | 59.98 (59.94–59.99) | 60.00 (59.95–60.00) |

Both versions dispatched 2399/2400 offered pointer calls (99.958%) and retained all 4600 messages.
Mutation batches and operations remained 961 and 13,441 per run. Full draws decreased 2.19%,
while total presents stayed 1199–1200; the 37.91% CPU reduction is substantially larger than that
frame-count difference. Raw counter changes are preserved rather than hidden by normalization.

The earlier wall-clock `2b85…` fixture measured baseline .7 → intermediate intermediate .9 at
57.22% (57.16–58.79) → 38.38% (37.28–38.96). That is a separate series, not pooled with the
headline fixed-timestamp/final-artifact comparison.

## Controls and diagnostic profile

Fresh fixed-timestamp controls used the same `07b278…` driver on baseline .7 and intermediate .9.
With no movement CPU was 2.995% → 2.787%; within-row 120 calls/s CPU was 3.348% → 3.317%.
Each control had one full draw and one mutation batch during 20 seconds. Both same-row paths
matched exactly at y=114, x=550→630. These are single controls, not three-run estimates.

The original wall-clock same-row pair differed at y=114 versus y=134, so it remains explicitly
**non-comparable**, with no percentage change reported. Its raw data is retained. The new fixed
message timestamp removed that mismatch in the fresh pair; no global clock/timer was overridden.
The original no-movement result also remains recorded, including its single-run +6.09% CPU and
+9.70% peak RSS changes; it is not silently replaced by the later control.

User-only `cycles:u` profiling was performed separately on baseline .7 and intermediate .9, excluded from
acceptance medians. Reports filter the actual app process and trim 0.5 seconds off each boundary;
both report zero lost samples. In intermediate, native UI addon + libc accounted for 90.67% of sampled
cycles; Taffy layout, retained focus/tab-index scans, bounds/element-state bookkeeping and allocation
remain useful next targets. These profiles are not measurements of the final generation guard.
[Baseline metadata](profiling/baseline.json.gz), [intermediate metadata](profiling/aa.json.gz),
[intermediate flat symbols](profiling/aa-flat.txt.gz). Raw perf files remain outside the repository, with
sizes/hashes in the metadata.

## Load acceptance: exact intermediate provenance reused

The complete 15-case development matrix, three production target repetitions and 18 focused RSS
investigation runs were frozen on intermediate intermediate native SHA `aa1b6c4a…`, runtime source hash
`2e60dc45…`. The final artifact adds the narrow generation-ordering correctness guard for a
full mutation arriving after a saved paint-only frame. That event is absent from these load
workloads. Its generation bookkeeping is O(1); the intermediate matrix/repeats are reused with their exact
original provenance, not relabeled as final-artifact runs. The exact intermediate cache patch and native
source pins are archived so this stage can be reconstructed independently of the final patch.

The final artifact separately passed 344 native units, window lifecycle, functional replay/glyph
checks, three headline motion runs and a fresh production load target. This focused reuse follows
the repository rule for later narrow cold-event fixes. It is not a claim that all 15 matrix cases
were rerun on the final artifact.

### Production target: three fresh runs per version

50 channels, four panes, 5000 total offered messages/s, 200 retained/channel; 1200×800 window,
three-second warmup, 30-second measurement, two-second drain. Production User Timing count was
zero. Values are medians (minimum–maximum); baseline and intermediate both preserve at least 99.89% of the
offered messages. The host is shared: baseline CPU varied 107.44–117.13%, so causal timing claims
should not ignore host variation.

| Metric | Baseline .7, n=3 | intermediate .9, n=3 |
|---|---:|---:|
| CPU % | 116.79 (107.44–117.13) | 103.08 (102.88–105.14) |
| RSS median MiB | 513.7 (511.7–514.1) | 498.0 (492.4–512.1) |
| RSS peak MiB | 606.9 (603.2–618.7) | 625.1 (605.0–627.5) |
| JS heap peak MiB | 226.5 (226.2–233.5) | 233.7 (232.0–238.3) |
| Actual processed messages/s | 4995.08 (4994.65–4996.18) | 4995.05 (4994.61–4996.27) |
| Processed / offered % | 99.902 (99.893–99.924) | 99.901 (99.893–99.926) |
| Event-loop lag p50 ms | 0.055 (0.055–0.055) | 0.055 (0.055–0.055) |
| Event-loop lag p95 ms | 2.685 (2.669–2.848) | 2.527 (2.363–2.659) |
| Event-loop lag max ms | 10.20 (8.75–10.98) | 9.59 (9.14–10.74) |

The final generation-guard artifact's additional fresh target processed **4994.95
messages/s** (99.899% of offered), CPU
**101.02%**, RSS median **507.9 MiB**, peak
**606.0 MiB**, heap peak **233.1 MiB**,
lag p95 **2.68 ms**. This is one final-artifact check, kept separate
from the intermediate three-run summary.

### Complete development matrix

Each cell is baseline .7 → intermediate .9, one fresh sample/version/case, 12-second measurement plus
three-second warmup. Memory is MiB. These single rows flag changes for investigation; they do not
establish repeated regressions. Detailed samples, source pins and generated/processed/drained
counts remain in [baseline raw](raw/baseline-matrix.json.gz) and [intermediate raw](raw/aa-matrix.json.gz).

| Scenario | CPU % | RSS median | RSS peak | Heap peak | Actual msg/s | Lag p95 ms | Timing entries |
|---|---:|---:|---:|---:|---:|---:|---:|
| c1-r0-p1 | 1.13 → 1.12 | 290.4 → 281.2 | 291.0 → 282.3 | 62.6 → 62.6 | 0.0 → 0.0 | 0.07 → 0.06 | 511 → 478 |
| c1-r100-p1 | 62.33 → 57.40 | 495.1 → 483.2 | 589.4 → 595.1 | 163.7 → 163.1 | 99.7 → 99.8 | 2.40 → 2.22 | 54477 → 55124 |
| c1-r1000-p1 | 82.63 → 79.20 | 500.8 → 494.0 | 595.3 → 614.2 | 152.9 → 150.9 | 998.5 → 996.7 | 4.84 → 4.86 | 65659 → 66182 |
| c1-r5000-p1 | 133.64 → 121.88 | 576.9 → 584.5 | 691.2 → 704.4 | 195.7 → 232.2 | 4933.1 → 4890.9 | 24.79 → 23.67 | 50474 → 46687 |
| c10-r0-p1 | 1.14 → 1.15 | 288.0 → 285.4 | 288.5 → 286.3 | 63.3 → 63.3 | 0.0 → 0.0 | 0.06 → 0.08 | 478 → 481 |
| c10-r100-p1 | 22.01 → 20.35 | 346.8 → 341.9 | 372.8 → 372.4 | 88.2 → 91.4 | 99.7 → 99.8 | 0.19 → 0.89 | 10814 → 10855 |
| c10-r1000-p1 | 62.19 → 58.00 | 486.7 → 490.2 | 599.2 → 569.8 | 173.0 → 164.8 | 997.2 → 997.8 | 2.10 → 2.47 | 56155 → 56365 |
| c10-r5000-p1 | 75.22 → 66.33 | 481.1 → 469.5 | 574.8 → 642.5 | 165.8 → 144.4 | 4993.0 → 4985.9 | 3.49 → 3.47 | 64683 → 63612 |
| c50-r0-p1 | 1.24 → 1.25 | 301.2 → 295.0 | 301.8 → 295.8 | 69.6 → 69.6 | 0.0 → 0.0 | 0.06 → 0.08 | 507 → 479 |
| c50-r100-p1 | 7.55 → 6.90 | 312.8 → 309.1 | 322.1 → 316.5 | 76.7 → 76.7 | 99.7 → 99.7 | 0.24 → 0.26 | 2717 → 2691 |
| c50-r1000-p1 | 40.49 → 35.59 | 422.5 → 415.0 | 482.7 → 473.0 | 135.6 → 136.8 | 997.5 → 998.2 | 0.10 → 0.10 | 20312 → 20016 |
| c50-r5000-p1 | 68.02 → 59.04 | 475.5 → 489.5 | 528.0 → 567.1 | 170.1 → 158.7 | 4986.6 → 4990.7 | 2.19 → 2.65 | 55941 → 55171 |
| c50-r1000-p4 | 93.84 → 87.47 | 679.9 → 674.3 | 796.1 → 756.5 | 207.1 → 197.9 | 997.0 → 997.3 | 2.07 → 2.58 | 56631 → 56815 |
| c50-r5000-p4 | 143.19 → 137.13 | 886.8 → 799.3 | 1140.8 → 1012.7 | 276.6 → 269.5 | 4984.5 → 4991.2 | 13.56 → 13.99 | 139195 → 138275 |
| c100-r5000-p4 | 140.05 → 130.19 | 827.1 → 841.4 | 943.8 → 1081.1 | 272.5 → 240.6 | 4987.3 → 4986.6 | 11.28 → 10.13 | 106191 → 107875 |

The c1-r5000 development case is below 99% delivery in both versions (98.66% → 97.82%; actual
4933.10 → 4890.90 messages/s). The required 50-channel/four-pane target remains above 99%.
Do not describe the whole matrix as meeting 99%, or use the coupled generator as proof of maximum
sustainable external throughput. Execution-mode effects are separate from algorithm changes.

### Peak-RSS investigation: preserve initial spikes, compare fresh repeats

Initial matrix peak RSS rose 11.78% for c10-r5000-p1, 7.41% for c50-r5000-p1 and 14.55% for
c100-r5000-p4. Those measurements remain in the table/raw archive. Each flagged case was then
repeated three times per version, in fresh processes with unchanged development mode, timing,
window and retention. Values below are median (minimum–maximum), memory MiB.

| Scenario | Version | CPU % | RSS median | RSS peak | Heap peak | Actual msg/s | Lag p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|
| c10-r5000-p1 | Baseline .7 | 73.57 (72.56–75.13) | 499.8 (483.3–500.0) | 607.4 (575.1–613.2) | 161.0 (149.4–164.6) | 4987.4 (4985.9–4990.8) | 2.95 (2.43–3.32) |
| c10-r5000-p1 | intermediate .9 | 66.52 (64.36–68.40) | 481.9 (480.7–483.0) | 597.9 (573.2–617.0) | 167.6 (130.3–178.9) | 4986.8 (4986.8–4987.8) | 3.15 (2.82–3.17) |
| c50-r5000-p1 | Baseline .7 | 65.61 (64.08–67.02) | 485.9 (476.1–496.3) | 550.5 (537.3–566.9) | 158.2 (149.6–173.3) | 4991.2 (4987.1–4992.8) | 2.51 (2.49–2.75) |
| c50-r5000-p1 | intermediate .9 | 57.79 (57.04–58.40) | 488.9 (481.0–504.1) | 550.4 (546.5–556.7) | 168.4 (167.6–170.0) | 4987.9 (4985.6–4990.6) | 2.35 (2.19–2.46) |
| c100-r5000-p4 | Baseline .7 | 141.13 (138.01–141.86) | 829.0 (792.2–836.1) | 987.2 (952.4–1069.6) | 231.5 (231.2–273.1) | 4987.7 (4987.2–4990.8) | 11.50 (10.90–12.41) |
| c100-r5000-p4 | intermediate .9 | 128.88 (125.23–129.68) | 783.2 (782.0–811.8) | 970.9 (959.9–971.8) | 244.9 (244.0–246.8) | 4984.9 (4983.7–4987.4) | 11.43 (11.39–11.93) |

Repeated peak-RSS medians changed −1.57%, −0.01% and −1.65%, respectively; no repeated CPU or
RSS median/peak increase exceeds 5%. Heap-peak medians changed +4.09%, +6.44% and +5.78%, with
overlapping baseline/final ranges, so not every memory metric improved. Initial c100 heap troughs
stayed near 149–153 MiB, and c10 near 73–75 MiB. RSS humps sometimes fell after those heap drops;
allocator/collection-phase variance is plausible, not proven by explicit GC telemetry. These short
runs do not establish long-session leak freedom. [Full repeated analysis](investigation-aa.json.gz).

## Functional and native correctness

All GUI checks used the isolated launcher/private Xvfb display; no host desktop windows or
screenshots were used. Xvfb CPU is not compared with the hardware resource runs.

- Final glyph QA at 420×300 and 770×1300 performed 240 cross-row moves, returned to exactly the
  initial pointer position, and compared raw RGBA before selection/clear/full repaint. Both patches
  had zero changed pixels: 1512 pixels/302 distinct baseline RGB colors and 2320 pixels/408 colors.
  This rejects two blank patches passing by equality. Geometry was queried before priming; later
  checks used completed painted snapshots. [Small before](qa/glyph-420-before.png),
  [small after](qa/glyph-420-after.png), [normal before](qa/glyph-770-before.png),
  [normal after](qa/glyph-770-after.png).
- The same final check preserved 62 and 838 fully visible text-host/raw-node bounds, exact painted
  text order/multiplicity and native drag selection. Composer input, scrolling, hover actions,
  source synchronization, focused/unfocused animation, and offscreen pause/resume passed.
  [Final glyph result](qa/guard-final-glyph-functional-0f33-emote-resources-result.json.gz).
- Standalone text QA preserved all compared geometry and pixels at 720×880 and 360×880, including
  mixed raw text, wrapping/ellipsis, Unicode highlights, selectable islands, copy/paste newlines
  and native-link click versus drag. Its `bfdee82e…` driver and relevant text implementation are
  unchanged by the later ordering guard; the exact earlier result/comparison is reused.
  [Comparison](qa/baseline-vs-aa-text-comparison.json.gz).
- Final canonical native source/build/check passed; 344 native tests passed against byte-identical
  private/canonical sources. Seven GPUI helper tests are reused with unchanged helper bytes.
  1206 JavaScript tests passed; 15 existing PostgreSQL integration tests were skipped.
  Final QA is included in the GPUIX TypeScript project; full workspace typecheck/fix passed.
- Native Clippy remains blocked by 38 pre-existing errors; final diagnostics match the
  pre-cache .8 wrapper-only control exactly. The diagnostic comparison is archived. This is not reported as a clean Clippy pass.
  [Native validation](validation/native-generation-provenance.json.gz),
  [Clippy comparison](validation/native-clippy-comparison.json.gz).

## Exact provenance and reproduction

Ryzen 7 9800X3D, 16 logical CPUs, RX 7800 XT, Linux 7.3.1-1-cachyos, Bun 1.4.4, Rust 1.97.1,
GPUIX upstream `2e31b47ff6432ceebe70e7fc7b0f51a76d7d30cf`, GPUI
`f77e5cfe9dad04288566f00c66ecf3c58d6f84b3`, native API 3. All stages start from repository
HEAD `7119a4388422d898e20b2b3127fd9efdd00b93d5` plus the recorded dirty diff/runtime sources.

| Stage | Native version/digest | Native SHA-256 | Runtime source SHA-256 |
|---|---|---|---|
| Baseline | .7 / bfbec2a2a379ceb8 | 28eaaecdb986dd0d1b63e815d9321968d4bd5b9ac700e527f945c1ceec8197ab | a7fcb8c4d41da250a08a8f4723d2577ca02a7584a83a627addd3fa4d9cc1ae32 |
| intermediate load gate | .9 / 81a1917e56ed419f | aa1b6c4a8fe89f798a9d1c84d42ebea88f6b141a729dd0e47b58042c40c516dc | 2e60dc4512ee0194754234d7940a5b133fe5302b8a048188ef6264757bc4a70c |
| Final guard | .9 / 2b9ff2e5615d55e2 | e12a5a588389b87d6e7849699c2cf260590379593436db2c34fe3c1d3b308914 | d8ad6b1a4dfc4f6aa8ff869b2cf9ed9715a896a822bff03c54daad4776630dd2 |

Driver bytes are separate provenance because this QA script is outside the runtime-source hash:

| Driver | Use | SHA-256 |
|---|---|---|
| Resource wall-clock | Original intermediate fast/control series only | 2b85dfd55ba727ad9089b42eafaab7b4c35e09b86e62569ac162ae4318e4e5fa |
| Functional bounds | Earlier intermediate functional check | ade96f4005639c1ea109faf4ccf055b29fa97148c7864965d6838247e2c63425 |
| Fixed timestamp | Final headline and matched controls; final pre-glyph functional | 07b278ccf059e1786536dc07d3c97240bcd78b1d0604a69fcf33793e5377539a |
| Glyph functional | Final cold pixel proof only, never benchmarked | 0f33d76ff9c32f5579ef6a9c45065effe7f977f122cc471f48d06f2e97a80143 |
| Standalone text | Geometry/selection/link QA | bfdee82e70a3031047b3ad761287e342a1b8c35a193b72863be64bacb57b6698 |

The exact intermediate cache patch SHA is `f7d901194262e1ccd7b911f43c94941e92a3d8f8c16244d376e50cb1117b6d94`;
it is archived separately from the final patch. Native manifests and patch pins are under
`native/`. Raw JSON, drivers, diagnostics and patches are gzip-compressed without changing their
uncompressed bytes; [raw-index.json](raw-index.json) records original paths, stage, sizes and both
uncompressed/stored SHA-256. Native binaries and raw perf data are deliberately not committed.

Load reproduction uses the ordinary commands:

```sh
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```

For pointer reproduction, decompress the selected archived driver into the QA script path only
in a frozen measurement checkout. Use the archived `run-dense.ts` orchestrator with three
repetitions, `cross-rows`, sweep `0.25`; it invokes `qa:gui` with production mode, Weston,
1280×1500 private display, a fresh profile and five-second warmup/20-second measurement. Preserve
source/native/driver hashes before and after each run. Run builds, tests, profilers and other
application measurements serially, outside resource sampling. Ordinary `bench:chat` remains
unchanged. See [benchmark methodology](../README.md).
