# Pinned GPUIX native extension

TwirChat extends GPUIX 0.11.0 without modifying installed npm packages. `source.json`
pins both GPUIX and its GPUI submodule to full Git revisions; every local patch has
a SHA-256 checksum. Build caches live outside the repository. No upstream commits,
publishing, or downloaded native binaries are part of this build.

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
override, and asserts that its adjacent addon exports native API version 2 both
at module level and on a real renderer instance. It also checks the embedded Bun
version against `.bun-version`, initializes the complete blank desktop database,
and exercises the Unicode SQLite function used by chat search. It does not start
platform accounts or the application backend. The report is saved as
`packaged-runtime-result.json` in the private QA session.

## Native API version 2

Each `GpuixRenderer` exposes `getTwirNativeApiVersion(): 2` (also exported by the raw addon) and adds:

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
