# Animated emote playback, synchronization and frame deadlines

Visible GIF/WebP emotes now continue playing after focus loss. Identical images use a shared
process-wide timeline, so copies mounted or decoded later select the same frame. A window owns
one cancelable timer for its earliest encoded image-frame boundary, rather than redrawing every
native refresh. Reduced motion and explicitly hidden windows pause animation; revealing an
unfocused window resumes without chat traffic or a focus event.

[Upstream GPUIX issue #67](https://github.com/remorses/gpuix/issues/67) remains open. The pinned
GPUI gates both frame advancement and scheduling on focus. The local patches opt GPUIX images
into inactive playback, synchronization and deadline scheduling. Current GPUIX traverses an
uncached native tree; the synchronized GPUI builder documents that requirement.

## Native pixel and lifecycle checks

[Baseline JSON](qa/baseline-result.json) reproduced paused inactive images and disagreement in
all 21 simultaneous samples of delayed identical copies. [Final JSON](qa/deadline-result.json)
passed at 900 and 420 px, including GIF, WebP and transformed cached WebP, repeated focus changes,
hide/reveal without focus, image removal/remount and pending-timer close. Every same-window
comparison had zero mismatches, with no React renders or native mutation batches during sampling.

Independent windows retain the native inactive paint throttle. X11 can take three 16,666 µs
refresh ticks to pass its 33,333 µs cutoff. Transition timing therefore tests bounded presentation
skew, rather than demanding simultaneous presentation. Final maximum observed skew was 44.95 ms;
there was no accumulating phase offset. The test permits 75 ms including sampling jitter and
requires matching transitions in both directions.

After removing all images, both windows recorded zero new native draws over 500 ms. Closing
with a pending five-second frame finished in 1.32 ms with no React errors. All captures used the
private qa:gui display: [baseline](qa/baseline-focused.png),
[inactive baseline](qa/baseline-inactive.png), [inactive fixed](qa/deadline-inactive.png).
[Fixture provenance](qa/provenance.json).

## Chat throughput and resource gate

The target remains 50 channels, four panes, 5000 total messages/s and 200 retained messages per
channel, 1200×800, private headless Weston GL. Each production run has a fresh process/profile,
three-second warmup, 30-second measurement and two-second drain. React/JSX/reconciler production
mode was verified. CPU 100% denotes one logical core; memory is MiB.

Three final repetitions achieved 4994.4–4995.3 messages/s, preserving over 99% of the offered
rate. Median CPU was 113.3% (112.7–115.0), RSS median 510.7 MiB
(501.8–511.8) and RSS peak median 615.6 MiB (597.3–620.2). Against the three
pre-fix native baselines, median CPU changed 114.5% → 113.3%
(-1.1%), RSS median 505.6 → 510.7 MiB
(1.0%) and RSS peak median 606.0 → 615.6 MiB
(1.6%). No repeated CPU/RSS regression above 5% was observed.
These shared-host measurements are not a causal speedup claim or maximum external throughput proof.

| Run | Actual msg/s | CPU % | RSS median | RSS peak | JS heap peak | Lag p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| [baseline-1](baseline-1/results.json) | 4996.6 | 115.2 | 505.6 | 647.6 | 228.6 | 2.99 |
| [baseline-2](baseline-2/results.json) | 4993.9 | 112.7 | 501.1 | 572.9 | 227.7 | 2.54 |
| [baseline-3](baseline-3/results.json) | 4994.4 | 114.5 | 506.9 | 606.0 | 229.8 | 2.94 |
| [production-1](production-1/results.json) | 4994.8 | 112.7 | 510.7 | 615.6 | 223.3 | 2.65 |
| [production-2](production-2/results.json) | 4995.3 | 113.3 | 511.8 | 620.2 | 226.4 | 2.58 |
| [production-3](production-3/results.json) | 4994.4 | 115.0 | 501.8 | 597.3 | 224.6 | 2.86 |

The [complete 15-case development matrix](development/report.md) passed on the shared-clock
artifact, followed by three [production repetitions](clock-production-1/report.md)
([second](clock-production-2/report.md), [third](clock-production-3/report.md)). This complete matrix
is retained for the narrow deadline follow-up under the project reuse rule; the final image-specific
change also received the focused native checks and three final production repetitions above.
Development and production are separate; no development/production comparison is used as an
algorithmic improvement. The generator is coupled to ingestion and does not establish maximum
sustainable external throughput.

One pre-fix attempt lost its private Wayland compositor after about 13 seconds. Its incomplete
measurement is excluded; [the log is preserved](excluded-baseline-attempt.log). Baseline 3 is the
successful fresh retry. An initial launch with an overlong Unix socket path collected no samples;
subsequent runs use short /tmp output paths.

## Animated-image resource sample

The same synthetic fixture holds six 48×48 animated images in the main window and one identical
GIF in another window, three colored frames with 100 ms delays. Three three-second resource
samples per state run after pixel checks, without captures or fresh native queries during CPU/RSS
measurement. The secondary window remains active while the main window is inactive/hidden.
This is illustrative animation work, separate from the chat throughput target.

| Main state | Shared clock CPU %, median (range) | Deadline CPU %, median (range) | Final RSS median MiB |
|---|---:|---:|---:|
| focused | 18.18 (18.1–18.3) | 5.23 (5.1–5.3) | 337.8 |
| inactive | 14.60 (14.5–14.7) | 5.11 (5.0–5.6) | 337.8 |
| hidden | 9.88 (9.6–10.9) | 2.42 (2.3–2.7) | 337.3 |

Shared-clock [raw evidence](qa/clock-result.json) and final [raw evidence](qa/deadline-result.json)
include heap, lag and individual RSS peaks. The deadline sample preserves every visible frame;
it adds no message dropping, forced GC, allocator trimming, retention reduction or refresh-rate
experiment. The change also includes the later main merge, so this is not an isolated CPU attribution.

## Source and native provenance

- Initial gate parent: 82552a53694517829df7500d6c4b96e44f87dd27 plus the animation diff.
  Baseline runtime-input SHA-256 b773e50c30817e89341a981ee7fbf3c34b96e46e4be3c4fd2af0bb36c9de4085;
  shared-clock runtime-input SHA-256 14efe81c1e0a2243077f924b54af6487f7b4e2c311b01c1992f76d50f8ae06e4
  (356 files). Actual dirty hashes and native bytes are preserved in each raw run.
- Final parent: 61721d24a2a476346afbc646de371563aa0aa023 plus this diff; runtime-input SHA-256
  b19b849d68a57a08cb8f7a396343e8557005a973ec59b11087db502b6db27540 (365 files). The rebase retains the
  independently merged tray, badges and user-card work. Sources/native bytes stayed frozen
  within each measurement batch; hashes were checked before and after every case.
- [Baseline native](native-baseline.json): 0.11.0-twirchat.3, digest ad7fc24cef2eaf2f,
  SHA-256 cd10c5ab9042a0ef0c485c3b320f7862128b78e6809fba8aa4181ad1a379d248.
- [Shared-clock native](native-clock.json): 0.11.0-twirchat.4, digest 630fc2f223ba5e4a,
  SHA-256 59103c5ea08259a920d336bf8790743becd93860759f519d1ae327463b169b0d.
- [Final native](native-final.json): 0.11.0-twirchat.5, API 3, digest fd5041e808e7ccca,
  SHA-256 0425e9a85b1702023e79a13a047b44e6ff5474f1f7c51c36f1c0a5eec227f89b.
  GPUIX 2e31b47ff6432ceebe70e7fc7b0f51a76d7d30cf;
  GPUI f77e5cfe9dad04288566f00c66ecf3c58d6f84b3; Rust 1.97.1.
- Bun 1.4.4; Ryzen 7 9800X3D; RX 7800 XT; Linux 7.3.1-1-cachyos.
  No tests, builds, profilers or other test application instances ran alongside resource sampling.
  The final batch held /tmp/twirchat-resource-measurements.lock for coordination.

## Validation and reproduction

Workspace bun run fix, bun run check and bun run test passed; existing lint warnings remain,
with no errors. The locked native release build and 12 tests of the actual production timeline
module passed. Native pixel/lifecycle QA passed on the isolated display. No host window,
compositor settings, live account or backend was modified for QA.

Run the fixture through packages/desktop qa:gui with --node-env production --dbus --timeout 120,
then bun scripts/qa-background-images.tsx --measure after the command separator. Run the full
bench:chat matrix with its defaults, and repeat c50-r5000-p4 in production for 30 seconds at least
three times with fresh short output directories. Build the native runtime before GUI runs.
