## Code Formatting and Linting

This project uses **oxlint** (linter) and **oxfmt** (formatter) from the Oxc toolchain.

### Configuration

- **Linter config**: `.oxlintrc.json`
- **Formatter config**: `.oxfmtrc.json`
- **Format rules**: max 100 chars per line, no semicolons, single quotes, sorted imports

### Scripts

```bash
bun run lint          # Check for lint errors
bun run lint:fix      # Fix auto-fixable lint issues
bun run format        # Format all files
bun run format:check  # Check formatting without modifying
bun run check         # Run typecheck + lint + format check
bun run fix           # Fix lint and format issues
```

### IMPORTANT: Format After Changes

**ALWAYS run `bun run fix` after creating or modifying files.**

Before declaring any task complete:

1. Run `bun run fix` to auto-format and fix lint issues
2. Verify no lint errors remain: `bun run lint`
3. Verify no type errors: `bun run typecheck`

### Editor Integration

**VSCode**: Extension `oxc.oxc-vscode` — auto-format and fix on save enabled
**Zed**: Extension "Oxc" — configured in `.zed/settings.json`
**JetBrains**: Plugin "Oxc" — external tools configured in `.idea/`

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

---

## Project: TwirChat

Мультиплатформенный менеджер чата для стримеров (Twitch, YouTube, Kick).
Desktop-приложение + backend. Monorepo на Bun + TypeScript.

### Стек

- **Runtime**: Bun
- **Monorepo**: bun workspaces — `packages/desktop`, `packages/backend`, `packages/shared`
- **Desktop**: GPUIX v0.7 (React + GPUI, Zed's GPU framework — **без webview, без DOM**, один Bun-процесс)
  - OBS overlay остаётся Vue 3 SFC через Vite (OBS browser source рендерит HTML)
- **Backend**: Bun (REST API + WebSocket + gRPC клиенты)
- **Проверка типов**:
  - **Backend**: `tsgo --noEmit` (`@typescript/native-preview`)
  - **Desktop**: `tsc --noEmit` (`tsconfig.json` + `tsconfig.gpuix.json` с `jsxImportSource: @gpuix/react`)
- **НЕ использовать** HTTP polling для YouTube — только gRPC

### Архитектура `packages/desktop`

Desktop — один Bun-процесс: бэкенд-логика + React-UI через GPUIX:

```
src/gpuix/main.tsx        — entry: boot backend + render(<App/>) (bun --hot)
src/gpuix/backend/        — in-process «RPC» bridge: server.ts (boot), api.ts (DesktopApi),
                            events.ts (DesktopEventMap), context.ts (useBackend/useBackendEvent)
src/gpuix/state/          — observable stores (create-store на useSyncExternalStore),
                            layout, caches, image-cache (GPUI не качает http на Linux), hotkeys
src/gpuix/components/     — React UI (ChatView, ChatMessage, panels, dialogs, ui primitives)
src/store/                — SQLite (bun:sqlite), accounts, settings, crypto
src/chat/aggregator.ts    — дедупликация/агрегация сообщений
src/platforms/            — адаптеры Twitch / YouTube (gRPC) / Kick
src/auth/                 — PKCE OAuth, Twitch, YouTube, Kick, локальный HTTP сервер
src/backend-connection.ts — WS клиент к backend-сервису
src/overlay-server.ts     — Bun.serve: раздаёт dist/overlay/ + WebSocket для OBS
src/views/overlay/        — Vue app OBS overlay (vite build → dist/overlay/)
src/views/main/utils/     — чистые TS утилиты (шарятся gpuix-компонентами)
vite.overlay.config.ts    — Vite конфиг для src/views/overlay/ → dist/overlay/
```

### Архитектура `packages/backend`

Backend — Bun HTTP/WebSocket сервер:

```
src/index.ts              — Bun.serve: HTTP routes + WebSocket upgrade
src/config.ts             — Environment config (PORT, DATABASE_URL, etc.)
src/db/                   — SQLite database layer
  ├── index.ts            — Database connection
  ├── store.ts            — Data access layer
  └── migrations.ts       — Schema migrations
src/auth/                 — OAuth + platform auth
  ├── pkce.ts             — PKCE flow helpers
  ├── twitch.ts           — Twitch OAuth
  ├── youtube.ts          — YouTube OAuth
  ├── kick.ts             — Kick OAuth
  ├── kick-webhook.ts     — Kick webhook handlers
  └── kick-subscriptions.ts — Kick EventSub subscriptions
src/api/                  — External API clients
  ├── channels-status.ts  — Check channel live status
  ├── kick-chatroom.ts    — Kick chatroom integration
  ├── search-categories.ts — Twitch category search
  ├── stream-status.ts    — Stream status aggregation
  ├── twitch-badges.ts    — Twitch badge fetching
  └── update-stream.ts    — Stream metadata updates
src/routes/               — HTTP route handlers
  ├── accounts.ts         — Account management
  ├── auth.ts             — OAuth callbacks
  ├── stream.ts           — Stream endpoints
  ├── webhooks.ts         — Platform webhooks
  └── utils.ts            — Route utilities
src/ws/                   — WebSocket handling
  ├── connection-manager.ts — WS connection lifecycle
  └── handlers.ts         — WS message handlers
```

### Delivery overlay

Overlay **не** имеет HMR и **не** запускает отдельный Vite сервер.

- `vite build --config vite.overlay.config.ts` собирает в `dist/overlay/`
- `overlay-server.ts` раздаёт `dist/overlay/index.html` и `dist/overlay/assets/*` через `Bun.file()`
  на порту 45823 вместе с WebSocket для push сообщений
- OBS URL: `http://localhost:45823/?bg=transparent&fontSize=14&...`

### Delivery main window (GPUIX)

- `bun run dev` = `bun --hot src/gpuix/main.tsx` — сохранение файла ремаунтит React на том же окне;
  бэкенд-синглтон на `globalThis` переживает ремаунт (соединения не рвутся)
- Окно создаётся `render(<App/>, {...})` в `src/gpuix/main.tsx`; продакшен-бинарь:
  `bun build --compile src/gpuix/main.tsx`

### Скрипты `packages/desktop`

```json
"dev"           : "bun --hot src/gpuix/main.tsx"
"start"         : "bun src/gpuix/main.tsx"
"build"         : "bun run build:overlay && bun build --compile src/gpuix/main.tsx --outfile dist/twirchat"
"build:overlay" : "vite build --config vite.overlay.config.ts"
"typecheck"     : "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.gpuix.json"
"test"          : "bun test tests/"
```

### Скрипты `packages/backend`

```json
"dev"         : "bun --hot src/index.ts"
"start"       : "bun src/index.ts"
"typecheck"   : "tsgo --noEmit"
"test"        : "bun test tests/"
```

### GPUIX bridge паттерн (замена RPC)

GPUIX не имеет второго процесса, поэтому RPC-мост — это in-process фасад с той же
формой, что был у Wails/Electrobun gateway:

```typescript
// src/gpuix/backend/server.ts — boot один раз на процесс (globalThis singleton)
const backend = getDesktopBackend() // { api, events }

// src/gpuix/backend/api.ts — методы запросов (как старый desktopApi.request.*)
await backend.api.getAccounts()
await backend.api.sendMessage({ platform, channelId, text })

// src/gpuix/backend/context.ts — React-привязка
const backend = useBackend()
useBackendEvent('chat_message', (msg) => { ... })

// src/gpuix/state/* — stores на useSyncExternalStore; UI не импортирует
// src/store / адаптеры напрямую — только фасад (граница «как RPC»).
```

### Важные находки

- `bun-plugin-vue` v1.0.0 на npm — пустой placeholder, бесполезен
- **GPUI reentrancy**: `useSyncExternalStore` рендерит синхронно → store-нотификации
  откладываются в `setTimeout(0)` (см. `state/create-store.ts`), иначе паника
  «cannot update GpuixView while it is already being updated» при рендере из event callback
- **GPUIX на Linux не грузит http(s) картинки** (asset_cache открывает URL как файл) —
  все remote-изображения через `state/image-cache.ts` + `<RemoteImage>`
- **Upstream-баг gpuix 0.7.0**: automation `click()` на Linux паникует в `dispatch_mouse_up`;
  реальный ввод не затронут, клавиатурная автоматизация работает
- `import.meta.dir` в `overlay-server.ts` указывает на `src/` → `dist/overlay/` находится через `join(import.meta.dir, "..", "dist", "overlay")`
- Детали и остальные ограничения GPUIX — в `packages/desktop/src/gpuix/README.md`

### Файловая структура

```
/home/satont/Projects/twirchat/
├── AGENTS.md
├── package.json                          ← monorepo root
├── .zed/
│   └── settings.json                     ← Zed editor LSP config
└── packages/
    ├── shared/
    │   ├── types.ts                      ← NormalizedChatMessage, NormalizedEvent, Account, AppSettings, Platform, ...
    │   ├── constants.ts                  ← OVERLAY_SERVER_PORT=45823
    │   ├── protocol.ts                   ← BackendToDesktopMessage / DesktopToBackendMessage
    │   └── index.ts
    ├── backend/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts                  ← Bun.serve entry point
    │       ├── config.ts                 ← Environment configuration
    │       ├── db/
    │       │   ├── index.ts              — Database connection
    │       │   ├── store.ts              — Data access layer
    │       │   └── migrations.ts         — Schema migrations
    │       ├── auth/
    │       │   ├── pkce.ts               — PKCE helpers
    │       │   ├── twitch.ts             — Twitch OAuth
    │       │   ├── youtube.ts            — YouTube OAuth
    │       │   ├── kick.ts               — Kick OAuth
    │       │   ├── kick-webhook.ts       — Kick webhook handlers
    │       │   └── kick-subscriptions.ts — Kick EventSub
    │       ├── api/
    │       │   ├── channels-status.ts    — Channel status checks
    │       │   ├── kick-chatroom.ts      — Kick chatroom
    │       │   ├── search-categories.ts  — Twitch categories
    │       │   ├── stream-status.ts      — Stream aggregation
    │       │   ├── twitch-badges.ts      — Twitch badges
    │       │   └── update-stream.ts      — Stream updates
    │       ├── routes/
    │       │   ├── accounts.ts           — Account endpoints
    │       │   ├── auth.ts               — OAuth callbacks
    │       │   ├── stream.ts             — Stream endpoints
    │       │   ├── webhooks.ts           — Platform webhooks
    │       │   └── utils.ts              — Route utilities
    │       └── ws/
    │           ├── connection-manager.ts — WS lifecycle
    │           └── handlers.ts           — WS handlers
    └── desktop/
        ├── package.json
        ├── tsconfig.json                   ← src/** (без gpuix)
        ├── tsconfig.gpuix.json             ← jsxImportSource: @gpuix/react
        ├── vite.overlay.config.ts          ← root: src/views/overlay, outDir: dist/overlay
        ├── tests/                          ← bun test (TS-модули + gpuix)
        └── src/
            ├── gpuix/                      ← DESKTOP APP (React + GPUIX)
            │   ├── main.tsx                ← entry: boot + render(<App/>)
            │   ├── backend/                ← server.ts (boot) / api.ts / events.ts / context.ts
            │   ├── state/                  ← stores, layout, caches, image-cache, hotkeys
            │   ├── components/             ← ChatView, ChatMessage, panels, dialogs, ui/
            │   ├── theme.ts, icons.ts, message-tokens.ts
            │   └── README.md               ← архитектура + ограничения
            ├── shared/
            │   └── rpc.ts                  ← WebviewSender + history DTOs (small, legacy)
            ├── views/
            │   ├── main/utils/             ← чистые TS утилиты
            │   ├── shared/utils/           ← messageParts / message-text / platform
            │   └── overlay/                ← OBS overlay (Vue)
            ├── overlay-server.ts           ← Bun.serve: dist/overlay/ + WS push на порту 45823
            ├── backend-connection.ts       ← WS клиент к backend
            ├── store/
            │   ├── db.ts
            │   ├── client-secret.ts
            │   ├── account-store.ts
            │   ├── settings-store.ts
            │   ├── crypto.ts
            │   └── index.ts
            ├── chat/
            │   └── aggregator.ts
            ├── platforms/
            │   ├── base-adapter.ts
            │   ├── kick/adapter.ts
            │   ├── twitch/adapter.ts
            │   └── youtube/adapter.ts
            └── auth/
                ├── pkce.ts
                ├── kick.ts
                ├── twitch.ts
                ├── youtube.ts
                ├── server.ts
                └── index.ts
```
