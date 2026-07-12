# TwirChat Desktop

Electrobun + Vue 3 desktop application. Multi-platform chat aggregator for Twitch, YouTube, Kick.

## OVERVIEW

Desktop app with two view targets: main window (Electrobun webview) and overlay (OBS browser source). Main process runs Bun; views are Vue 3 SFCs built with Vite.

## STRUCTURE

```
src/
├── bun/index.ts              # Electrobun main process entry
├── index.ts                  # Alternate entry (legacy)
├── views/
│   ├── main/                 # Main window Vue app
│   │   ├── main.ts          # Webview entry (Electroview RPC + Vue mount)
│   │   ├── App.vue          # Root component
│   │   └── components/      # ChatList, ChatMessage, Sidebar
│   └── overlay/             # OBS overlay Vue app
│       ├── main.ts          # Overlay entry (WS client, no Electrobun)
│       └── App.vue
├── shared/rpc.ts            # TwirChatRPCSchema + WebviewSender types
├── overlay-server.ts        # Bun.serve: serves overlay + WS push
├── backend-connection.ts    # WS client to backend
├── store/                   # SQLite (bun:sqlite)
│   ├── db.ts               # DB init + migrations
│   ├── account-store.ts    # Encrypted tokens
│   ├── settings-store.ts   # App settings
│   └── client-secret.ts    # Generated client secret
├── chat/
│   └── aggregator.ts       # Message dedup + routing
├── platforms/              # Platform adapters
│   ├── base-adapter.ts     # BasePlatformAdapter interface
│   ├── twitch/adapter.ts   # Twurple client
│   ├── kick/adapter.ts     # Pusher WS
│   └── youtube/adapter.ts  # youtubei.js (Innertube)
└── auth/                   # OAuth flows
    ├── server.ts           # Local PKCE callback server
    └── pkce.ts             # PKCE helpers
```

## WHERE TO LOOK

| Task                 | Location                                 | Notes                             |
| -------------------- | ---------------------------------------- | --------------------------------- |
| Add platform adapter | `src/platforms/{name}/adapter.ts`        | Extend BasePlatformAdapter        |
| Register adapter     | `src/bun/index.ts`                       | Add to `adapterRegistry`          |
| Add RPC method       | `src/shared/rpc.ts` + `src/bun/index.ts` | Update schema + implement handler |
| Change main UI       | `src/views/main/components/*.vue`        | Vue SFC components                |
| Change overlay       | `src/views/overlay/App.vue`              | OBS overlay display               |
| Fix auth flow        | `src/auth/server.ts`                     | PKCE callback handling            |
| DB schema change     | `src/store/db.ts`                        | Run migrations in `initDb()`      |
| Add overlay message  | `src/overlay-server.ts`                  | `pushOverlayMessage()`            |

## ENTRY POINTS

| File                        | Purpose                 | When It Runs                     |
| --------------------------- | ----------------------- | -------------------------------- |
| `src/bun/index.ts`          | Electrobun main process | Production & `bun run start`     |
| `src/views/main/main.ts`    | Main window webview     | HMR dev (port 5173) or built     |
| `src/views/overlay/main.ts` | Overlay webview         | Built + served by overlay-server |
| `src/overlay-server.ts`     | Overlay HTTP+WS server  | Started from bun/index.ts        |

## CONVENTIONS

**Electrobun RPC**

- Schema defined in `src/shared/rpc.ts`
- Bun side: `defineElectrobunRPC<TwirChatRPCSchema>("bun", { handlers: { requests: {...} }})`
- View side: `Electroview.defineRPC<TwirChatRPCSchema>()`
- Cast workaround: `const sendToView = rpc.send as unknown as WebviewSender`

**Platform Adapters**

```typescript
class MyAdapter extends BasePlatformAdapter {
  readonly platform = 'myplatform' as const

  async connect(channelSlug: string): Promise<void> {
    // Connect to platform
    this.emit('status', { platform: this.platform, state: 'connected' })
  }

  async disconnect(): Promise<void> {}

  async sendMessage(channelId: string, text: string): Promise<void> {
    // Optional: implement sending
  }
}
```

**Error Handling**

```typescript
// Log and rethrow for RPC handlers
try {
  const result = await fetchData()
  return result
} catch (err) {
  log.error('Failed to fetch', { error: String(err) })
  throw err // Let RPC catch and return error
}

// Fire-and-forget background tasks
void backgroundTask().catch((e) => log.error('Task failed', { error: String(e) }))
```

**Type Checking**

- Use `vue-tsc --noEmit` (NOT `tsgo`) for Vue SFC compatibility
- Configured in `package.json` script

## RPC Architecture

TwirChat desktop uses Electrobun RPC for all communication between the main process (Bun) and the webview (browser context).

### Core Rule

**NEVER import Bun modules into frontend code. Always use RPC for persistence and server-side operations.**

**Forbidden in frontend (`src/views/`):**

- `bun:sqlite` - Use RPC `get*`, `set*` methods instead
- `node:fs` - Use RPC for file operations
- Direct store imports from `src/store/` - These use SQLite via Bun

**Correct approach:**

```typescript
// ❌ WRONG - This will crash the browser
import { ChatLayoutStore } from '../../store/chat-layout-store'
const layout = ChatLayoutStore.get()

// ✅ CORRECT - Use RPC
const layout = await rpc.request.getWatchedChannelsLayout()
```

### Why This Rule Exists

The desktop app has two distinct runtime environments:

1. **Main process** (`src/bun/`): Full Bun/Node.js access, SQLite, file system
2. **Webview** (`src/views/`): Browser context, no Bun APIs

Vite can bundle code, but Bun modules like `bun:sqlite` will throw runtime errors in the browser.

### Pattern: Server-Side Store + RPC

For any new persistence feature:

1. **Create server-side store** (`src/store/*-store.ts`):
   - Uses `bun:sqlite` via `getDb()`
   - Exported functions for CRUD operations

2. **Add RPC methods** (`src/shared/rpc.ts` + `src/bun/index.ts`):
   - Define request types in RPC schema
   - Implement handlers in bun/index.ts using server-side store

3. **Use in frontend** (`src/views/main/*.vue`):
   - Call `rpc.request.*` methods
   - Store data in reactive refs/composables
   - Never import server-side stores directly

## ANTI-PATTERNS (THIS PACKAGE)

- **NEVER** use HTTP polling for YouTube — use gRPC only (see `src/platforms/youtube/`)
- **DON'T** edit generated files: `src/platforms/youtube/gen/*` — change proto and regenerate
- **DON'T** use `defineElectrobunRPC` from `electrobun/view` — use `Electroview.defineRPC`
- **AVOID** synchronous crypto for tokens — use async AES-GCM (see crypto.ts notes)
- **DON'T** remove `waitForSocket()` in `main.ts` — prevents RPC timeout on startup

## COMMANDS

```bash
# Development with HMR (Vite dev server + Electrobun)
bun run dev:hmr

# Production build
bun run build:prod

# Type check only
bun run typecheck

# Run tests
bun test tests/

# Generate YouTube protobuf types
cd src/platforms/youtube && bunx @bufbuild/buf generate
```

## NOTES

**Overlay Server**

- Runs on `OVERLAY_SERVER_PORT` (45823)
- OBS URL: `http://localhost:45823/?bg=transparent&fontSize=14`
- Built files served from `dist/overlay/` (no HMR)

**Client Secret**

- Generated on first launch, stored in `client-secret.ts`
- Sent to backend via `X-Client-Secret` header
- Partial logging: `secret.slice(0, 8)` for debugging

**Platform-Specific**

- Linux: CEF bundling required (WebKitGTK lacks crypto.subtle)
- YouTube: Requires authentication (no anonymous mode currently)

## DEPENDENCIES

Key dependencies and why:

- `electrobun` - Desktop framework (Bun + Webview)
- `vue` - UI framework
- `@twurple/*` - Twitch API/chat
- `youtubei.js` - YouTube Innertube API
- `@bufbuild/protobuf` - YouTube gRPC
- `reka-ui` - Vue UI primitives

See root AGENTS.md for Bun-first API guidelines.
