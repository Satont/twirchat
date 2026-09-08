# TwirChat Desktop

GPUIX (React + GPUI) desktop application. Multi-platform chat aggregator for Twitch, YouTube, Kick.

## OVERVIEW

Single Bun process hosts everything: the backend logic (SQLite, platform
adapters, backend WS, OAuth, OBS overlay server) and the React UI rendered
natively by [GPUIX](https://gpuix.dev) (GPUI, Zed's GPU framework) — **no
webview, no DOM, no Electron**. The OBS overlay stays a Vue app (OBS needs
HTML) and is served by `src/overlay-server.ts`.

## STRUCTURE

```
src/
├── gpuix/                  # THE desktop app (React + GPUIX)
│   ├── main.tsx            # Entry: boots backend, render(<App/>)
│   ├── backend/            # In-process "RPC" bridge
│   │   ├── server.ts       # Boot: DB, adapters, WS, auth, overlay (globalThis singleton)
│   │   ├── api.ts          # DesktopApi — every request method (ex-Wails gateway)
│   │   ├── events.ts       # DesktopEventMap typed emitter
│   │   └── context.ts      # React: useBackend(), useBackendEvent()
│   ├── state/              # Observable stores (useSyncExternalStore)
│   │   ├── app.ts          # settings/accounts/messages/watched/emotes/notices…
│   │   ├── layout.ts       # Per-tab watched-channel split layouts
│   │   ├── caches.ts       # Avatar + mention-color session caches
│   │   ├── image-cache.ts  # Remote images → disk (GPUI can't fetch http on Linux)
│   │   ├── create-store.ts # Store factory (macrotask-deferred notifications!)
│   │   ├── focus.ts        # Text-editor focus tracking (hotkey suppression)
│   │   └── hotkeys.ts      # Global hotkeys (Ctrl+K, Ctrl+Tab…)
│   ├── components/         # React UI (ChatView, ChatMessage, panels, dialogs…)
│   ├── theme.ts / theme-context.ts  # Design tokens (ported CSS vars)
│   ├── icons.ts            # Monochrome SVG sources for <svg>
│   ├── message-tokens.ts   # Message → flex-wrap token list (emotes/links/mentions)
│   └── README.md           # Detailed GPUIX architecture + known limitations
├── store/                  # SQLite (bun:sqlite): accounts, settings, messages…
├── platforms/              # Twitch (twurple) / Kick (pusher) / YouTube (gRPC)
├── chat/aggregator.ts      # Dedup + 7TV enrichment
├── watched-channels/       # WatchedChannelManager (per-channel adapters)
├── seventv/                # 7TV emote service (via backend WS)
├── auth/                   # PKCE OAuth flows + local callback server
├── backend-connection.ts   # WS client to the backend service
├── overlay-server.ts       # OBS overlay HTTP+WS (port 45823)
├── shared/rpc.ts           # WebviewSender + history DTOs (legacy, small)
├── views/
│   ├── overlay/            # OBS overlay Vue app (vite build → dist/overlay)
│   ├── main/utils/         # Shared pure-TS utils (used by gpuix components)
│   └── shared/utils/       # messageParts / message-text / platform colors
└── runtime-config.ts       # Backend URLs, client secret, backendFetch
```

## WHERE TO LOOK

| Task                     | Location                                   | Notes                                |
| ------------------------ | ------------------------------------------ | ------------------------------------ |
| Add UI component         | `src/gpuix/components/`                    | Follow BRIEFING patterns in README   |
| Add backend API method   | `src/gpuix/backend/api.ts`                 | Mirror semantics of legacy handlers  |
| Add backend event        | `src/gpuix/backend/events.ts` + `server.ts`| Typed DesktopEventMap                |
| Change chat rendering    | `src/gpuix/components/ChatMessage.tsx`     | Token-based flex-wrap rows           |
| Change overlay           | `src/views/overlay/App.vue`                | OBS overlay (still Vue)              |
| DB schema change         | `src/store/db.ts`                          | Migrations in `initDb()`             |
| Platform adapter         | `src/platforms/{name}/adapter.ts`          | BasePlatformAdapter                  |

## COMMANDS

```bash
bun run dev           # bun --hot src/gpuix/main.tsx (remounts React on save)
bun run start         # plain run
bun run build         # overlay vite build + bun build --compile
bun run build:overlay # overlay only (dist/overlay, port 45823)
bun run typecheck     # tsc -p tsconfig.json && tsc -p tsconfig.gpuix.json
bun test tests/
```

Debug helpers: `GPUIX_BACKGROUND=1` (no focus steal), `TWIRCHAT_GPUIX_START_MAIN_TAB=…`,
`TWIRCHAT_GPUIX_START_TAB=…`, dev chat injection `POST :45824/dev/inject-chat`.

## CONVENTIONS

- **UI → backend only via the bridge** (`useBackend()` / stores fed by
  `wireBackendToStores`). Components never import `src/store` or adapters
  directly — same rule as the old webview RPC boundary, kept for portability.
- **No DOM APIs**: no localStorage (use `backend.api.getUiState/setUiState`),
  no navigator.clipboard (use `backend.api.copyText`), no document/window.
- **Store notifications are macrotask-deferred** (`create-store.ts`) — GPUI
  panics on reentrant view updates if a store triggers a sync render inside
  an event callback. Don't expect synchronous repaint after `.set()`.
- **Remote images** go through `ui/RemoteImage.tsx` (disk cache) — GPUI's
  Linux build can't load http(s).
- Format/lint: `bun run fix` (oxfmt + oxlint) after changes.

## ANTI-PATTERNS

- **NEVER** use HTTP polling for YouTube — gRPC only (`src/platforms/youtube/`)
- **DON'T** edit generated files: `src/platforms/youtube/gen/*`
- **DON'T** import Vue/reka-ui/pinia in gpuix code — the main window is React;
  Vue remains only in `src/views/overlay/`
- **DON'T** render remote URLs with plain `<img>` — use `<RemoteImage>`
- **DON'T** call store `.set()` inside a synchronous render path; the store
  handles deferred notification itself

See `src/gpuix/README.md` for the full architecture and known GPUIX limitations.
