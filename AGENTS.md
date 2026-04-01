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
- **Desktop**: Electrobun v1.16.0 (`electrobun/bun` main process, `electrobun/view` browser side)
  - **Frontend**: Vue 3 SFC через Vite + `@vitejs/plugin-vue`
  - Desktop приложение — это Electrobun wrapper вокруг Vue-приложения
- **Backend**: Bun (REST API + WebSocket + gRPC клиенты)
- **Проверка типов**:
  - **Backend**: `tsgo --noEmit` (`@typescript/native-preview`)
  - **Frontend**: `vue-tsc --noEmit` (обычный TypeScript + Vue Language Tools)
- **НЕ использовать** HTTP polling для YouTube — только gRPC

### Архитектура `packages/desktop`

Desktop — это Electrobun приложение с Vue 3 фронтендом:

```
src/bun/index.ts          — Electrobun main process (BrowserWindow, RPC, backend WS)
src/shared/rpc.ts         — TwirChatRPCSchema + WebviewSender (общий тип для обеих сторон)
src/views/main/           — Vue app главного окна (собирается Vite → dist/main/)
src/views/overlay/        — Vue app OBS overlay (собирается Vite → dist/overlay/)
src/overlay-server.ts     — Bun.serve: раздаёт dist/overlay/ + WebSocket для OBS
src/store/                — SQLite (bun:sqlite), accounts, settings, crypto
src/chat/aggregator.ts    — дедупликация/агрегация сообщений
src/platforms/            — адаптеры Twitch / YouTube (gRPC) / Kick
src/auth/                 — PKCE OAuth, Twitch, YouTube, Kick, локальный HTTP сервер
src/backend-connection.ts — WS клиент к backend-сервису
electrobun.config.ts      — app meta + build.bun entrypoint + build.copy (dist/ → views://)
vite.main.config.ts       — Vite конфиг для src/views/main/ → dist/main/
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

### Delivery main window (HMR)

- `dev:hmr` запускает Vite dev server (`hmr:main` на порту 5173) + `start` (bun process)
- `src/bun/index.ts` при старте проверяет `http://localhost:5173` — если доступен, открывает его
- В продакшене открывает `views://main/index.html` (electrobun copy из `dist/main/`)

### Скрипты `packages/desktop`

```json
"dev"         : "bun run build:views && electrobun dev"
"dev:hmr"     : "concurrently \"bun run hmr:main\" \"bun run start\""
"hmr:main"    : "vite --config vite.main.config.ts --port 5173"
"start"       : "bun src/bun/index.ts"
"build:views" : "vite build --config vite.main.config.ts && vite build --config vite.overlay.config.ts"
"build"       : "bun run build:views && electrobun build"
"typecheck"   : "vue-tsc --noEmit"  // для frontend
"test"        : "bun test tests/"
```

### Скрипты `packages/backend`

```json
"dev"         : "bun --hot src/index.ts"
"start"       : "bun src/index.ts"
"typecheck"   : "tsgo --noEmit"
"test"        : "bun test tests/"
```

### Electrobun RPC паттерн

```typescript
// src/shared/rpc.ts — схема
import type { RPCSchema } from "electrobun/bun";
export type TwirChatRPCSchema = {
  bun: RPCSchema<{ requests: BunRequests; messages: BunMessages }>;
  webview: RPCSchema<{ requests: WebviewRequests; messages: WebviewMessages }>;
};
export type WebviewSender = { [K in keyof WebviewMessages]: (payload: WebviewMessages[K]) => void };

// src/bun/index.ts (main process)
import { BrowserWindow, defineElectrobunRPC } from "electrobun/bun";
const rpc = defineElectrobunRPC<TwirChatRPCSchema>("bun", { handlers: { requests: {...} } });
const sendToView = rpc.send as unknown as WebviewSender; // cast нужен из-за TS inference бага
const win = new BrowserWindow({ url: windowUrl, rpc });

// src/views/main/main.ts (webview side)
import { Electroview } from "electrobun/view";
export const rpc = Electroview.defineRPC<TwirChatRPCSchema>({ handlers: { requests: {}, messages: {} } });
new Electroview({ rpc });
createApp(App).mount("#app");
// В компонентах: rpc.send.getAccounts(), rpc.on.chat_message(handler)
```

### Важные находки

- `bun-plugin-vue` v1.0.0 на npm — пустой placeholder, бесполезен
- `defineElectrobunRPC` **не** экспортируется из `electrobun/view` — нужен `Electroview.defineRPC`
- `rpc.send` на bun-стороне не резолвится через TS proxy → cast через `WebviewSender`
- `skipLibCheck` не работает в `tsgo` для transitive deps (electrobun тащит `three` без типов — upstream баг)
- `import.meta.dir` в `overlay-server.ts` указывает на `src/` → `dist/overlay/` находится через `join(import.meta.dir, "..", "dist", "overlay")`
- **Frontend type checking**: используй `vue-tsc` (обычный TypeScript), НЕ `tsgo` — Vue SFC требуют Vue Language Tools

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
        ├── tsconfig.json
        ├── electrobun.config.ts          ← app meta + bun entrypoint + copy dist/ → views://
        ├── vite.main.config.ts           ← root: src/views/main, outDir: dist/main
        ├── vite.overlay.config.ts        ← root: src/views/overlay, outDir: dist/overlay (без dev server)
        ├── index.ts                      ← monorepo entrypoint → src/bun/index.ts
        ├── tests/
        │   ├── aggregator.test.ts
        │   ├── pkce.test.ts
        │   └── store.test.ts
        └── src/
            ├── bun/
            │   └── index.ts              ← Electrobun main process (BrowserWindow + RPC + HMR detection)
            ├── shared/
            │   └── rpc.ts               ← TwirChatRPCSchema, WebviewSender
            ├── views/
            │   ├── main/
            │   │   ├── index.html
            │   │   ├── env.d.ts
            │   │   ├── main.ts           ← Electroview.defineRPC + createApp
            │   │   ├── App.vue           ← корневой компонент (sidebar + chat/events/settings tabs)
            │   │   └── components/
            │   │       ├── ChatMessage.vue
            │   │       ├── ChatList.vue
            │   │       └── Sidebar.vue
            │   └── overlay/
            │       ├── index.html
            │       ├── env.d.ts
            │       ├── main.ts           ← createApp (без Electrobun RPC)
            │       └── App.vue           ← WS клиент к overlay-server + TransitionGroup анимации
            ├── overlay-server.ts         ← Bun.serve: dist/overlay/ + WS push на порту 45823
            ├── backend-connection.ts     ← WS клиент к backend
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
