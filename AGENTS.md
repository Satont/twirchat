## Commit and pull request titles

- Write commit and pull request titles in English using `type(scope)!: summary`.
  The scope and breaking-change marker (`!`) are optional.
- Use one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `chore`, or `revert`.
- If present, the scope consists of lowercase alphanumeric words separated by `.`, `/`, `_`,
  or `-`, for example `desktop/chat`.
- Use exactly one space after the colon and a concise, imperative English summary.
  Do not include leading/trailing whitespace or control characters.
- Mark breaking changes with `!` and explain the change and migration in a
  `BREAKING CHANGE:` footer in the commit body and PR description.
- Do not add AI co-author trailers unless explicitly requested.
- The `PR title` check must pass to merge into `main`. Squash the PR and keep its title
  as the squash commit subject so git-cliff can include it in the changelog.

## Agent skills

- Project-local skills live in `.agents/skills/<name>/SKILL.md`. When a task matches one of
  them, read the skill before starting and apply it together with this file. Rules in this
  file take precedence over a skill if they conflict.
- [typescript-best-practices](.agents/skills/typescript-best-practices/SKILL.md) — any `.ts`
  or `.tsx` change: type discipline, boundary parsing, API shape.
- [react-best-practices](.agents/skills/react-best-practices/SKILL.md) — React components,
  hooks, subscriptions, derived state, and rendering performance. GPUIX is not a browser:
  DOM, storage, SSR, RSC, and Next.js examples from upstream do not apply.
- [vue3-typescript-best-practices](.agents/skills/vue3-typescript-best-practices/SKILL.md) —
  the OBS overlay in `packages/desktop/src/views/overlay`.
- [gpui](.agents/skills/gpui/SKILL.md),
  [rust-best-practices](.agents/skills/rust-best-practices/SKILL.md), and
  [rust-async-patterns](.agents/skills/rust-async-patterns/SKILL.md) — Rust/GPUI work,
  including the native parity track.
- [7tv-events-api](.agents/skills/7tv-events-api/SKILL.md) — 7TV EventAPI v3 WebSocket/SSE
  integration, subscriptions, and payload handling.
- [type discipline](.agents/skills/principle-type-system-discipline/SKILL.md),
  [boundary discipline](.agents/skills/principle-boundary-discipline/SKILL.md), and
  [structural safeguards](.agents/skills/principle-encode-lessons-in-structure/SKILL.md)
  — apply when designing types, wiring validation, or turning a repeated correction into
  structure.
- [open-pr](.agents/skills/open-pr/SKILL.md) — before opening or updating a pull request:
  sync the base remote, rebase, rerun checks, push with lease, then create or update the PR.
- [deslop](.agents/skills/deslop/SKILL.md) — review the final diff for AI-generated slop
  before declaring a change complete.
- [find-skills](.agents/skills/find-skills/SKILL.md) — only when the user asks to discover,
  install, or extend agent skills.
- Skills marked `disable-model-invocation: true` must be opened explicitly; do not rely on
  automatic selection. Keep vendored upstream skill text unchanged and put project policy
  here. Sources and hashes are pinned in `.agents/skills/upstream-lock.json` and
  `skills-lock.json`.

## Agent GUI testing

- Run native GUI tests only through `bun run qa:gui` or `bun run qa:native` from `packages/desktop`.
- The launcher creates a private virtual X11 display inside bwrap, with isolated runtime,
  profile, network and device access. A failed isolation check must abort the test.
- Never launch the app or a native renderer directly for agent testing. `focus: false` and
  `GPUIX_BACKGROUND=1` do not protect the user's Linux desktop.
- Never create test windows on the user's Hyprland workspaces, switch their workspace,
  modify their compositor rules/outputs, or forward their display sockets into tests.
- Keep screenshots and GUI automation inside the isolated launcher. Do not capture the host desktop.
- Example: `bun run qa:gui --timeout 30 -- bun src/gpuix/main.tsx`.

## Current feature scope

- Plugin systems, including Lua compatibility, are deferred to
  [issue #76](https://github.com/Satont/twirchat/issues/76).
- Clipboard image uploads are supported in the composer. A file picker and drag-and-drop
  remain deferred to [issue #77](https://github.com/Satont/twirchat/issues/77).
- Neither feature blocks the current GPUIX migration or Chatterino/Leafyrino/Dankerino
  feature-parity acceptance. Resume them only when the user reopens their scope.
- Avatar/emote rendering and ordinary text-link handling remain in the current scope.

## Desktop performance is an acceptance requirement

- Treat CPU, process RSS, throughput and input responsiveness as correctness requirements.
  Do not declare a desktop change complete while a confirmed performance regression remains
  unexplained. Fix the regression or document a concrete measured tradeoff and call it out.
- Before changing message ingestion, stores/subscriptions, classification/filtering, rendering,
  native layout or caches, preserve a baseline. After the change run the full default matrix:
  `bun run --cwd packages/desktop bench:chat`. Also repeat the target workload at least three
  times with fresh output directories:
  `bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30`.
  Target: 50 channels, four panes, 5000 total messages/s, 200 retained messages per channel.
- Reuse completed measurements when a later narrow fix does not affect the measured workload.
  Preserve their exact source provenance and run focused functional/GUI checks for that fix.
  Do not repeat the full load matrix just because an unrelated file or cold event path changed.
- Compare identical modes, timings, workloads, window sizes and retention. Record source/native
  provenance, actual processed rate, CPU, RSS median/peak, JS heap and event-loop lag. Report
  medians and ranges for repeated runs. A repeated regression above 5% in CPU or RSS requires
  investigation before completion; repeat the baseline when host variation makes it inconclusive.
  At this target, preserve at least 99% of the offered rate. The coupled generator is not proof
  of maximum sustainable external throughput.
- Production and development results are separate. Verify the loaded React/JSX/reconciler mode;
  do not present disabling development instrumentation as an algorithmic improvement.
  `start` must explicitly use production; `dev` keeps HMR/debug checks. Keep the latest evidence
  and comparisons in `docs/benchmarks/` (current target report: `2026-11-03-interactions/report.md`).
- Freeze sources and native artifacts for each measured run. Do not run builds, tests, profilers
  or other application instances concurrently with resource measurements. Keep all native GUI
  activity inside the isolated launcher described above.
- Do not improve numbers by dropping messages, shrinking retention, lowering refresh rate,
  disabling existing features, forcing GC, trimming allocators or clearing performance entries.
  Any workload or execution-mode experiment must be labeled separately.
- Hot work must scale with the arriving batch or changed rows. Reuse identity indexes and
  policy results; avoid scanning all retained messages/channels, recreating callbacks/objects,
  or rebuilding completion/filter data when the feature is inactive. Preserve immutable
  snapshots and correct behavior when branching from an older snapshot.
- Bound caches, queues and native bookkeeping by explicit limits or live identities. Remove
  retired entries and dispose subscriptions/timers/gestures on close, unmount and HMR. A bounded
  Map is insufficient if its eviction path repeatedly scans deleted entries.
- Never block an input/drag callback on fresh-layout queries, synchronous native request/reply,
  network, storage or file I/O. Use painted geometry snapshots and transient drag state;
  persist layout only for an accepted drop. Coalesce motion updates and skip unchanged targets.
  Escape, release outside the target, focus loss and cancellation must leave the next gesture usable.
  `project-quality/no-blocking-native-geometry` rejects fresh `getElementBounds` references in
  GPUIX application code; those queries remain available only to automation outside the UI.
- For interaction-only fixes, test actual native keyboard/pointer input at small and normal window
  sizes, including long lists, rapid repeated input, cancelled drags and live chat traffic.
  Verify selected items remain visible, popups stay clipped/in bounds, chat continues updating,
  and no input callback stalls. If the fix touches a hot path listed above, the benchmark gate
  also applies. Preserve useful measured evidence rather than relying on visual smoothness alone.

## TypeScript and React quality

- Apply the project-local [TypeScript skill](.agents/skills/typescript-best-practices/SKILL.md),
  [type discipline](.agents/skills/principle-type-system-discipline/SKILL.md),
  [boundary discipline](.agents/skills/principle-boundary-discipline/SKILL.md), and
  [structural safeguards](.agents/skills/principle-encode-lessons-in-structure/SKILL.md)
  when changing TypeScript. Review the final diff with [deslop](.agents/skills/deslop/SKILL.md).
- Apply the relevant [React rules](.agents/skills/react-best-practices/SKILL.md) to components,
  hooks, subscriptions, derived state, and rendering performance. GPUIX has no DOM, browser
  storage, SSR, RSC, or Next.js; those upstream examples do not apply to the native UI.
- Type assertions are forbidden, including `as const`, double assertions, and angle-bracket
  assertions. This project rule overrides upstream exceptions. Use inference, annotations,
  `satisfies`, discriminated unions, or validated boundary schemas. Import/export aliases are fine.
- Declare interfaces and type aliases at module scope, never inside functions.
- Do not replace assertions with `any`, non-null assertions, unchecked typed JSON assignments,
  or generic predicates that do not prove their result. Validate external data at its boundary;
  trust already validated internal contracts.
- Handle rejected promises explicitly. `void promise` does not handle a rejection.
- Keep hooks unconditional, declare their real dependencies, and derive values during render
  when they do not require synchronization with an external system.
- Pinned skill sources and licenses are recorded in `.agents/skills/upstream-lock.json`.
  Keep vendored upstream skill text unchanged; put project policy here.

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
- **Desktop**: GPUIX v0.11 (React + GPUI, Zed's GPU framework — **без webview, без DOM**, один Bun-процесс)
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
- **Remote-изображения** идут через `state/image-cache.ts` + `<RemoteImage>` (дисковый кэш;
  исторически GPUIX на Linux не грузил http(s), с 0.8 умеет, но кэш остаётся)
- **Поля ввода** — всегда `useTextInputFocusTracking()` из `state/focus.ts`, иначе глобальные
  хоткеи/ESC срабатывают во время набора (или отключаются навсегда при размонтировании в фокусе)
- **Шрифты** Inter/Manrope регистрируются из `public/fonts` через `registerFont` (`gpuix/fonts.ts`)
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
