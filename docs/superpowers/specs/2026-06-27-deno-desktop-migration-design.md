# TwirChat Desktop: Electrobun → Deno Desktop Migration

## Overview

Migrate `packages/desktop` from Electrobun (Bun + webview) to Deno Desktop (Deno + webview, no CEF). The Vue 3 frontend stays, the IPC layer changes from Electrobun RPC to Deno bindings + SSE, and Bun-specific APIs are replaced with Deno/Node equivalents.

## Decisions

| Decision       | Choice                           | Rationale                                                |
| -------------- | -------------------------------- | -------------------------------------------------------- |
| Backend engine | `webview` (OS native)            | Smaller binary, user accepted Linux limitations          |
| Monorepo       | Stay in monorepo as Deno project | Backend stays on Bun, shared package stays               |
| IPC push       | SSE via Deno.serve               | Deno bindings are request/response only; SSE is standard |
| Overlay server | Embedded Deno.serve              | Same process, no extra management                        |
| Frontend build | Keep Vite + @vitejs/plugin-vue   | Deno Desktop auto-detects Vite, minimal changes          |
| SQLite         | `node:sqlite` (DatabaseSync)     | Nearly identical API to `bun:sqlite`                     |
| Auto-update    | `Deno.autoUpdate()`              | Built-in bsdiff patches with rollback                    |

## Architecture

### Current (Electrobun)

```
src/bun/index.ts          — Bun main process (BrowserWindow, defineElectrobunRPC)
src/shared/rpc.ts         — TwirChatRPCSchema (typed RPC contract)
src/views/main/main.ts    — Electroview.defineRPC + Vue mount
src/overlay-server.ts     — Bun.serve (overlay HTTP + WS on port 45823)
src/auth/server.ts        — Bun.serve (OAuth callbacks on port 45821)
src/store/db.ts           — bun:sqlite Database
src/backend-connection.ts — WebSocket to backend
```

### Target (Deno Desktop)

```
src/main.ts               — Deno main process (Deno.BrowserWindow, win.bind, Deno.serve ×3)
src/bindings.ts           — Binding definitions + type contract (replaces rpc.ts)
src/event-bus.ts          — SSE push helper (subscribers + pushEvent)
src/views/main/main.ts    — bindings.* + EventSource + Vue mount
src/overlay-server.ts     — Deno.serve on port 45823 (overlay HTML + WS)
src/auth/server.ts        — Deno.serve on port 45821 (OAuth callbacks)
src/store/db.ts           — node:sqlite DatabaseSync
src/backend-connection.ts — WebSocket to backend (mostly unchanged)
```

Three Deno.serve listeners:

- **Main** (auto-bound to webview): binding routes, SSE `/api/events`
- **Overlay** (port 45823): overlay HTML/assets, overlay WS for OBS
- **Auth** (port 45821): OAuth callbacks from browser redirects

## IPC Design

### Request/Response: Deno bindings

Replace `defineElectrobunRPC` with `win.bind()`:

```ts
// Deno side (src/main.ts)
win.bind('getAccounts', () => AccountStore.findAll())
win.bind('getSettings', () => SettingsStore.get())
win.bind('saveSettings', (s) => SettingsStore.set(s))
// ... all current RPC requests

// Webview side (src/views/main/)
const accounts = await bindings.getAccounts()
```

Shared type contract in `src/bindings.ts`:

```ts
export interface AppBindings {
  getAccounts(): Promise<Account[]>
  getSettings(): Promise<AppSettings>
  saveSettings(s: AppSettings): Promise<void>
  // ... all methods
}

declare global {
  const bindings: AppBindings
}
```

### Push Events: SSE

Deno bindings have no push mechanism. Use SSE on the local Deno.serve:

```ts
// Deno side — push helper
const subscribers = new Set<ReadableStreamDefaultController>()
function pushEvent(type: string, data: unknown) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  for (const ctrl of subscribers) {
    try {
      ctrl.enqueue(encoder.encode(msg))
    } catch {
      subscribers.delete(ctrl)
    }
  }
}

// Route: GET /api/events → SSE stream
```

```ts
// Webview side — EventSource
const events = new EventSource('/api/events')
events.addEventListener('chat_message', (e) => {
  const msg = JSON.parse(e.data)
  messages.value.push(msg)
})
```

This replaces both Electrobun's `sendToView.*` and the overlay WS push — everything goes through Deno.serve.

### Overlay

The overlay server stays on port 45823 (OBS is configured to connect there). It becomes a second `Deno.serve` instance dedicated to overlay traffic:

```ts
// Overlay: separate Deno.serve on port 45823
Deno.serve({ port: OVERLAY_SERVER_PORT }, (req) => {
  // Serve overlay HTML, assets, fonts
  // WebSocket upgrade for push messages
})
```

The main Deno.serve (auto-bound to the webview) handles bindings routes + auth callbacks + SSE. The overlay server is a standalone listener for OBS browser sources. This keeps the OBS URL unchanged: `http://localhost:45823/?bg=transparent`.

WebSocket for overlay changes from Bun's `ServerWebSocket` to standard `Deno.upgradeWebSocket()`.

## SQLite Migration

`bun:sqlite` → `node:sqlite` (DatabaseSync). API mapping:

| bun:sqlite                             | node:sqlite                   |
| -------------------------------------- | ----------------------------- |
| `new Database(path, { create: true })` | `new DatabaseSync(path)`      |
| `db.run(sql)`                          | `db.exec(sql)`                |
| `db.query(sql).all()`                  | `db.prepare(sql).all()`       |
| `db.query(sql).get()`                  | `db.prepare(sql).get()`       |
| `db.run(sql, params)`                  | `db.prepare(sql).run(params)` |

All store files (`account-store.ts`, `settings-store.ts`, `channel-store.ts`, `message-store.ts`, `user-alias-store.ts`, `watched-channels-store.ts`, `watched-channels-layout-store.ts`, `chat-layout-store.ts`, `username-color-cache.ts`) need mechanical migration.

## Runtime Config

Replace `BuildConfig.get()` (Electrobun) with `Deno.env` + deno.json:

```ts
// Current: const buildConfig = await BuildConfig.get()
// Target:  const backendUrl = Deno.env.get('CHATRIX_BACKEND_URL') ?? 'http://127.0.0.1:3000'
```

`process.env` → `Deno.env.get()` / `Deno.env.set()`.
`process.title` → `Deno.env.set()` or remove (not available in Deno).

## Auth Server

Currently a separate `Bun.serve` on port 45821. In Deno Desktop, run as a third `Deno.serve` on port 45821 (keep the port stable since OAuth redirect URIs are registered with this port):

```ts
Deno.serve({ port: AUTH_SERVER_PORT }, async (req) => {
  const url = new URL(req.url)
  if (url.pathname === '/auth/twitch/callback') {
    /* ... */
  }
  // ...
})
```

The `sendToView.auth_success()` push becomes `pushEvent('auth_success', ...)` via the event bus (SSE).

Total listeners in the process:

- **Main** (auto-bound to webview): bindings routes, SSE event stream
- **Overlay** (port 45823): overlay HTML/assets, overlay WS
- **Auth** (port 45821): OAuth callbacks

## Auto-Update

Replace Electrobun `Updater` with `Deno.autoUpdate()`:

```ts
Deno.autoUpdate({
  interval: 60 * 60 * 1000,
  onUpdateReady(version) {
    pushEvent('update_status', { status: 'ready', version })
  },
  onRollback(reason) {
    pushEvent('update_status', { status: 'rollback', reason })
  },
})
```

Requires `desktop.release.baseUrl` in deno.json and a `version` field.
The manifest format changes from full-binary downloads to bsdiff patches (`latest.json` with per-version patches).

## Deno.json Config

```jsonc
{
  "name": "@twirchat/desktop",
  "version": "0.0.1",
  "desktop": {
    "app": {
      "name": "TwirChat",
      "identifier": "dev.twirchat.app",
      "icons": {
        "macos": "./assets/icon.icns",
        "windows": "./assets/icon.ico",
        "linux": "./assets/icon.png",
      },
    },
    "backend": "webview",
    "output": {
      "macos": "./dist/TwirChat.app",
      "windows": "./dist/TwirChat",
      "linux": "./dist/twirchat",
    },
    "release": {
      "baseUrl": "https://github.com/Satont/twirchat/releases/latest/download/",
    },
  },
  "imports": {
    "@twirchat/shared": "../shared/index.ts",
    "@twirchat/shared/": "../shared/",
  },
}
```

## Frontend Changes

### Minimal changes needed

The Vue 3 components don't need structural changes. The migration is mechanical:

1. **Replace `rpc.request.*` → `bindings.*`**: Every Pinia store and component that calls `rpc.request.getAccounts()` becomes `bindings.getAccounts()`. Same async/await pattern.

2. **Replace `useRpcListener` → EventSource**: The composable changes from Electrobun's `addMessageListener` to standard `EventSource`:

```ts
// Before
useRpcListener('chat_message', (msg) => {
  messages.value.push(msg)
})

// After
const events = new EventSource('/api/events')
events.addEventListener('chat_message', (e) => {
  messages.value.push(JSON.parse(e.data))
})
```

3. **Remove `waitForSocket()`**: Electrobun-specific socket wait logic is unnecessary with Deno bindings.

4. **Remove `Electroview` imports**: No more `electrobun/view`.

### Files to change in `src/views/main/`

| File                            | Change                                                 |
| ------------------------------- | ------------------------------------------------------ |
| `main.ts`                       | Remove Electroview, use bindings + EventSource         |
| `composables/useRpcListener.ts` | Rewrite to use EventSource                             |
| `stores/accounts.ts`            | `rpc.request.getAccounts()` → `bindings.getAccounts()` |
| `stores/settings.ts`            | Same pattern                                           |
| `stores/channelStatus.ts`       | Same pattern                                           |
| `stores/streamStatus.ts`        | Same pattern                                           |
| `stores/useAliasStore.ts`       | Same pattern                                           |
| `stores/emoteStore.ts`          | Same pattern                                           |
| `stores/layout.ts`              | Same pattern                                           |
| `App.vue`                       | Replace rpc._ calls with bindings._                    |
| All components using rpc        | Mechanical replacement                                 |

## Files Removed

| File                   | Reason                              |
| ---------------------- | ----------------------------------- |
| `electrobun.config.ts` | Replaced by deno.json desktop block |
| `src/shared/rpc.ts`    | Replaced by src/bindings.ts         |
| `src/bun/` directory   | Entry point moves to src/main.ts    |
| `package.json`         | Replaced by deno.json               |

## Files Kept (with modifications)

| File                         | Changes                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `src/store/*.ts`             | `bun:sqlite` → `node:sqlite`                                                            |
| `src/auth/*.ts`              | `Bun.serve` → `Deno.serve` on port 45821                                                |
| `src/overlay-server.ts`      | `Bun.serve` → `Deno.serve` on port 45823, `ServerWebSocket` → `Deno.upgradeWebSocket()` |
| `src/backend-connection.ts`  | Minimal: WebSocket API is standard                                                      |
| `src/platforms/**/*.ts`      | Minimal: mostly standard WS/HTTP                                                        |
| `src/chat/aggregator.ts`     | No changes (pure logic)                                                                 |
| `src/seventv/`               | No changes (pure logic + WS)                                                            |
| `src/watched-channels/`      | No changes (uses adapters)                                                              |
| `src/views/` (all Vue files) | Mechanical rpc→bindings replacement                                                     |
| `vite.main.config.ts`        | Keep as-is for `vite build`                                                             |
| `vite.overlay.config.ts`     | Keep as-is for `vite build`                                                             |

## New Files

| File               | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `deno.json`        | Project config + desktop block            |
| `src/main.ts`      | Deno main process entry                   |
| `src/bindings.ts`  | Shared binding type contract              |
| `src/event-bus.ts` | SSE push helper (subscribers + pushEvent) |

## Dev Workflow

```bash
# Development with HMR (Vite dev server + Deno runtime hot-swap)
deno desktop --hmr .

# Production build
deno desktop .

# Type check
deno check src/main.ts
```

Vite detection is automatic: `vite.config.*` present → Deno runs Vite dev server under `--hmr`, serves `dist/` in production.

## Risks

1. **node:sqlite API differences**: `prepare()` vs `query()` is mechanical but error-prone. Test each store.
2. **SSE reconnection**: EventSource auto-reconnects, but need to handle missed events during disconnect.
3. **Deno.autoUpdate() Windows**: Patches are downloaded but not applied on Windows yet (Deno limitation). Need alternative update strategy for Windows.
4. **npm compatibility**: `@twurple/*`, `youtubei.js`, `@bufbuild/protobuf` need to work under Deno. Most npm packages work via `npm:` specifiers.
5. **Overlay port conflict**: Currently separate Bun.serve on 45823. If merged into main Deno.serve, OBS URL changes. May need to keep separate listener.
