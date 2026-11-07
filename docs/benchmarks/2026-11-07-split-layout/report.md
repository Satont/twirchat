# Split layout frame cost

A user with four channels in a 2×2 split saw the window respond at about 10 frames per second
while chat CPU looked low. One native renderer thread was busy 90–100% of a core with or without
pointer motion; the JavaScript thread used about 10% and the GPU under 1%.

## Live profile

Windows 11, packaged build of `main` with the same 4 channels, a sampling profiler on the native
thread with matching symbols, 15–20 seconds.

| | Before | After |
| --- | --- | --- |
| Time per full frame | median 105 ms, p90 117 ms | under the 5 ms sample interval, max 8 ms |
| Native thread | 90–100% of a core | 10–40% |
| Process CPU | 80–124% | 14–59% |

About 80% of the frame was Taffy layout from the window root. Chat rows in the virtual lists cost
about 7%.

## Cause

Each split level asked the chat pane for its content size before giving it a final size, so the
pane header and composer were laid out many times per frame. Removing parts of the pane in the
stand, 2×2, text only:

| Removed | ms per frame |
| --- | --- |
| nothing | 55 |
| header | 35 |
| composer | 39 |
| message list | 45 |
| header and composer | 21 |

Window height and message content barely changed the cost. Bare panes in one row with the same
element count cost about half as much.

## Change

`PanelView` places its content in an absolutely positioned layer that fills the pane. The split
layout no longer measures the content, and the pane is laid out once at its final size.

## Stand

`bench:flood` can now render the real `WatchedView`:

```sh
bun run --cwd packages/desktop bench:flood --panes 4 --channels 4 --rate 16 --view watched --grid 2x2 --width 1380 --height 1080 --image-file emote.webp
```

Windows 11, production React, 7TV animated emote, 16 messages/s over 4 channels, 8-second runs.
`ms/draw` is native thread time divided by full draws.

| Layout | Before ms/draw | After ms/draw |
| --- | --- | --- |
| 2×2 | 51.5, 54.0, 56.6, 70.9 | 16.1, 16.9, 18.0 |
| row | 18.6, 20.3, 27.4 | 11.1, 11.9 |

Painted rows and element counts were unchanged.

## Limits

- Measured on Windows only. `bench:chat` and its production gate need Linux and were not run.
- The live comparison depends on chat activity at the time and is not a controlled benchmark.
- The pane drag grip, drop highlight, dividers and add-channel form were checked by hand in the
  packaged build, not by an automated test.
