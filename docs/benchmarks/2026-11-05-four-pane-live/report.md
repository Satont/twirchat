# Four live chat panes with media

On 2026-11-05, TwirChat AppImage 1.3.1 used 77–111% of one logical core across eight 2 s
samples after opening the four Twitch panes. The `gpuix-ui` thread used 70–94.5% of a core
and process RSS was 835.6–869.1 MiB. The loaded AppImage had production React/JSX and native
0.11.0-twirchat.15, SHA-256 `3bbf3182fa916c69d1a090cc1b52c1420aac3dcee28910ac369f3be124264b9e`.

The running AppImage was also checked directly for hardware rendering. Its process had
`libvulkan_radeon.so` loaded, and its AMD DRM client on PCI `0000:03:00.0` recorded 21.47 ms of
graphics-engine work over a 3 s interval. That establishes GPU use in the installed application.

The original media fixture assigned the same timestamp to all messages. Sorting by timestamp and
then by string ID could put newer arrivals before the retained tail. This left some viewports
stationary even as their receive counters advanced. The [corrected live comparison](#corrected-live-comparison)
supersedes the original media comparison for active scrolling.

A separate gperftools diagnostic sampled the source application with that same native addon.
It used four compact panes, animated emotes, 20 messages/s and a pointer sweep in isolated hardware
Weston. Of 827 samples, 84.5% had `Window::draw` in the stack, including native row layout and
paint bookkeeping. The repeated scan of focus handles in `build_virtual_list` alone accounted
for 5.1% of leaf samples. The profiler run and the initial one-off AppImage-addon fixture runs
are separate from the resource comparison below.

In windows with multiple virtual lists, the native change keeps focusable descendant identities
by retained row revision. Synchronized
frames use the rows belonging to each list. Focus metadata refreshes when an affected row changes
and retires when a row leaves the list. Deferred builds can see a newer tree than the focus
handles, so they use the original handle lookup for that frame.

## Historical four-pane resource comparison

The live fixture runs the real compact ChatView in four quadrants in a 1280×1300 private hardware
Weston window with production Bun 1.4.4, React, JSX and reconciler. It retains 200 messages in each
of 23 channels, including 19 background histories, and offers 20 messages/s across the four
panes (5/1/2/12). It includes 256 local avatar fixtures, badge art, 7TV-shaped static and animated
emotes, Unicode emoji, replies and wrapping text. The static control uses the first frames of the
same emote assets at the same size. The process CPU includes the fixture's mutation observer.

The 12 s measurements use a 3 s warmup and three fresh processes per group. The baseline and
candidate use local native builds from the same pinned Rust toolchain. The fixture verifies
each viewport, the images painted, the channel allocation, message retention and animation
counters. Each run retained 4,600 messages and processed 239 during the sample (19.92/s).

| Metric | .15 mixed median [range] | .16 mixed median [range] | .16 static median [range] |
| --- | ---: | ---: | ---: |
| CPU % of one logical core | 34.70 [27.42–38.11] | 30.57 [27.13–35.12] | 25.78 [25.42–37.46] |
| RSS median MiB | 550.39 [467.32–551.27] | 551.53 [466.73–552.00] | 551.60 [549.28–552.66] |
| RSS peak MiB | 586.78 [585.39–586.84] | 586.33 [585.68–588.28] | 592.20 [590.95–594.80] |
| JS heap peak MiB | 194.31 [186.38–195.23] | 195.35 [185.67–195.39] | 193.46 [193.40–197.26] |
| Event-loop lag p95 ms | 0.058 [0.058–0.063] | 0.069 [0.063–0.070] | 0.058 [0.058–0.060] |
| Full draws/s | 16.58 [11.17–19.00] | 13.08 [11.42–15.25] | 11.42 [10.58–16.00] |
| Total presentations/s | 49.33 [48.00–52.00] | 48.17 [47.42–48.33] | 11.42 [10.58–16.00] |

The static control measured 4.79 percentage points lower
median CPU. Full-draw cadence also varied between runs. These measurements cover local fixtures.
The installed profile reached a higher CPU and RSS range, and its response to the patch remains
unmeasured. RSS is process memory, with JS heap reported separately.

## Production throughput

The text-only stress target used 50 channels, four panes, 5,000 offered messages/s and 200
retained messages per channel. Each group contains three fresh production processes on private
hardware Weston with a 1200×800 window, 3 s warmup, 30 s measurement and 2 s drain. Both
groups had zero React User Timing measures and processed at least 99.88% of the offered rate.

| Metric | AppImage addon .15 median [range] | Scoped .16 median [range] |
| --- | ---: | ---: |
| CPU % of one logical core | 90.12 [83.47–92.07] | 88.49 [86.41–89.97] |
| RSS median MiB | 496.64 [493.81–499.25] | 497.80 [487.42–500.19] |
| RSS peak MiB | 599.63 [580.20–603.95] | 589.53 [587.68–597.62] |
| JS heap peak MiB | 230.26 [224.35–240.23] | 215.36 [208.94–218.96] |
| Event-loop lag p95 ms | 2.328 [2.103–2.361] | 2.164 [2.054–2.203] |
| Event-loop lag max ms | 9.73 [9.45–11.41] | 8.76 [5.31–11.83] |
| Actual messages/s | 4995.94 [4994.68–4996.59] | 4994.48 [4993.98–4996.98] |

The production target measured a median CPU change of -1.8%.
The AppImage baseline used the installed release's native addon, while the candidate addon was built
locally. The coupled generator measures delivered work in this fixture.

## Single-pane follow-up

An unscoped cache had a repeated CPU increase in the one-pane development control at 1,000 msg/s.
The scoped version activates the row cache in renderers with multiple lists. A single list uses the
original focus lookup and releases any metadata retained from the previous layout.

| Metric | Local .15 median [range] | Unscoped median [range] | Scoped .16 median [range] |
| --- | ---: | ---: | ---: |
| CPU % of one logical core | 62.50 [60.34–64.65] | 66.69 [65.39–67.99] | 64.14 [63.36–64.92] |
| RSS median MiB | 497.94 [496.11–499.78] | 495.53 [491.98–499.09] | 497.34 [489.95–504.74] |
| RSS peak MiB | 603.09 [585.29–620.89] | 585.24 [573.45–597.03] | 600.26 [586.11–614.42] |
| JS heap peak MiB | 140.10 [131.62–148.58] | 148.58 [142.72–154.45] | 159.82 [138.26–181.38] |
| Event-loop lag p95 ms | 3.620 [3.597–3.643] | 4.254 [4.128–4.381] | 3.859 [3.794–3.924] |
| Event-loop lag max ms | 9.01 [7.27–10.75] | 18.19 [9.57–26.81] | 6.90 [6.34–7.45] |
| Actual messages/s | 997.16 [996.99–997.32] | 997.37 [996.91–997.82] | 997.91 [997.82–997.99] |

The final artifact completed all 15 default development cases. The minimum processed/offered rate
among non-idle cases was 99.06%. See [summary.json](summary.json) for all cases and
the per-run source identities.

Native unit tests, workspace check and 892 desktop tests passed. Isolated native QA covered
focus persistence during history appends, hotkeys, chat behavior and composer input. The four-pane
media runs verified that every viewport paints images, that each channel receives its allocation,
and that all 4,600 messages remain retained.

### Provenance

The Git base was `b190ee533ab897cfd4fab5584053e280ad00d0b0`. The four-pane driver SHA-256 was
`18d83b827298c153e64a8fd91937c2838b5aabf6d0c1b059c9a20751540cf846`. The local .15 addon SHA-256 was
`c29461a214f44b8f4b5696883b81db9613b611b0f07d8a7dfeb680b6cc7fb9c5`. The scoped .16 addon SHA-256 was
`b135cf63238849a098281367651b00a5f552be78d511de2f2262e08d5c9e54eb`. The [summary](summary.json) preserves the distinct
unscoped and scoped native identities and the before/after run metadata.

## Corrected live comparison

The corrected driver advances timestamps with message sequence. It checks that every pane's
latest generated message is the retained tail and has painted bounds inside its viewport.
The production runs below used the same 1280×1300 client window, hardware Weston, 20 offered
messages/s and four panes with 200 messages retained per channel. Each sample lasted 18 s after a
3 s warmup. Each group contains three fresh processes. All four tails painted and all 359
offered messages were processed in each run.

The pane replay prototype reused unchanged sibling panes on full draws. Its CPU improvement in
this workload was small relative to the scope of the native cache, so the patch was removed.
The static-first-frame control ran on the same prototype and retained matching imagery and sizes.

| Metric | .16 mixed median [range] | Pane replay mixed median [range] | Pane replay static median [range] |
| --- | ---: | ---: | ---: |
| CPU % of one logical core | 67.58 [66.31–68.17] | 65.88 [64.20–66.49] | 65.58 [64.40–68.73] |
| RSS median MiB | 554.97 [552.86–556.21] | 494.17 [494.04–554.48] | 560.66 [560.53–562.59] |
| RSS peak MiB | 594.07 [591.66–595.34] | 588.65 [584.86–596.11] | 605.40 [601.79–606.51] |
| JS heap peak MiB | 212.48 [212.13–212.52] | 185.04 [183.96–217.39] | 212.60 [212.42–212.78] |
| Event-loop lag p95 ms | 0.108 [0.100–0.128] | 0.077 [0.073–0.332] | 0.058 [0.056–0.064] |
| Full draws/s | 38.17 [38.17–38.50] | 38.39 [38.00–39.83] | 40.50 [39.44–40.61] |
| Total presentations/s | 54.50 [53.11–54.50] | 53.44 [53.28–54.50] | 40.50 [39.44–40.61] |

Animation-only presentations increased the presentation rate. Static first frames changed
median CPU by 0.31 percentage points, with overlapping ranges. A separate single-pane diagnostic
offered all 20 messages/s to one 640×555 pane and used 26.85% CPU. The replay path requires
multiple panes and was inactive in that diagnostic.

In a separate .16 gperftools run of the corrected four-pane fixture, 977 of 1,156 samples
included `Window::draw`, and 566 included virtual-list prepaint. The unprofiled runs started
350–351 native image decodes for 359 messages. Image readiness can request a second draw after
the message first appears. The corrected fixture exercises both moving rows and cold avatars.
Chatterino's layout caches each message and blits its static paint buffer at the current
position, with animated elements painted separately.
[Chatterino MessageLayout](https://github.com/Chatterino/chatterino2/blob/master/src/messages/layouts/MessageLayout.cpp)

### Release addon and rejected hover change

A separate matched series used the exact .15 addon from the AppImage, the local .16 addon
with the focus lookup change, and .16 with the hidden reply, copy and menu SVGs omitted.
This used the source application, with three fresh production processes per group and the same
corrected fixture. All groups processed 19.94 messages/s and painted all four tails.

| Metric | AppImage addon .15 | Focus lookup .16 | Conditional SVG trial |
| --- | ---: | ---: | ---: |
| CPU % median [range] | 72.82 [70.51–73.78] | 70.26 [69.42–70.62] | 65.63 [65.54–68.23] |
| RSS median MiB | 555.78 [555.57–556.80] | 552.66 [551.45–555.98] | 528.88 [528.15–538.98] |
| RSS peak MiB | 596.41 [595.41–598.91] | 594.71 [593.18–597.47] | 569.20 [566.00–571.91] |

The SVG trial preserved button hitboxes and passed hover and context-menu checks. A separate
12 s pointer sweep across a dense idle chat at 120 native movements/s measured 17.77% CPU on
.16 and 36.76% with conditional SVGs. Native mutations rose from 8,065 to 14,974. The trial was
reverted because mounting icons during hover changed the structure of the retained tree.

### GPUIX list windowing

The current list renders every retained row into React and Rust. GPUI constructs and lays out
the viewport rows and measures uncached overdraw rows. The pinned GPUIX version supports
`itemCount` and `windowStart`. Those properties let the app mount fewer React and Rust nodes.
Visible native rows still incur layout and paint during scroll. [GPUIX performance model](https://gpuix.dev/#performance-model)

An independent diagnostic retained the full 200 messages per channel and mounted the last
64 JSX rows per visible pane. It exercised tail-follow only. Each process painted the newest
message in each pane and processed all 359 offered messages. The `overdraw=128` diagnostic
left the full children list in place and was run once.

| Metric | Current list (n=3) | Last 64 JSX rows (n=3) | 128px overdraw (n=1) |
| --- | ---: | ---: | ---: |
| CPU % median [range] | 70.19 [69.77–71.80] | 65.75 [65.39–73.84] | 72.43 |
| RSS median MiB | 554.16 [551.80–554.96] | 420.91 [417.93–425.88] | 541.77 |
| RSS peak MiB | 594.10 [592.70–594.56] | 456.15 [455.50–459.66] | 581.41 |
| JS heap peak MiB | 216.59 [212.48–217.16] | 153.55 [153.11–154.90] | 212.48 |
| Event-loop lag p95 ms | 0.284 [0.231–0.286] | 0.080 [0.057–0.111] | 0.336 |
| Full draws/s | 37.06 [35.61–38.00] | 37.56 [36.72–39.56] | 37.17 |

The fixed-tail window reduced process RSS by 24%. CPU ranges overlapped. For general history
scrolling, pinned GPUIX skips keyed list splices in `itemCount` mode. Rolling retention then
shifts surviving message IDs across logical indices with cached heights. Count changes also
recreate the native list state. A production window would need to preserve keyed heights and
scroll anchors, install and retire focus handles with the window, and mount navigation targets
before scrolling. The fixed-tail and smaller-overdraw variants were removed after measurement.

The retained .16 implementation passed 892 desktop tests, isolated chat/composer QA and the
post-measurement interaction probe. The probe scrolled a pane while three siblings received
messages, resized all four viewports to 500×326 and typed into the native composer. All 34
interaction-phase messages were processed. The production throughput and 15-case development
matrix above apply to the same .16 runtime.

The [follow-up results](follow-up.json) record each run's fixture SHA, source and native
identities, throughput, timing, memory and animation counters. The source tree and addon were
frozen for each measurement. The user's live profile was sampled separately from the fixture,
and no matched Chatterino resource run was performed.

## Run the media fixture

From the repository root, build the pinned addon and run the two cases in series. Each run writes
`emote-resources-result.json` in its private session directory.

```bash
bun run --cwd packages/desktop build:native
provenance=$(bun -e 'import { readBenchmarkProvenance } from "./packages/desktop/scripts/bench-metrics"; console.log(JSON.stringify(await readBenchmarkProvenance(process.cwd())))')
for media in mixed static-first-frame; do
  bun run --cwd packages/desktop qa:gui --node-env production --compositor weston \
    --weston-shell desktop --weston-controls --display-width 1400 --display-height 1480 \
    --keep --timeout 65 -- bun scripts/qa-emote-resources.tsx \
    "{\"case\":\"live\",\"media\":\"$media\",\"durationSeconds\":18}" "$provenance" || break
done
```

Add `"liveInteractions":true` to the fixture configuration to test wheel input, a resize and
composer input while other panes continue to receive messages. This probe runs after resource
measurement and writes separate interaction evidence.
