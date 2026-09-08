# TwirChat — GPUIX desktop app

React + [GPUIX](https://gpuix.dev) port of the TwirChat desktop UI. GPUIX renders
React directly onto GPUI (Zed's GPU framework) — **no Electron, no webview, no DOM**,
one Bun process for everything.

```bash
bun run dev              # bun --hot src/gpuix/main.tsx (remounts React on save)
bun run start            # plain run
bun run typecheck        # tsc -p tsconfig.json && tsc -p tsconfig.gpuix.json
```

## Architecture

```
┌─────────────────────────── one Bun process ───────────────────────────┐
│                                                                       │
│  src/gpuix/main.tsx                                                   │
│    │                                                                  │
│    ├─ getDesktopBackend()          (globalThis singleton, hot-safe)   │
│    │    src/gpuix/backend/server.ts                                   │
│    │    │                                                             │
│    │    ├─ src/store/*            SQLite (bun:sqlite)                 │
│    │    ├─ src/platforms/*        Twitch / Kick / YouTube adapters    │
│    │    ├─ src/chat/aggregator.ts dedup + 7TV enrichment              │
│    │    ├─ src/watched-channels/* watched-channel manager             │
│    │    ├─ src/seventv/*          7TV emote service                   │
│    │    ├─ src/backend-connection.ts  WS to the backend service       │
│    │    ├─ src/overlay-server.ts  OBS overlay HTTP+WS (port 45823)    │
│    │    └─ src/auth/*             PKCE OAuth + local callback server  │
│    │                                                                  │
│    ├─ { api, events }   ← "the backend" (see below)                   │
│    │                                                                  │
│    └─ render(<App/>)   React → GPUI (native window, no browser)       │
│         src/gpuix/components/*                                        │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### The "backend" (RPC boundary)

With Electrobun/Wails the UI lived in a separate webview process, so every call
crossed an RPC bridge. GPUIX has **no second process**, so the backend is an
in-process facade with exactly the same shape as the Wails gateway:

- `src/gpuix/backend/api.ts` — `DesktopApi`: every request method the Vue app's
  `desktopApi.request.*` had (same names/params), implemented directly against
  the TypeScript stores/adapters/managers. Moderation/chatters/avatar logic is
  ported back from the Go bridge (`internal/bridge/*.go`) to TS.
- `src/gpuix/backend/events.ts` — `DesktopEventMap` typed emitter, same event
  names as Wails (`chat_message`, `platform_status`, `watched_channel_message`, …).
- `src/gpuix/backend/context.ts` — React side: `useBackend()` +
  `useBackendEvent(name, handler)`. Components never import stores/adapters
  directly — only the facade — so a real transport (WS/IPC) could replace the
  in-process one without touching UI code.
- `src/gpuix/backend/server.ts` — boots all of it once per process and pins the
  instance on `globalThis` so `bun --hot` remounts React without reconnecting
  Twitch/Kick/WS.

### State

`src/gpuix/state/` — observable stores on `useSyncExternalStore`
(`create-store.ts`), replacing Pinia:

- `app.ts` — settings/accounts/statuses/messages/events/watched/tabs/emotes/
  stream-status polling/moderation outcomes/notices + `wireBackendToStores()`
  - `loadInitialData()` (ports `App.vue`'s boot sequence).
- `layout.ts` — per-tab watched-channel split layouts (ports `stores/layout.ts`).
- `caches.ts` — avatar + mention-color session caches.
- `focus.ts` / `hotkeys.ts` — global hotkeys (Ctrl+K, Ctrl+Tab…) with the
  "skip when a text editor is focused" rule.

> **GPUI reentrancy gotcha**: store notifications are coalesced into a
> `setTimeout(0)` macrotask. `useSyncExternalStore` re-renders _synchronously_,
> and a render→`applyBatch` inside a GPUI event callback panics the Rust side
> ("cannot update GpuixView while it is already being updated"). Don't call
> store `.set()` expecting synchronous repaint from an event handler.
>
> **Hot reload persistence**: desktop `bun --hot` re-evaluates the whole module
> graph on save, so every named store is pinned on `globalThis`
> (`create-store.ts` registry) — remounts keep messages, settings, tabs, caches.

### Virtual scroll

`virtua`'s VList is replaced by the **native `<virtual-list>`**:
`alignment="bottom" followTail estimatedItemHeight={56}` gives the chat tail
behavior (follow new messages until the user scrolls up) that the Vue build
hand-rolled with `isAtBottom` + `followLatestAfterLayout`. The "Scroll to
latest" pill tracks `onVisibleRange` and jumps via
`renderer.scrollToItem(listId, count)`.

### Message rendering

No HTML and no inline images in text runs, so a chat message becomes a
**flex-wrap token row** (`message-tokens.ts` + `MessageText.tsx`): words /
mentions / links are `<text>` items (trailing space kept inside the token for
font-metric spacing), emotes are `<img>` items. Verified by automation bounds
that text after an emote continues on the same line. Long unbreakable words
(URLs) are chunked at 28 chars so rows can wrap.

### Remote images

GPUI's Linux build **cannot load http(s) images** (its asset cache opens the
URL as a file and fails). `src/gpuix/state/image-cache.ts` downloads every
remote image (avatars, emotes, badges, thumbnails) to
`~/.twirchat[-dev]/image-cache/<sha256>.<ext>` and components render the local
file through `ui/RemoteImage.tsx`. Bump of `imageCacheRevisionStore` re-renders
consumers when a download lands; failures are negatively cached for 5 minutes;
the directory is pruned to ~3000 files at startup.

### Overlay (OBS)

Unchanged: the OBS browser source needs HTML, so the overlay stays the Vue app
served by `src/overlay-server.ts` (started by the GPUIX backend too).

## Known limitations (GPUIX-specific)

- **`click()` automation panics on Linux** (gpuix 0.7.0 upstream bug:
  `dispatch_mouse_up` → text drag listeners → `cannot update GpuixView while it
is already being updated`). Real mouse input is unaffected; keyboard
  automation (`press`, `fill`, `ctrl+tab`…) works. Track
  https://github.com/remorses/gpuix before relying on mouse automation on Linux.
- **Freshly mounted subtrees sometimes don't paint** (elements exist in the
  retained tree with correct bounds, but no pixels until restart) — hit it on
  newly split panes. Workaround: `layoutRevisionStore` remounts the whole pane
  tree after every layout mutation.
- **GIF emotes pause while the window is unfocused** — GPUI stops advancing
  animation frames for inactive windows; animation resumes on focus.
- **No drag-reorder of tabs / drag-dock of panels** — GPUI pointer capture
  routes moves only to the pressed element, so cross-element hit testing is
  impossible. Splits/resizes/assignments work via buttons, hotkeys
  (Ctrl+H / Ctrl+Shift+H / Ctrl+W) and the ⋮ menu.
- **No italic / underline / letter-spacing** in GPUIX styles: action (`/me`)
  messages use opacity instead of italics; links are colored-only;
  uppercase is done in JS.
- **Fonts resolve from the OS** — Inter/Manrope render if installed, otherwise
  GPUI's fallback is used (no bundled fonts yet).
- **Emote insertion appends at the end** — the native textarea doesn't expose
  the caret position.
- **Updater is stubbed** (`checkForUpdate` → "no update"); releases stay on the
  Wails build.
- **Window frame persistence** (`WindowStateStore`) is not wired — GPUIX
  `render()` takes only width/height at startup.
- Clipboard write goes through `backend.api.copyText` (pbcopy/wl-copy/xclip),
  since GPUIX exposes no clipboard API.

## Debug helpers

- `GPUIX_BACKGROUND=1 bun src/gpuix/main.tsx` — launch without stealing focus
  (the agent-driving pattern; note **Linux ignores `focus: false`**, the window
  still comes forward).
- `TWIRCHAT_GPUIX_START_MAIN_TAB=events|platforms|settings` — boot onto a tab.
- `TWIRCHAT_GPUIX_START_TAB=<watchedChannelId>` — boot onto a watched tab.
- `POST http://localhost:45824/dev/inject-chat` with a `NormalizedChatMessage`
  JSON body injects a fake chat message (dev only).
- Automation: `launch({ command: 'bun', args: ['src/gpuix/main.tsx'] })` from
  `@gpuix/react/automation` — tree queries, bounds, `fill`/`press` work on
  Linux; screenshots don't.
