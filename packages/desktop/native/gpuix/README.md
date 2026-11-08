# Pinned GPUIX native extension

TwirChat extends GPUIX 0.11.0 without modifying installed npm packages. `source.json`
pins GPUIX and its GPUI submodule to full Git revisions and verifies the `cosmic-text`
source archive and each local patch by SHA-256. Build caches live outside the repository.
No upstream commits, publishing, or downloaded native binaries are part of this build.

Native version `0.11.0-twirchat.23` lets users resize Linux client-decorated
windows from free edges and corners. A six-pixel frame keeps resize targets
outside the titlebar and chat controls. The compositor takes over the drag.
Maximized and fullscreen windows have no resize frame.

Native version `0.11.0-twirchat.22` adds Linux client titlebars when the Wayland
compositor delegates window decorations to the app, as on GNOME. GPUI follows the
desktop's button order and the compositor's window capabilities. Close uses the same
close-to-tray behavior as a compositor close request. On X11 and on Wayland when
the compositor provides decorations, the window manager supplies the frame.

Native version `0.11.0-twirchat.21` keeps Linux font candidates mapped only while
shaping them. The font cache keeps a fallback when it supplies a missing glyph.
A bounded cache of exact unsuccessful runs avoids repeating the search for the same text.

Native version `0.11.0-twirchat.20` makes the painted scrollbars interactive.
`scrollbarColor` already enabled a thumb; it now also inserts a wider hit strip
over that thumb. Pressing it starts a drag in the capture phase, so pointer
moves keep scrolling even over rows, and releasing ends the gesture. Virtual
lists freeze their measured content height for the drag and route positions
through `set_offset_from_scrollbar`; plain scroll containers use
`ScrollHandle::set_offset`. Track clicks move the thumb under the pointer and
continue as a drag. Content that fits still has no thumb and no hit strip.

Native version `0.11.0-twirchat.18` caches whole virtual-list rows. GPUI redraws
the window on every frame, so a pointer that crossed chat rows used to rebuild,
lay out and paint every visible message for each one-row hover change. Now a
row whose own subtree is unchanged replays its last layout, prepaint and paint.
Only the rows whose hover colour changed are re-rendered, at their measured size,
in one frame. See [Whole-row cache](#whole-row-cache) below. The GPUI text system
also remembers the font that `resolve_font` settled on. Before, a family missing
from the system formatted its cached error and retried every fallback on each
shaping call.

Since `0.11.0-twirchat.17` a missing, undecodable or unreadable
`<img>` as an empty box of its declared size. Upstream drew `img: load failed`
text without a width budget, which overflowed avatars, badges and emotes; now
whatever the app paints beneath the image stays visible instead.

Since `0.11.0-twirchat.16` a text editor can opt in to native clipboard
images and copied file lists. The same paste action handles the OS shortcut and
the configurable Paste action. Upload results use the editor's native selection
and undo history. X11 and Wayland read local file URLs only for opted-in editors.

To test clipboard images on the private X11 display, install `xclip` and run
`bun run qa:composer --xclip=/usr/bin/xclip` from `packages/desktop`. The probe
uses a local upload server and checks normal text paste, image preview, retry,
cancellation, caret insertion, undo, and copied image files.

The image patches keep GIF/WebP images animating in visible,
unfocused windows. [GPUIX issue #67](https://github.com/remorses/gpuix/issues/67)
remains open, and the pinned GPUI source still stops both image frame advancement
and scheduling on focus loss. The background-image patches add an opt-in GPUI
image policy and enable it for GPUIX images, including cached and transformed
emotes. Explicitly hidden windows pause; unknown visibility allows animation.
System reduced-motion preferences still stop animation. No JavaScript redraw
timer is added, and GPUI images without the opt-in keep their existing policy.

The synchronized-image patches also give repeated GIF/WebP images a shared
process-wide phase, independent of mount time or separate decoding. Each native
paint uses one timestamp for every image in that window. Decoded images retain
their original frame delays in a cumulative timeline; frame lookup uses binary
search rather than scanning frames. Zero delays use 10 ms. Hidden windows and
reduced motion freeze the last frame; animation rejoins the shared phase on resume.
The timeline belongs to the decoded image, with no global image registry or timer.

The image-frame-deadline patch coalesces those timelines into one cancelable timer
per window, armed for the earliest encoded frame boundary. Unrelated chat redraws
retain the existing timer when that absolute boundary is unchanged. Static images,
removed images, reduced motion, and hidden windows stop requesting image frames.
A visible native frame request resumes a hidden animation at the shared phase.
Ordinary UI draws rebuild changed image subtrees. The scene-animation
patch registers synchronized animations only when their image actually paints inside the
content mask. Layout of clipped or offscreen images creates no animation demand.

Each window/source owns one stable atlas slot, using an image ID distinct from the source
and every other window. A pure animation tick uploads only sources whose encoded frame has
changed, verifies that each atlas allocation stayed in place, and presents the existing scene.
It does not rebuild native layout/text, rerender React, advance resource-cache draw epochs,
or change the encoded frame rate. Clipping, object fit, grayscale, corner radii and opacity
remain in the existing painted scene. Visible unfocused windows retain the native 30 fps
throttle; hidden windows and reduced motion stop animation demand.

Input, caret, hover, selection, scrolling and other dirty UI updates take the regular draw
path before animation-only presentation. Varying image dimensions, missing atlas entries,
upload failures or relocated allocations also fall back to a regular draw. Completed draws
reconcile slots against actual scene allocations, including cropped tiles and cached replay;
retired slots and window close release both atlas pixels and decoded-image references.
WGPU reuses atlas bindings per texture within each frame and drops them at the frame end.
Explicit immutable cached-scene presents also reuse GPU instance bindings and data;
ordinary draws, instance-storage growth and device recovery invalidate that cache.
Virtual lists report changed visible ranges after layout, including initial layout,
programmatic scrolling and resize, with duplicate ranges suppressed.

Selectable text paints search/selection washes and registers its text directly before glyphs,
without extra layout containers or an underlay canvas. Unstyled raw text leaves also skip
the generic interactive host while publishing their painted automation bounds. Authored
styles, events, accessibility metadata and empty placeholders keep the full host path.

Color-only retained batches notify the view without forcing a global refresh. During these
draws, eventless intrinsic text hosts inside virtual-list rows can reuse measured layout,
prepaint and scene ranges. Text context, geometry, clipping, selection and focus are checked;
native selection registries and painted text/bounds snapshots are replayed in paint order.
Active motion, geometric hover styles, dynamic ancestor opacity, search highlights, inspector
picking and active accessibility keep ordinary painting. Full invalidations, including message
ingestion, clear the cache and use the normal path. Deferred rows also check the tree's committed
generation under its mutex, so a queued UI command cannot leave cached ancestor opacity stale.
macOS currently keeps full invalidation.
Each window admits at most 4096 words, prunes entries against actual painted identities and
clears them on close. Images continue through their existing resource and animation paths.

Compact message bodies can also reuse GPUI's entity-backed view cache while their mounted row,
committed subtree, available width, inherited text, selection and focus remain unchanged.
The row background and other surrounding elements keep ordinary layout. Cached bodies replay
their selectable-text and painted-bounds records and touch only existing image resources;
pending or replaced decodes require a fresh body. Animation slots continue through the final
scene, including cached replay. A changed width, dirty child view, full invalidation, active
motion, search highlight, inspector or accessibility uses fresh intrinsic measurement.
Only static column ancestry is eligible, so the previous body height is never imposed on an
unknown or changed row constraint. Each window retains at most 256 bodies, removes retired
entries after their painted lifetime, and clears them on close. View cache versions are not
recycled when an entry is removed.
The native cache paints a compatible absolute hover toolbar separately, using its original
body anchor and descendant IDs. Full or unsupported draws retain the original element tree.
Toolbar colors leave the inline revision intact; only changed rows recompute this policy.
Cached misses constrain the body root to its measured width while preserving the intrinsic
width of long words. Cache-state identities add no descendant scope or layout container. Ancestor geometry is guarded by the committed Full generation;
row background changes do not invalidate otherwise unchanged content. Text with no background
decorations skips the empty background layer, avoiding its glyph walk and overlap bookkeeping.

### Whole-row cache

Each virtual-list row first tries the same entity-backed view cache as a whole. A row is
laid out as the list's own item, so its size depends only on its subtree, the list's
available space and the inherited text style. Those, the styles of the list and its
ancestors, and the frame context (viewport, scale, rem, focus, selection, keyboard mode
and keyboard-focus dimming) key the entry. A row reuses its measured size only when it
was painted in the previous frame with every image decoded. Unlike a message body, a row
entry survives Full commits elsewhere in the tree, such as a new message, and those
commits no longer refresh the whole window. A row only re-renders when GPUI sees new
bounds, so after a new message shifts the list it replays from the next frame.

Elements carry a layout revision that colour-only restyles leave alone. A row whose
only change is a hover colour keeps its measured size and re-renders once, in the frame
that shows the change. Inputs, custom elements, anchored layers, scroll containers,
motion, search highlights, inspector picking and active accessibility keep the ordinary
path. When a row is not eligible, the body cache above still applies to its message body.

Run from `packages/desktop`:

```sh
bun scripts/build-gpuix-native.ts prepare
bun scripts/build-gpuix-native.ts check
bun scripts/build-gpuix-native.ts test
bun scripts/build-gpuix-native.ts build
```

The build requires Rust 1.97.1 (`rustup toolchain install 1.97.1`), Cargo, Git, a
platform C/C++ linker, and the usual GPUI native system dependencies. Linux builds
include X11 and Wayland backends and require Vulkan, XKB, font, Wayland, X11, and
development libraries. The script never installs system dependencies. It
limits Cargo to two jobs; `CARGO_BUILD_JOBS=1` selects one. The release build uses
`--locked --release --no-default-features` and the pinned crate's release profile.
No GUI is opened by preparation, compilation, or the pure Rust tests.

Artifacts are `dist/native/gpuix.<platform>-<arch>.node`, with an adjacent `.node.json`
manifest containing API version, source pins, patch/build digest, target, Rust
version, and binary SHA-256. Supported targets match the upstream package:
`linux-x64`, `darwin-arm64`, `win32-x64`, and `win32-arm64`. A cached source checkout
is never reset, and an interrupted preparation fails explicitly. Remove only the
reported incomplete cache directory to retry. `TWIRCHAT_NATIVE_CACHE` can select
another cache location. Production packaging and the runtime loader consume these
artifacts; this directory does not patch `node_modules`.

## Build and packaging

`bun run dev`, `bun run start`, and `bun run build` first run `bun run build:native`.
An unchanged artifact is reused only after its source/build identity and SHA-256
match. `bun run check:native` and `bun run test:native` use the same pinned source.

`bun run package:runtime <executable-directory>` stages the addon and its manifest
in `<executable-directory>/native/`, alongside the existing fonts, OBS overlay,
paint worker, and installed Sharp dependency graph. Packaging checks both source
revisions, every patch checksum, the current build digest, native machine type,
toolchain/version, size, and binary SHA-256. An artifact for another architecture
cannot be renamed into a supported release.

The release workflow builds Linux x64 on Ubuntu x64, Windows x64 on Windows x64,
and macOS arm64 on Apple Silicon. It installs the pinned Rust toolchain and native
system dependencies on each host, then builds the extension before compiling and
packaging the application. Other supported build targets are not published by this
workflow until they have their own native runner and release channel.

After building, verify executable-adjacent resolution from a clean working
directory inside the private QA display:

```sh
bun run qa:gui --timeout 45 --keep -- bun scripts/qa-packaged-runtime.ts dist/twirchat
```

This invokes the compiled executable as Bun, clears the development binding
override, and asserts that its adjacent addon exports native API version 3 both
at module level and on a real renderer instance. It also checks the embedded Bun
version against `.bun-version`, initializes the complete blank desktop database,
and exercises the Unicode SQLite function used by chat search. It does not start
platform accounts or the application backend. The report is saved as
`packaged-runtime-result.json` in the private QA session.

## Native API version 3

Each `GpuixRenderer` exposes `getTwirNativeApiVersion(): 3` (also exported by the raw addon) and adds:

`getPaintedElementBounds(id)` reads the last completed paint without waiting for layout or the
UI command queue. It returns null before an element paints, after removal/close, or during a
contended publication. Use it for input/drag hit testing; `getElementBounds` retains its fresh
automation-query semantics. Snapshots share the completed native bounds map and do not request
extra frames.

- `closeWindow(): void`: requests removal of this window; already closed is harmless.
- `isWindowActive(): boolean`: cached actual native window activation, false before
  initialization and after close. Independent of editor selection/focus.
- `isWindowOpen(): boolean`: cached actual lifecycle state, false before initialization.
- `getWindowVisibility(): 'visible' | 'hidden' | 'unknown'`: cached native visibility,
  independent of activation. Uninitialized or closed windows report `hidden`; a platform
  without a reliable visibility result reports `unknown`. Notifications treat unknown
  visibility conservatively rather than equating an unfocused window with a hidden one.
- `configureTray(enabled, notifications): Promise<void>`: creates, updates, or removes
  the native tray icon and its Open, Mention notifications, and Quit menu items.
  Linux uses StatusNotifierItem over the session D-Bus; macOS and Windows use their
  native status/tray facilities. Native calls run on the owning UI thread.
- `takeTrayEvents(): string[]`: drains pending `show`, `notifications`, and `quit` actions.
- `notifyFromTray(title, body): Promise<boolean>`: requests a Windows tray notification;
  returns false when that native notification path is unavailable.
- `getWindowBounds(): { x, y, width, height, mode } | null`: last observed geometry,
  null before initialization. Width/height are client content pixels. Mode is
  `windowed`, `maximized`, or `fullscreen`. Reads never round-trip to the UI thread.
- `getImageAnimationStats(): { fullDraws, animationOnlyPresents, slotUploads, liveSlots,
  fallbacks } | null`: cached counters for completed full draws, actual animation-only
  presentations, stable-slot uploads, live animated sources and draw fallbacks. The getter
  uses a try-lock and never requests layout or waits for a native command. Window close
  releases live slots and publishes zero even while the JS renderer remains referenced.
- `getWindowCapabilities(): { position: boolean, clickThrough: boolean }`: cached
  platform support. Position is false on Wayland, where global moves are unavailable.
- `setWindowBounds({ x?, y?, width?, height?, mode? }): Promise<void>`: validates
  finite coordinates, positive sizes, and mode names; rejects unavailable global
  positioning. Resolves when the native platform accepts the request. Bounds cache
  changes only following actual platform events, without predicting compositor results.
- `setClickThrough(enabled: boolean): Promise<void>`: sets an empty pointer input
  region or native pointer passthrough; disabling restores normal hit testing.
- `setHotkeyPlan(json: string): void`: atomically publishes this window's available
  shortcut plan before native editor keybindings. JSON contains `{ generation,
  bindings: [{ id, contextId, keys }], recordAll? }`; there are at most 520 entries
  (512 configured bindings plus legacy shortcuts), and one to four normalized
  chords per entry. Modifier order is `ctrl+cmd+alt+shift`; aliases follow the JS
  shortcut normalizer. Invalid plans throw before replacing the existing plan.
  The native state machine captures only a matching current prefix/completion;
  unmatched keys retain native editing. Prefixes expire after a one-second gap,
  and reset on plan generation, focused control, or window deactivation.
  Identical plan publications preserve an in-progress sequence.
  Captured `windowKeyDown` events preserve the real key/modifiers/repeat/dispatch ID
  and add `hotkeyGeneration`, `hotkeyBindingId?`, `hotkeyContextId?`, `hotkeyPrefix`,
  and `hotkeyRecorded`. The JS broker validates the generation and executes the
  exact completed binding, without a second sequence state machine. It must call
  `preventDefault()` for captured prefixes as well as completions. `recordAll`
  captures nonmodifier keys for recording, including keys with native editor
  actions. The native interceptor is removed on window close.
- `runTextInputAction(action): Promise<boolean>`: dispatches a native editor action
  along this window's focused dispatch path. Returns false when unavailable. Valid
  actions are `undo`, `redo`, `selectAll`, `selectWord`, `copy`, `cut`, `paste`,
  `cursorToStart`, `cursorToEnd`, `selectToStart`, and `selectToEnd`. Start/end refer
  to the whole editor document. Unknown names are rejected before dispatch.

On Linux, an OS close request for the window that currently owns a successfully created
tray hides that window while keeping its React tree, backend connections, and tray alive.
Activating the tray maps the same window again; explicit `closeWindow()` and tray Quit still
remove windows. Windows without a tray retain ordinary close behavior. X11 uses native
unmap/map requests. Wayland unmaps the xdg surface and repeats its configure handshake before
presenting again, retaining the title, app ID, size limits, and maximized/fullscreen request.

Initial `WindowOptions` additionally accepts finite `x`/`y` coordinates and
`kind: 'normal' | 'floating' | 'popup'`. Window-manager policy still governs actual
placement and stacking. `floating` maps to GPUI's floating window kind, and does not
promise an always-on-top policy across other applications.

macOS renderers share one embedded application and platform pump, with separate
window handles and frame callbacks. Linux/Windows retain GPUIX's own UI application
thread per renderer. Scroll handles, pending virtual list scrolls, painted element
bounds, selection regions, text paint snapshots, and search ordinals are keyed by
actual GPUI window IDs, including cleanup on close. Existing element IDs can overlap
between renderers. Native text actions preserve editor selections and undo history. Copy/cut return false
for an empty editor selection; cut also rejects a read-only editor. First native
focus is deferred until focus subscriptions activate, so initial autofocus and
newly mounted search fields emit exactly one real focus transition. X11 geometry
observations query root coordinates to handle combined movement and resizing
without retaining an old origin or trusting parent-relative configure events.

Each threaded renderer retains its UI `JoinHandle` and queues joining on one
process-owned reaper when closed, when its completed frame loop is observed, or
when collected; its JS thread never waits for the platform loop. Closing a window cancels its command task on its owning UI thread, and queued
window-operation promises reject if cancellation wins. GPUI's priority queue wakes
all idle workers on last-sender disconnect and releases pending work outside its
mutex when the last receiver drops. Linux Calloop callbacks use weak loop handles,
and each application's exiting event loop explicitly stops and joins its timer
loop before the foreground queue is released. Late foreground cancellations are
retired until notification callbacks return, then drained on the UI thread again
after the platform sources/windows and common fields finish destruction. This
also releases tasks that otherwise retain their dispatcher, channels, and worker
pools, without dropping local futures while a notification mutex is held.

GNU/Linux reaping also releases free glibc arena pages with `malloc_trim(0)`
after the UI thread has joined. Releases coalesce after 500 ms without another
reaped application, with a fixed two-second deadline during continuous closes.
The reaper waits on its channel when no release is pending; steady-state rendering
has no cleanup timer. Other target environments do not compile or call this GNU
allocator function. No process-wide allocator tunables are changed.

Platform implementation uses X11 ConfigureWindow/SHAPE input regions, Wayland
surface input regions, AppKit content sizing/frame positioning/ignoresMouseEvents,
and Win32 window positioning/layered transparent input. X11/Wayland are compiled
locally; other platform branches need their own target CI and runtime verification.
A portable always-on-top toggle remains outside this native contract.
Window-manager GUI checks use `qa:gui --dbus` to isolate the tray's session bus as
well as its display; they never connect to the user's tray or notification service.

GUI probes must run through the repository's `qa:gui` isolated launcher. Never
launch this addon against the user's display/compositor directly.

Focus handles, tab metadata and focus/blur subscriptions reconcile only when the
committed tree's focus metadata changes. Color, text and unrelated node updates
reuse the existing handles. Pending focus requests still settle or cancel on each
render; GPUI still derives tab order from the elements actually painted in that frame.

## Verification

The Linux release addon has been exercised with two actual windows through
`qa:gui` on its private Xvfb server. To repeat:

```sh
bun run qa:gui --timeout 60 --keep -- bun native/gpuix/probes/window-lifecycle.ts
```

This probe checks real client resize/global positioning, independent overlapping
IDs in virtual lists and painted text/bounds, close isolation, cached read latency,
settlement of 96 bounds/input/passthrough promises during a close race, focused
native word selection/cut/undo/redo,
`display: none` layout/paint/tab exclusion, and retained editor drafts/undo history.
It queries X11 SHAPE input rectangles directly using Python 3 and `libX11`/`libXext`
to verify that pointer passthrough actually empties the native region and restores
it afterward. The helper refuses a display outside the isolated QA environment.
Wayland and macOS/Windows runtime behavior still require their respective platform
verification; Linux compilation covers both X11 and Wayland branches.

Focused Rust tests include text/ordinal isolation and cleanup, pending scroll
isolation, painted bounds cleanup, option/action validation, native input history,
the `Display::None` style mapping, idle-worker disconnect, queued sender-cycle
release, queue drain/disconnect ordering, and free-page release quiet/hard deadlines. Upstream's pinned Rust crate currently denies
Clippy lints that fail in existing unrelated code; this extension does not weaken
those lint settings or rewrite the upstream crate to silence them.

Native shortcut regression probe (also requires the isolated launcher):

```sh
bun run qa:gui --timeout 90 --keep -- bun native/gpuix/probes/hotkey-capture.ts
```

This checks a real Ctrl+Right/native WordRight conflict, unchanged native editing
when no available binding is published, fast sequences with unmodified suffixes,
invalid prefix fallback, timeout/deactivation/generation cancellation, reserved-key
recording, native held-key metadata, and independent plans in two native windows.
GPUI's keystroke observer payload now carries the original held-key flag; capture
uses its existing pre-action interceptor rather than a JS cancellation round trip
or a mutation of the application's global native keymap.

## Decoded image resources

Each native view owns a cache for decoded Path/URI images, including deferred virtual-list
rows. Loading bypasses GPUI's retain-all asset cache. Cold resources are bounded by 256 entries
and 64 MiB of decoded frame pixels; images used by the current or preceding paint are protected
from eviction. A visible working set can exceed these limits. A coalesced settling callback
retires the previous paint after removal without keeping an idle redraw loop alive.

Eviction and view release cancel owned loading tasks and remove image atlas allocations.
Cache epochs follow actual native draws, including layouts reached without a root render.
`getImageResourceStats()` returns a cached snapshot of entries, loading, decodedBytes, evictions,
decodes and configured limits, or null during a contended publication. It does not request layout.

`getWindowScaleFactor()` reads cached native scale and `windowScaleChange` reports actual changes
at element ID 0. The desktop subscribes once per window and selects inline 7TV 1x–4x images for
the logical emote height multiplied by display scale. Catalog and tooltip preview URLs keep
their original resolution.

The finite bundled Kick badge SVG set continues using GPUI's content-keyed data-image cache.
Sharp paint/emote data URLs are intermediate layers; their final local WebP files use this cache.
