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
- **Проверка типов**: `tsgo --noEmit` (`@typescript/native-preview`)
- **НЕ использовать** HTTP polling для YouTube — только gRPC

### Архитектура `packages/desktop`

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

### Файловая структура

```
/home/satont/Projects/twirchat/
├── AGENTS.md
├── package.json                          ← monorepo root
└── packages/
    ├── shared/
    │   ├── types.ts                      ← NormalizedChatMessage, NormalizedEvent, Account, AppSettings, Platform, ...
    │   ├── constants.ts                  ← OVERLAY_SERVER_PORT=45823
    │   ├── protocol.ts                   ← BackendToDesktopMessage / DesktopToBackendMessage
    │   └── index.ts
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
