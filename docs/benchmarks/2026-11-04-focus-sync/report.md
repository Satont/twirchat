# Root focus metadata synchronization

Fresh production hover measurements fell from **27.8306% to 25.9049% of one logical core (−6.919%)**. RSS medians/peaks changed +0.15%/+0.38%; approximately 60 presents/s and 120 offered pointer calls/s were preserved. The desired ≤2% CPU goal remains unmet. Fresh `.9`→`.10` samples are separate from earlier phases.

## Change and measurement

The root owns two scalar revision fields and skips focus-handle/listener reconciliation when focus metadata is stable. Focusable creation/removal, tabIndex, listeners and autoFocus invalidate it. Non-focusable/plain-text/color/structure changes do not: root handles do not depend on ancestry. Visibility/tab ordering and pending focus settlement remain dynamic. [Exact patch](native/focus-sync.patch.gz).

Resource runs used private hardware Weston GL, Bun 1.4.4 and verified same-mode React/JSX/reconciler. Motion: three fresh processes/version,23 channels × 200 retained messages,770×1300, 12 animated sources plus avatars/badges/replies/wrapping; 5s warmup, 20s measurement,0.25s sweep. Driver/config/window/retention/path matched strictly: x550, y114→1186, 13 visible rows. No feature disabling, retention/FPS reduction, forced GC, allocator trimming or timing-entry clearing. Builds/tests/apps/profilers were excluded from resource sampling.

| Motion metric: median (min–max) | Baseline .9, n=3 | Final .10, n=3 |
|---|---:|---:|
| CPU % | 27.83 (27.27–28.16) | 25.90 (25.62–26.04) |
| RSS median MiB | 368.9 (367.3–369.2) | 369.4 (368.4–370.2) |
| RSS peak MiB | 382.8 (375.3–383.9) | 384.3 (382.1–385.8) |
| Heap peak MiB | 103.5 (101.6–103.5) | 101.6 (101.6–103.2) |
| Lag p95 ms | 0.057 (0.057–0.057) | 0.057 (0.057–0.058) |
| Full draws | 950 (931–958) | 946 (936–947) |
| Presents/s | 60.00 (59.95–60.00) | 60.00 (60.00–60.05) |

Both versions dispatched 2399/2400 calls, 961 mutation batches and 13,441 operations/run. Full-draw medians changed 950→946 (−0.42%). Fresh controls were 2.344→2.293% CPU without motion and 2.737→2.759% within one row; each had one full draw. These controls are single samples, not repeated estimates.

## Load gate and preserved RSS investigation

The complete 15-case development matrix used fresh processes, 3s warmup/12s measurement, 1200×800 and 200 retained/channel. Production target runs were separate: 50 channels, four panes, 5000 total offered messages/s, 3s warmup/30s measurement, 200 retained/channel. [Baseline matrix](raw/baseline-matrix.json.gz),[final matrix](raw/final-matrix.json.gz); case metrics remain in [summary](summary.json).

| Production target: median (min–max) | Baseline .9, n=3 | Final .10, n=3 |
|---|---:|---:|
| CPU % | 80.50 (80.45–81.33) | 81.52 (81.48–82.27) |
| RSS median MiB | 493.7 (492.8–493.9) | 493.4 (487.3–497.4) |
| RSS peak MiB | 599.1 (596.3–602.1) | 597.6 (585.4–634.4) |
| Heap peak MiB | 218.7 (207.5–220.1) | 226.0 (219.4–231.5) |
| Processed msg/s | 4996.67 (4995.35–4996.98) | 4995.35 (4994.75–4997.08) |
| Lag p95 ms | 1.450 (1.056–1.599) | 1.339 (1.336–1.498) |
| Lag max ms | 8.68 (8.27–10.55) | 10.01 (8.14–11.06) |

Production CPU changed +1.26%, RSS median −0.08%, peak −0.25%, heap peak +3.33%. During measurement,99.895–99.940% of offered messages were processed (approximately 99.9%, all above the 99% gate); after the 2s drain each run exceeded 99.9%. All 10,000 retained messages remained. The coupled producer and shared host do not establish maximum sustainable external throughput.

Initial single matrix flags are preserved: c1-r1000-p1 RSS median +5.39%, peak +8.94%; c50-r1000-p1 CPU +16.83%. Three fresh 12s/3s development repeats/version were run for both. c50 CPU changed 31.59→29.91%(−5.32%), RSS median −2.03%, peak +2.04%, heap +0.19%; its CPU flag did not repeat. The first c1 cohort had peak-RSS median 568.29→625.13 MiB(**+10.00%**), despite CPU −4.81%, RSS median −0.51% and heap peak −1.76%.

One further experiment was registered before execution: exactly six fresh c1 runs in order **F1, B1, B2, F2, F3, B3**. Original 3v3 and balanced 3v3 are reported separately and pooled 6v6; the initial single matrix samples are never pooled. All spikes remain; run count/order was fixed before the results. [Preregistration](validation/balanced-preregistration.json.gz),[cohort/pooled analysis](balanced-analysis.json.gz).

| c1 cohort | CPU median B→F % | RSS median B→F MiB | RSS peak median B→F MiB | Peak change |
|---|---:|---:|---:|---:|
| original, n=3/version | 62.57→59.56 | 494.11→491.60 | 568.29→625.13 | 10.00% |
| balanced, n=3/version | 59.89→60.06 | 501.08→492.97 | 589.06→584.61 | -0.76% |
| pooled, n=6/version | 60.43→59.79 | 495.29→492.29 | 586.03→585.38 | -0.11% |

| All 12 c1 peak-RSS samples, MiB | Run1 | Run2 | Run3 |
|---|---:|---:|---:|
| original baseline | 583.41 | 568.21 | 568.29 |
| original final | 625.13 | 625.79 | 571.21 |
| balanced baseline | 589.06 | 588.65 | 594.08 |
| balanced final | 586.15 | 584.61 | 566.81 |

The increase did not repeat in the balanced cohort; balanced and pooled CPU/RSS medians have no >5% increase under the registered criterion. **The wider final tail remains:** pooled RSS peaks range 568.21–594.08 MiB baseline versus 566.81–625.79 MiB final; two of six final peaks are 625.13/625.79 MiB. This does not mean spikes disappeared or prove leak freedom. Pooled heap peak median changed −0.84%, lag p95+5.83%; full ranges remain in the summary/raw analysis.

In the original cohort, F1 had two sampled points above 600 MiB, 250 ms apart; F2 had one. All other original runs had none. Both dropped below 600 before measurement ended. Co-occurring heap troughs were similar (roughly 67–69 MiB), and recorded GPU residency categories were unchanged. Sample intervals do not prove continuous peak duration or a GC cause; there is no GC event telemetry. These load outputs contain no native frame/mutation counters, so none are inferred. [Sample-time evidence](validation/high-rss-observations.json.gz).

## Functional and source proof

- **355 native tests include 11 new revision tests**; canonical/private bytes match 36 native and 93 GPUI files. Clippy remains at the same 38 errors/13 warnings, not a clean pass. Project tests: 1206 passed (31 quality, 27 shared, 256 backend, 892 desktop), 15 existing PostgreSQL tests skipped; root fix/check/typecheck passed.
- Identical lifecycle probe `a026ae…d8c5fa` passed on both artifacts: actual native Tab/Shift-Tab, tabIndex 0→−1→0, existing-handle listener add/remove/exact events, pending focus and cancellation versus autoFocus. The raw-addon probe installs the existing GPUIX JS host default Tab routing; expectations were not weakened.
- Private software Xvfb checks passed deferred rows, hotkey capture, dense glyph/selection and actual native drags at 420/900px with live traffic and cancelled gestures. Their CPU is not mixed with hardware resource results. These are source fixtures, not a compiled AppImage or the user profile.

Baseline HEAD: `8a9665e04f8964a5dc3f46e65b1578233a8eb265`. Runtime source hashes: `.9` `d8ad6b1a4dfc4f6aa8ff869b2cf9ed9715a896a822bff03c54daad4776630dd2`; `.10` `7726a43b8af0351d1025e8b283f923a3250731e90ee8b8ae0e86f5c4c5fab7f5`.

Native SHA/digest: `.9` `e12a5a588389b87d6e7849699c2cf260590379593436db2c34fe3c1d3b308914` / `2b9ff2e5615d55e2`; `.10` `9167fe97d8be98517296d008f9c5bbaeb3f056e5e26159523db3e6147d47682f` / `80b5577cbe92ab0f`. Exact resource driver SHA `0f33d76ff9c32f5579ef6a9c45065effe7f977f122cc471f48d06f2e97a80143`; probe SHA `a026ae523d9093568a0f73a5e57ab0c82e8cc85ad221f9c630cf27fe08d8c5fa`.

[Raw index](raw-index.json) records stage, stored/uncompressed SHA-256 and sizes for unchanged gzip JSON, drivers, pins and validation evidence. No native binaries or perf raw are committed. Manifests record upstream/toolchain pins; repeated/balanced runners restore and verify `.10` in finally. Measurements were serialized; no GC forcing or allocator/feature tricks were used.

## Next read-only candidates

Fresh perf sampling was denied by kernel permissions. The [prior-phase profile](../2026-11-04-hover-cpu/report.md) is diagnostic context only; no current CPU share is assigned here.

1. `GpuixView.render` in upstream `packages/native/src/renderer.rs` calls `Window::set_window_title` every invocation. `zed/crates/gpui/src/window.rs` forwards without deduplication: X11 `gpui_linux/src/linux/x11/window.rs` updates two properties with `check_reply` then flushes; Wayland `gpui_linux/src/linux/wayland/window.rs` creates two strings and calls `set_title`; macOS/Windows window owners also make native calls. This is source-confirmed, unmeasured and unchanged by `.10`.
2. Inspect per-list focus indexes and `VirtualListEntry.child_revisions`: subtree revisions also change for colors, invalidating height metadata. A geometry-specific revision could avoid metadata/SumTree/overdraw remeasurement, but visible GPUI rows still call render_item/layout_as_root even when measured. It would not remove ordinary visible-row layout.
3. Visible-row layout and full scene/hitbox construction remain the larger known work. Preserve animation cadence, selection and input semantics; current CPU shares are unmeasured.
