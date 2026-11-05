# Replay cached chat rows during vertical scrolling

Initially, a compact chat list on Linux opted in to reusing the prior frame's inline message body.
The existing row cache keeps a body by identity and local revision across retained-tree changes
in other rows. On a hit, GPUI translates the previous scene commands and hitboxes by a whole
device-pixel displacement. GPUIX reapplies automation bounds and text selection geometry at
the new position. Controls layered over the body are laid out and painted in the current frame.

Reuse requires a current image lease, unchanged render context, and a complete footprint inside
the same clip at both positions. The path rebuilds clipped rows, rows under the pointer,
changed content, unsupported scene primitives and rows with deferred draws. Stable animation
slots are validated and advanced before replay, including full draws triggered by chat arrivals.
The cache is bounded by the existing per-window flow limit and last painted frame.
Pointer movement uses the legacy flow policy. Vertical reuse resumes on the second
stationary root draw, including during wheel scrolling with a stationary pointer.

## Four chats with media

The comparison reused the exact production [four-pane media driver](../2026-11-05-four-pane-live/report.md#run-the-media-fixture),
SHA-256 `e1cf589116dd2d6e24d0989853694c69d7ad9879a0e22fcef6d19a69dd1fbd4a`.
Three fresh processes per group ran on private hardware Weston with a 1280×1300 client,
3 s warmup and 18 s measurement. The workload offered 20 messages/s split 5/1/2/12 across
four compact chats, with 19 other histories and 200 retained messages per channel. It included
avatars, badges, Unicode emoji, animated and static emotes, replies and wrapping text.

Each run processed 359 of 359 offered messages, retained 4,600 messages, and confirmed
the latest message inside every viewport. No tracing was enabled in the measured processes.
A separate diagnostic on the first runtime build logged at least 2,816 nonzero row replays.

| Metric | .16 median [range] | .17 median [range] |
| --- | ---: | ---: |
| CPU % of one logical core | 67.77 [66.45–70.29] | 50.48 [50.29–51.46] |
| RSS median MiB | 554.06 [552.05–555.91] | 551.63 [494.31–552.82] |
| RSS peak MiB | 594.60 [593.91–595.51] | 592.97 [586.06–593.03] |
| JS heap peak MiB | 213.24 [212.58–213.35] | 212.55 [187.92–213.15] |
| Event-loop lag p95 ms | 0.057 [0.056–0.084] | 0.057 [0.056–0.399] |
| Event-loop lag max ms | 2.23 [2.15–2.56] | 2.34 [2.17–2.42] |
| Actual messages/s | 19.94 [19.94–19.94] | 19.94 [19.94–19.94] |

Median CPU fell by 25.5%. Full draws remained near 38/s and the tested emotes continued
uploading frames. Process RSS and JS heap varied between fresh processes.

## Native input and artwork

Private Xvfb QA verified actual replay for the tested inline body ID 10222. After eight
24 px wheel movements, it verified exact glyph pixels, movement in 784 pixels of the emote,
drag selection at the translated position and native click dispatch to the expected link.
The dense case also exercised 420×300 and 770×1300 client sizes. A separate four-pane
production probe scrolled one pane while three siblings received traffic, resized the window
and verified native composer input. All 31 interaction-phase messages were processed.

The native suite passed on the initial replay build. The desktop suite passed 892 tests,
with isolated chat, composer and deferred-row QA.

A separate production pointer diagnostic swept across a dense idle chat at about
120 native movements/s. Unrestricted replay raised median CPU from 19.58% to 23.73%.
With the stationary-pointer guard, the median was 18.89% [18.15–19.50] in three repeats,
with approximately 60 presentations/s and 1,393–1,436 animation uploads per sample.

## Text-only load gate

Three production repeats used 50 channels, four panes, 5,000 offered messages/s and
10,000 retained messages. The client was 1200×800 with 3 s warmup, 30 s measurement and
2 s drain. The prior .16 runs used the same driver and native identity as the media baseline.
Both groups reported production React and zero React User Timing measures.
The load gate and development matrix used the initial replay artifact. They had no
pointer input and began after warmup. The later pointer guard changes policy only after
pointer movement. The final artifact repeated the four-pane media and pointer measurements
and the focused input checks.

| Metric | .16 median [range] | .17 median [range] |
| --- | ---: | ---: |
| CPU % of one logical core | 88.49 [86.41–89.97] | 84.59 [81.39–85.16] |
| RSS median MiB | 497.80 [487.42–500.19] | 490.46 [483.70–491.89] |
| RSS peak MiB | 589.53 [587.68–597.63] | 576.23 [570.45–628.85] |
| JS heap peak MiB | 215.36 [208.94–218.96] | 230.11 [215.41–230.36] |
| Event-loop lag p95 ms | 2.164 [2.054–2.203] | 1.933 [1.923–2.067] |
| Event-loop lag max ms | 8.76 [5.31–11.83] | 9.28 [6.30–10.97] |
| Actual messages/s | 4994.48 [4993.98–4996.98] | 4995.98 [4994.69–4996.60] |

The highest .17 RSS peak occurred in one run. Median RSS across repeats fell. The coupled
generator verifies delivered work in this fixture.

## Provenance

The Git base is `b190ee533ab897cfd4fab5584053e280ad00d0b0`. Both native artifacts used Rust 1.97.1.

| Artifact | Patch digest | SHA-256 |
| --- | --- | --- |
| Baseline .16 | `ebbd1d16979c85d3` | `b135cf63238849a098281367651b00a5f552be78d511de2f2262e08d5c9e54eb` |
| Replay .17 before pointer guard | `967933a5db1e2d4b` | `d720a5e65403ffc1014493be8b0ee0bd20efa340b553825aa19c04b9d7863e98` |
| Final replay .17 | `29e1f83e43e1524b` | `f991c65dfbda7454281fef06f4d4fb8c51f491b92001195e6ea398e2e250668b` |

[Run data](summary.json) includes source hashes, native identities, individual results
and input evidence. These runs exercised the source application in the isolated launcher.

## Development matrix and RSS repeat

The 15-case default development matrix completed. In its two 5,000 messages/s four-pane
cases, RSS medians fell while initial peaks rose. Matched repeats used the same 12 s
measurement, 3 s warmup and 2 s drain.

| Channels | .16 initial / repeat RSS peak MiB | .17 initial / repeat RSS peak MiB | Repeat RSS median MiB, .16 → .17 |
| --- | ---: | ---: | ---: |
| 50 | 1026.5 / 1039.8 | 1084.7 / 1055.6 | 865.9 → 854.5 |
| 100 | 1018.7 / 974.4 | 1083.8 / 1049.3 | 834.8 → 824.3 |

The 100-channel development peak was 6.4–7.7% higher across the two comparisons.
Peak JS heap and React User Timing counts fell in that repeat, while the process RSS peak
occurred earlier in the sample. The allocation behind that transient peak remains unclassified. Production medians and the 50-channel production peaks are reported
separately above.

## Integration with current main

The replay patches were rebased onto `6fb1d43`, which includes the native clipboard image
patches. The combined .17 addon has patch digest `89020f82d558b2bd`
and SHA-256 `2a6558f27cb81dc1127711da313d53a1f6771a7f58a4b304b31e98c03fc452e1`.

The native suite and 941 desktop tests passed, along with the workspace check, isolated
X11 composer QA with real clipboard images and file lists, and shifted-row QA with verified
replay for the tested body. A separate smoke comparison used the rebased TypeScript source
with the main .16 addon and the combined .17 addon. It processed 359 of 359 messages in each
run and painted the latest message in all four panes.

| Metric | Main addon .16 | Combined addon .17 |
| --- | ---: | ---: |
| CPU % of one logical core | 70.90 | 51.54 |
| RSS median MiB | 554.68 | 555.49 |
| Actual messages/s | 19.94 | 19.94 |

The single-run smoke results are recorded separately from the three-repeat comparison.

## Replay in both chat themes

The `.18` runtime enables replay for Compact and Modern on the desktop targets. Modern's
message column takes the remaining width after its fixed-size avatar and platform icon.
The native cache checks that the column and its ancestors preserve that width and falls
back to fresh layout when they do not. macOS applies retained-tree invalidation through its
own event loop, with the same distinction between retained changes and explicit full refreshes
as the threaded renderer on Linux and Windows.

The Linux production rerun used the same four-pane media case and 18 s measurement
with three fresh processes per theme and build. The Modern fixture rotates the seed art
so each of its shorter visible histories starts with both static and animated emotes.
The generated traffic and retained history lengths are the same in both revisions.
Every run painted all four latest messages and delivered 359 of 359 messages.

| Metric | Modern .17 median [range] | Modern .18 median [range] | Compact .17 median [range] | Compact .18 median [range] |
| --- | ---: | ---: | ---: | ---: |
| CPU % of one logical core | 56.81 [54.44–58.10] | 45.56 [45.48–46.34] | 54.54 [51.29–60.63] | 53.96 [51.09–56.65] |
| RSS median MiB | 532.50 [481.17–534.37] | 530.34 [529.87–534.78] | 555.32 [552.46–555.66] | 552.34 [499.52–552.68] |
| RSS peak MiB | 577.39 [569.12–577.73] | 574.96 [574.70–576.51] | 598.16 [597.84–598.34] | 594.52 [588.71–596.76] |
| JS heap peak MiB | 212.83 [184.31–212.98] | 213.02 [212.99–213.11] | 213.96 [213.95–214.17] | 213.48 [185.78–214.24] |
| Event-loop lag p95 ms | 0.224 [0.057–0.514] | 0.160 [0.091–0.276] | 0.099 [0.076–0.288] | 0.195 [0.098–0.260] |
| Actual messages/s | 19.94 [19.94–19.94] | 19.94 [19.94–19.94] | 19.94 [19.94–19.94] | 19.94 [19.94–19.94] |

Private Xvfb QA moved the same painted text body through eight 24 px steps per theme.
The trace confirmed three nonzero replays of that body in Modern and four in Compact.
Both kept exact glyph pixels, selected the same text, opened the expected link and
showed motion in 784 emote pixels. The dense case also checked pointer and keyboard
input after resizing to 420×300 and back to 770×1300. The native tests, 941 desktop tests
and workspace checks passed. The GUI measurements were on Linux.

Both groups were run from `5c36e221bc0645d99e063213f6a7a951f5a9bfbd` with the indicated
working-tree changes. The unprofiled fixture's workload and capture intervals match.
The candidate driver adds an optional sampler, which was off in every resource run.

| Identity | .17 baseline | .18 candidate |
| --- | --- | --- |
| Runtime inputs SHA-256 | `81d94e02cd9f807d07406175f9b57ad2a90e0dd205dce0f6907224c1ebd0a265` | `a21594bbf445217b3736d8a9bbe801d77a019de7eb9170aabcbffb9ebe59defb` |
| Native patch digest | `89020f82d558b2bd` | `4d8cd5e9a0fad627` |
| Native addon SHA-256 | `2a6558f27cb81dc1127711da313d53a1f6771a7f58a4b304b31e98c03fc452e1` | `30ef544cb3ceb65011ad351c14a00cac6a27e0ee18a20f3885cb60d42ed19e94` |
| Media driver SHA-256 | `d1356ef94d1cb132a714a653ce0fc3e95f790c675fbb48ebf9008cc9d4685dc0` | `f0a0b80058ef77d2d55ddb19c43d7d235c4244c0ae33cd2b6d1b3e5708f84755` |

### CPU sampling

Run on Linux with a built native addon, the hardware Weston QA environment,
`libprofiler.so.0` from gperftools, and the standalone [pprof](https://github.com/google/pprof)
command on PATH.

```bash
bun run --cwd packages/desktop profile:chat modern
bun run --cwd packages/desktop profile:chat compact
```

The command opens four chats in isolated QA and samples CPU for the 18 s traffic window.
It prints self and cumulative rankings and saves them alongside the symbolized
`chat.pb.gz` profile in the printed directory. The symbolized file can also be opened
with `pprof -symbolize=none -http=localhost:8080 /path/to/chat.pb.gz`.

One profiled Modern run per build and one candidate Compact run attributed the following
inclusive share of CPU samples to each stack. Rows overlap. These are separate diagnostics
from the resource measurements.

| Stack contains | Modern .17 (940 samples) | Modern .18 (841 samples) | Compact .18 (960 samples) |
| --- | ---: | ---: | ---: |
| GPUI `Window::draw` | 82.3% | 78.7% | 82.4% |
| Virtual-list prepaint | 43.6% | 33.5% | 38.0% |
| Taffy layout | 36.6% | 26.0% | 23.6% |
| GPUIX retained element construction | 11.1% | 11.9% | 14.1% |
| libvips | 2.7% | 2.5% | 2.2% |

Taffy accounted for 3.44 s of sampled CPU time before the change and 2.19 s after it.
Layout remains a large share of sampled render work.

### Production load gate

The text-only stress test used four Compact panes, 50 histories and 5,000 offered messages/s
with the same 1200×800 window and 3 s warmup, 30 s measurement and 2 s drain as the earlier
gate. Three candidate runs used fresh isolated processes. Each delivered at least 99.8% of
the offered load.

| Metric | Matched .17 repeat | .18 median [range] |
| --- | ---: | ---: |
| CPU % of one logical core | 80.65 | 81.39 [80.69–82.33] |
| RSS median MiB | 497.54 | 494.35 [491.15–497.47] |
| RSS peak MiB | 618.30 | 601.88 [596.91–606.90] |
| JS heap peak MiB | 217.64 | 223.93 [219.53–239.07] |
| Event-loop lag p95 ms | 1.884 | 1.983 [1.964–2.066] |
| Actual messages/s | 4994.31 | 4996.45 [4996.01–4996.54] |

### Development controls

All 15 development scenarios completed. The four-pane runs delivered 997.49, 4,988.35
and 4,987.36 messages/s at their respective 1,000, 5,000 and 5,000 messages/s targets.
The 50- and 100-channel four-pane peaks at 5,000 messages/s were 1,049.7 and 1,134.8 MiB.
Those are −3.2% and +4.7% against the archived .17 development matrix.

Fresh matched controls repeated the one-pane cases with larger differences against the
archive. For example, the 1-channel, 1,000 messages/s peak was 677.8 MiB on the fresh .17
run and 588.8 MiB on .18, compared with 574.6 MiB in the archived .17 run.
The 50-channel, 1,000 messages/s, one-pane case showed a repeatable development CPU
cost. The repeat reversed the run order. Production improved in its own matched pair.

| 50 channels, 1,000 messages/s, one pane | .17 CPU % of one core | .18 CPU % of one core | .17 / .18 peak RSS MiB |
| --- | ---: | ---: | ---: |
| Development matched pair | 23.59 | 25.85 | 473.4 / 482.9 |
| Development reversed pair | 24.63 | 26.13 | 472.2 / 474.2 |
| Production matched pair | 19.77 | 18.14 | 337.9 / 336.9 |

The pairs delivered 997.16–998.30 messages/s. The development CPU increase was
1.50–2.26 percentage points of one core. The isolated cause of that development
difference is still open. The matched .17 repeats use the same runtime inputs as the
original .17 measurements plus the profiling command entry in the package scripts
(`146cd5e9b58692824ebb27294599c5cfb687ed87bce6722c0c44b51b75987169`).
