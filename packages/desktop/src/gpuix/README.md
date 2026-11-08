# TwirChat — GPUIX desktop app

React + [GPUIX](https://gpuix.dev) port of the TwirChat desktop UI. GPUIX renders
React directly onto GPUI (Zed's GPU framework) — **no Electron, no webview, no DOM**,
one Bun process for everything.

```bash
bun run dev              # bun --hot src/gpuix/main.tsx (remounts React on save)
bun run start            # plain run
bun run typecheck        # desktop, GPUIX and test configurations
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
│    │    ├─ src/overlay-server.ts  OBS HTTP+WS (prod 45823/dev 55823)  │
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

- `app.ts` — settings/accounts/statuses/messages/watched/tabs/emotes/
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
> graph on save. `persistent-resources.ts` retains each named store or controller
> on `globalThis`; owners declare the exact key and type at module scope. Remounts
> keep messages, settings, tabs, caches and pending preference writes. Store
> `.set(value)` assigns a value and `.modify(update)` applies an updater; function
> values remain ordinary values without ambiguous casts.

HMR replaces the React roots, context providers, event handlers and hotkey observers
with the current module graph. Native windows, the backend and named state remain
alive. A window-manager runtime-version upgrade requires one ordinary app restart.

### Virtual scroll

`virtua`'s VList is replaced by the **native `<virtual-list>`**:
`alignment="bottom" followTail estimatedItemHeight={56}` gives the chat tail
behavior (follow new messages until the user scrolls up) that the Vue build
hand-rolled with `isAtBottom` + `followLatestAfterLayout`. The "Scroll to
latest" pill tracks `onVisibleRange` and jumps via
`renderer.scrollToItem(listId, count)`.

### Reading and composing

- Each pane has search (`Ctrl+F`), a mentions/replies filter, and a pause button.
  Pausing freezes the pane's messages; the resume control counts live arrivals
  independently of the bounded message buffer, then jumps to the current tail.
- Search operates on retained messages (500 at home, 200 per watched channel).
  Words and quoted phrases combine with AND. Filters: `from:user,other`,
  `in:channel`, `platform:twitch`, `badge:moderator`, `has:link`, `has:emote`,
  `is:reply`, `is:highlighted`, `is:deleted`, `is:action`, `is:system`, `is:failed`.
  Prefix a term with `!` or `-` to exclude it. `regex:` uses bounded PCRE2 matching;
  `subtier:` and `client:` select subscription tiers and detected clients.
- Mentions match whole nicknames (with or without `@`) and replies to your own
  messages, scoped to the account's platform. Your own messages and names inside
  links do not count. Inactive tabs show unread counts and highlighted mention
  counts, including channels assigned to their split layouts.
- The `msg/s` indicator is the average over the last ten seconds of live traffic;
  loading history does not affect it.
- Drafts and the last 100 sent messages survive tab switches, panel remounts and
  hot reload for the current session. Splits have separate composer keys.
  Up recalls history from an empty composer; Alt+Up/Down browses from any draft.
  Down past the newest entry restores the unsent draft. Ctrl+Tab and Ctrl+K work
  while composing; dialogs and the shortcut recorder retain keyboard priority.
- Local commands: `/clearmessages`, `/copy`, `/pause`, `/resume`, `/mentions`,
  `/search <query>`. Clearing only hides the current pane's retained messages;
  copying exports its displayed messages. `/clear` remains a platform command.
- `/translateauto en` detects the source language and translates outgoing chat
  messages in the selected channel until the app restarts. `/translateauto off`
  or the **Turn off** button above the input restores the channel's usual
  translation behavior. Select a single platform to use the command on My Channels.

### Live message pipeline

Live events are batched for 16ms and appended without sorting the whole buffer.
Late deliveries use binary insertion; snapshots still merge with live messages
so a slow initial history response cannot erase newer traffic. Duplicate events
preserve array identity. Panes select only their own channel and rows keep stable
callbacks, so unrelated traffic and unchanged messages avoid React updates.

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
file through `ui/RemoteImage.tsx`. Existing files are reused before fetching.
Downloads are coalesced and limited to six concurrent requests, with a 20 MiB
response limit. Each URL has its own deferred subscription, so completing one
image does not repaint every image. Idle metadata is bounded; failures are
negatively cached for five minutes. The directory is pruned to ~3000 files at startup.

### Overlay (OBS)

Unchanged: the OBS browser source needs HTML, so the overlay stays the Vue app
served by `src/overlay-server.ts` (started by the GPUIX backend too).

## Known limitations (GPUIX-specific)

- **Freshly mounted subtrees sometimes don't paint** (elements exist in the
  retained tree with correct bounds, but no pixels until restart) — hit it on
  newly split panes. Workaround: `layoutRevisionStore` remounts the whole pane
  tree after every layout mutation.
- **GIF emotes pause while the window is unfocused** — GPUI stops advancing
  animation frames for inactive windows; animation resumes on focus.
- Pane dividers use painted element sizes for proportional resizing. Drag the
  pane grip onto another pane's edge to dock, or its center to swap positions.
  Pointer capture keeps the gesture active outside the grip. Escape cancels.
- **No italic / letter-spacing** in GPUIX styles: action (`/me`) messages use
  opacity instead of italics; uppercase is done in JS. (`textDecoration`
  underline/line-through exists since gpuix 0.8.)
- **Fonts are bundled** — `fonts.ts` registers `InterVariable.ttf` and the
  Manrope variable TTF via `renderer.registerFont` on first render (from
  `public/fonts` in dev, `fonts/` next to the packaged exe). It must run
  before the first layout: a family missing then has already fallen back.
- **Emote insertion appends at the end** — the native textarea doesn't expose
  the caret position.
- **Window frame persistence** (`WindowStateStore`) is not wired — GPUIX
  `render()` takes only width/height at startup.
- Clipboard write goes through `backend.api.copyText` (pbcopy/wl-copy/xclip),
  since GPUIX exposes no clipboard API.
- **Keyboard defaults (gpuix 0.11)**: Tab/Shift+Tab move focus, and a
  `<textarea>` without `onSubmit` inserts a newline on Enter. Handlers that
  repurpose those keys (autocomplete, matched global hotkeys) call
  `event.preventDefault()`.
- **Text-editor focus tracking**: every `<input>`/`<textarea>` spreads
  `useTextInputFocusTracking()` (`state/focus.ts`) so global hotkeys and the
  window-level ESC skip while typing. Use the hook, not raw
  `trackTextInputFocus` — the hook also releases the counter when an editor
  unmounts while focused (dialogs closed by Enter/ESC), which would otherwise
  disable hotkeys for the rest of the session.

## Debug helpers

- `bun run qa:gui -- --timeout 30 --keep` — launch on a private Xvfb display
  inside Bubblewrap. The host compositor sockets, physical display cards,
  desktop bus, accounts, and network are unavailable to the test process.
  Missing isolation tools or failed guards abort before launching the app.
- `bun run qa:native` — run the reproducible native interaction checks in the
  same isolated display. No GUI test should use the physical desktop.
- `bun run qa:settings` — verify lazy settings, draft retention, save retries and
  saved-account actions with mock data on an isolated 680 × 820 display.
- Run a custom probe with `bun run qa:gui -- --keep -- bun scripts/probe.ts`.
  Successful temporary sessions are removed unless `--keep` or `--artifacts DIR`
  is supplied; failures retain their logs. `captureGuiQaDisplay()` from
  `services/gui-qa-screenshot.ts` captures only the private framebuffer.
- Linux rejects standalone `GPUIX_BACKGROUND=1` launches: `focus: false` alone
  does not provide compositor isolation. Use the QA launcher for agent tests.
- `TWIRCHAT_GPUIX_START_MAIN_TAB=platforms|settings` — boot onto a tab.
- `TWIRCHAT_GPUIX_START_TAB=<watchedChannelId>` — boot onto a watched tab.
- `TWIRCHAT_APP_VERSION=<x.y.z>` — override the dev version to exercise update
  and changelog flows (`dev` builds normally skip both).
- `TWIRCHAT_CHANGELOG_PREVIEW=1` — development only: always show the changelog
  modal for `TWIRCHAT_APP_VERSION` and never persist the seen version. The
  last successful GitHub response is cached in SQLite, so HMR remounts do not
  consume the unauthenticated GitHub API limit.
- `TWIRCHAT_RELEASE_NOTES_REFRESH=1` — with the preview flag, ignore the cached
  release notes and fetch GitHub again.
- `bun run qa:changelog` — boot the real app with a seeded previous version and
  a fixture GitHub release; asserts the changelog modal and captures it.
- `POST http://localhost:55824/dev/inject-chat` with a `NormalizedChatMessage`
  JSON body injects a fake chat message (dev only).
- GPUIX automation tree queries, bounds, clicks, wheel events, text input and
  key simulation run inside the QA command. Never point an automated launch
  or screenshot tool at the host display.
