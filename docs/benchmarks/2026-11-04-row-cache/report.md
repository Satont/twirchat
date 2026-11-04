# Cached wrapping chat flow: measured evidence

**Measured result:** hover CPU fell 34.31% with the same pointer rate, retained chat, animation and approximately 60 presentations/s. Fresh production target CPU was 80.24% versus 81.10%; balanced and pooled CPU/RSS medians have no >5% increase. Original repeated peak RSS +5.947% did not repeat in the preregistered balanced cohort; pooled medians have no >5% CPU/RSS increase. Final .15 passes 373 native unit tests and five focused native GUI probes; all resource measurements remain explicitly attached to .14.

The native change reuses unchanged compact wrapping bodies and separates their absolute toolbars for independent painting. ChatMessage.tsx is unchanged. Cache eligibility uses the actual row callback’s available layout space and keeps the original body/control ID scope. Cached root layout uses the exact measured width; overflowing long words retain their original widths.

## Fresh production target

Three fresh processes per version, Bun 1.4.4 / production React, JSX and reconciler modes verified; hardware isolated Weston, 1200×800, 50 channels, four panes, 5000 total messages/s, 200 retained/channel, 3s warmup / 30s measurement + 2s drain. Every target run processed more than 99.9% of the offered rate and retained 10,000 messages. The coupled generator is not maximum external-throughput proof.

| Metric | Baseline median [range] | Measured .14 median [range] | Δmedian |
|---|---:|---:|---:|
| CPU % | 81.102 [80.906–81.810] | 80.243 [79.651–80.528] | -1.06% |
| RSS median MiB | 489.215 [487.121–492.980] | 492.441 [491.227–501.746] | 0.66% |
| RSS peak MiB | 621.773 [586.480–641.305] | 592.820 [592.711–599.457] | -4.66% |
| JS heap peak MiB | 217.710 [217.028–246.572] | 226.727 [225.159–233.714] | 4.14% |
| Lag p95 ms | 1.287 [1.122–1.291] | 1.259 [1.118–1.288] | -2.19% |
| Lag max ms | 10.199 [8.488–10.218] | 8.622 [7.432–9.296] | -15.46% |
| Processed msg/s | 4996.448 [4995.148–4996.713] | 4996.611 [4995.348–4996.704] | 0.00% |
| Offered-rate fraction | 0.999 [0.999–0.999] | 0.999 [0.999–0.999] | 0.00% |

Fresh .10 production target runs were repeated because reused historical production baselines alone could not settle shared-host variation. Rejected .13 production CPU was 87.861 [87.055–88.522] versus fresh .10 81.102 [80.906–81.810]; +8.33%. That candidate was not accepted. Native toolbar separation restores the original Full-draw tree path while enabling the quiet body cache; the .14 measurements above assess the replacement. This is not an isolated causal estimate for a single line of code.

## Hover motion

Three fresh 20s runs, 5s warmup; matching 23 channels × 200 retained = 4600, 770×1300 window, 12 animated sources plus avatars/badges/replies/wrapping; 120 native pointer calls/s across 13 rows with a 0.25s sweep. Config, driver, window, retained count and full pointer paths match exactly.

| Metric | Baseline median [range] | Measured .14 median [range] | Δmedian |
|---|---:|---:|---:|
| CPU % | 28.632 [27.570–28.735] | 18.809 [18.720–18.853] | -34.31% |
| RSS median MiB | 368.453 [368.129–369.203] | 366.559 [365.844–366.566] | -0.51% |
| RSS peak MiB | 384.047 [383.680–384.258] | 381.969 [374.816–382.023] | -0.54% |
| JS heap peak MiB | 103.213 [101.693–103.412] | 101.580 [101.529–103.246] | -1.58% |
| Lag p95 ms | 0.057 [0.057–0.057] | 0.058 [0.058–0.058] | 1.40% |
| Full draws | 938.000 [929.000–939.000] | 938.000 [936.000–945.000] | 0.00% |
| Presents/s | 60.000 [60.000–60.000] | 60.000 [60.000–60.000] | -0.00% |
| Pointer calls | 2399.000 [2399.000–2399.000] | 2399.000 [2399.000–2399.000] | 0.00% |
| Pointer calls/s | 119.950 [119.949–119.950] | 119.950 [119.950–119.950] | -0.00% |
| Mutation batches | 961.000 [961.000–961.000] | 961.000 [961.000–961.000] | 0.00% |
| Mutation operations | 13441.000 [13441.000–13441.000] | 13441.000 [13441.000–13441.000] | 0.00% |

The ≤2% CPU goal remains unmet. Presentations remain approximately 60/s; no refresh-rate reduction or message/retention reduction is used. Full draws and pointer calls are distinct counters.

Measured .14 absolute controls (n1, no fresh paired baseline): none CPU 2.290%, Full draws 1, presents/s 58.900; same-row CPU 2.710%, Full draws 1, presents/s 58.900. No comparative claim is made from these controls.

## Initial matrix flags and completed follow-up

The complete 15-case development matrix uses 12s measurement / 3s warmup, 1200×800 and 200 retained/channel. Reused source 7726 .10 raw is preserved byte-for-byte. Five initial single-case >5% CPU/RSS flags: c1-r0-p1 (CPU %); c10-r0-p1 (CPU %); c10-r100-p1 (CPU %); c10-r1000-p1 (RSS peak MiB); c10-r5000-p1 (CPU %). Fresh paired 3v3 repeats are complete: the CPU flags did not repeat. The c10-r1000-p1 peak RSS flag required the fixed follow-up below. Initial matrix spikes remain archived and are not pooled with repeat cohorts. Heap and lag ranges remain visible.

## Correctness evidence

Critical overlay fixture f5e4094d: .14 entire 420/770 stage objects match the .10 Direct oracle, including both minWidth variants, overflowing host/raw words, flow roots 102/122, toolbar geometry, exact glyph RGBA and native held Copy / cancel / retry. The rejected .13 shifted Copy x352→452 after cache warm; that failure remains preserved. The fixed native root constraint keeps measured flow width while retaining 496px long-word descendants.

Frozen 760320 dense fixture: actual ChatView 82/947 semantic elements and 2/14 rows at 420/770 retain all geometry/text/glyph/selection. All 87 image file-byte checks match. Literal cache path strings differ in 14 avatar occurrences due session-derived cache metadata; the original strict failure and per-file SHA proof remain separate. Frozen bc22055 pureflow entire stage objects match .10. Private Xvfb GUI verifies pixels/input only; its CPU/RSS is excluded. Final .15 strict overlay, lifecycle, hotkey, drag and deferred-row GUI all pass; command and before/after identity proof is archived. Dense/pureflow .14 evidence is reused for this test-only change.

## Provenance and limits

Full identities are preserved in the summary and native archive. Baseline .10: source `7726a43b…`, native `9167fe97…`, digest `80b5577cbe92ab0f`. Measured .14: source `3918efb3…`, native `f50c0f26…`, digest `9cc345a6d4236c7e`. Delivered .15: source `95b51427…`, native `c29461a2…`, digest `279b40c830eed623`.

No AppImage/personal-profile claim, no forced GC/allocator trimming, no leak-freedom claim. One process-wide gperftools load profile on rejected .13 is diagnostic only: actual 100Hz, thread CPU and sampler bias retained, not acceptance CPU shares or measured .14 profiling. Visible row layout, scene replay/hitbox work and unnecessary title publication remain concrete follow-ups, with their effect unmeasured here.

Setup evidence: the first repeat launcher exceeded the 108-byte Weston socket path limit before app launch. Its partial output is preserved separately and excluded from the paired cohort. The complete cohort restarts under short `r14r/{f|b}{rep}-{case}` paths.

## Peak RSS follow-up: all cohorts retained

The original c10-r1000-p1 3v3 peak flag remains part of the evidence. The follow-up order F1, B1, B2, F2, F3, B3 was registered before execution; exactly six additional development 12s/3s runs were made. The initial single matrix is excluded from pooling. No runs or outliers from the complete registered cohorts were discarded.

| Cohort | CPU Δ | RSS median Δ | RSS peak baseline→final, MiB | Peak Δ | Heap peak Δ | Lag p95 baseline→final, ms |
|---|---:|---:|---:|---:|---:|---:|
| original n3/version | -0.634% | +1.874% | 553.348→586.254 | +5.947% | +3.001% | 0.783→0.774 |
| balanced n3/version | -2.609% | -2.358% | 568.578→558.523 | -1.768% | +2.781% | 0.558→0.732 |
| pooled n6/version | -0.261% | -0.536% | 565.107→572.389 | +1.288% | +2.840% | 0.705→0.753 |

Balanced and pooled medians have no >5% CPU/RSS increase. This does not eliminate the wider final tail: pooled baseline peak range is 552.871–594.035 MiB, final 548.047–609.586 MiB. Pooled lag p95 is +6.758% (0.705→0.753ms); balanced +31.281% (0.558→0.732ms), with all ranges retained in the summary/raw analysis. No GC cause or leak-freedom claim follows.

All 12 peak RSS values (MiB), in repetition order:

| Cohort | Baseline | Measured .14 |
|---|---|---|
| original | 594.035, 553.348, 552.871 | 609.586, 556.941, 586.254 |
| balanced | 568.578, 593.258, 561.637 | 548.047, 558.523, 590.617 |

Only original final repetition 1 had a sampled RSS point above 600 MiB: 609.586 MiB at 7.506s, paired heap 169.386 MiB; the next sample at 7.757s was 542.688 MiB, and the last sample 491.824 MiB. A sampled point/span is not a residence-duration measurement. Heap dropped by 94.548 MiB between those samples, but GC telemetry is absent; native frame/mutation counters are also absent from these load-repeat files. The complete per-run sampled trough/end/peak/GPU observations remain archived.

## Final artifact reuse boundary

Measured .14 passed 372/373 native tests; one new test inspected a tree before committing its fixture mutations. The failed run remains archived. Delivered .15 adds `tree.take_invalidation()` to that test setup and passes all 373 native tests; no assertion was weakened. Exact comparison of 37 native and 93 GPUI source files proves production sources unchanged. Resource CPU/RSS/throughput evidence remains attached to measured .14; the distinct .15 build identity and focused GUI are recorded separately.

Final .15 official prepare/check/build, root check and 1206 project tests pass; 15 existing Postgres tests skip. The 58 GPUI tests are reused with the same 93 source files. Clippy .14 diagnostics match the baseline's 38 errors and 13 native warnings; this is not a clean Clippy pass. All five final GUI probes pass: strict overlay, lifecycle, hotkeys, drags and deferred rows. The entire overlay stage objects match the .10 Direct oracle. Dense/pureflow .14 proofs are reused for this one-line test-only change.

The [summary](summary.json), [raw index](raw-index.json), [reuse source proof](validation/final15-resource14-reuse-scope.json.gz) and [final GUI proof](validation/final15-functional-proof.json.gz) preserve the measured .14 / delivered .15 boundary.
