# TwirChat — план разработки

Мультиплатформенный менеджер чата для стримеров (Twitch, YouTube, Kick).
Стек: **Bun + TypeScript + Vue 3**, monorepo (bun workspaces).

---

## Архитектура

```
twirchat/
├── package.json                          ← monorepo root (bun workspaces)
└── packages/
    ├── shared/                           ← @twirchat/shared
    │   ├── types.ts                      ← NormalizedChatMessage, NormalizedEvent, Account, AppSettings, ...
    │   ├── constants.ts                  ← порты, URL-константы, TWITCH_ANON_PREFIX, ...
    │   ├── protocol.ts                   ← BackendToDesktopMessage / DesktopToBackendMessage
    │   └── index.ts
    ├── backend/                          ← @twirchat/backend — SaaS-сервис (OAuth proxy)
    │   └── src/index.ts                  ← Bun.serve: HTTP + WebSocket, Postgres (Bun.sql)
    └── desktop/                          ← Electrobun app (Bun main process + Vue 3 webview)
        ├── electrobun.config.ts
        ├── vite.main.config.ts           ← Vite для src/views/main → dist/main/
        ├── vite.overlay.config.ts        ← Vite для src/views/overlay → dist/overlay/
        └── src/
            ├── bun/index.ts              ← Electrobun main process
            ├── shared/rpc.ts             ← TwirChatRPCSchema + WebviewSender
            ├── backend-connection.ts     ← WS-клиент к backend
            ├── overlay-server.ts         ← Bun.serve: dist/overlay/ + WS push (порт 45823)
            ├── store/                    ← SQLite (bun:sqlite): accounts, settings, crypto
            ├── chat/aggregator.ts        ← ChatAggregator: кольцевой буфер 500 сообщ., дедупл.
            ├── platforms/
            │   ├── base-adapter.ts       ← BasePlatformAdapter (EventEmitter pattern)
            │   ├── twitch/adapter.ts     ← IRC WebSocket, anonymous + authenticated
            │   ├── kick/adapter.ts       ← Pusher WebSocket (anonymous)
            │   └── youtube/adapter.ts   ← gRPC (ConnectRPC), authenticated only
            ├── auth/                     ← PKCE OAuth: Twitch, YouTube, Kick
            └── views/
                ├── main/                 ← Vue 3 app главного окна
                │   ├── main.ts           ← Electroview.defineRPC + waitForSocket + createApp
                │   ├── App.vue           ← nav-rail + tab routing
                │   └── components/
                │       ├── ChatList.vue
                │       ├── ChatMessage.vue
                │       ├── PlatformsPanel.vue
                │       ├── EventsFeed.vue
                │       ├── SettingsPanel.vue
                │       └── StreamEditor.vue
                └── overlay/              ← OBS overlay Vue app (WS client, no Electrobun RPC)
```

### Поток данных (текущий)

```
Desktop (Bun process)                     Backend (SaaS)
  │
  ├─ initDb() + getClientSecret()
  ├─ BackendConnection.connect()  ──WS──▶  проверяет X-Client-Secret header
  │                                        auth flows: auth_start → auth_url → auth_success
  ├─ TwitchAdapter.connect(channel)
  │    IRC WebSocket → wss://irc-ws.chat.twitch.tv:443
  │    PRIVMSG → NormalizedChatMessage → aggregator → sendToView.chat_message()
  │
  ├─ KickAdapter.connect(channel)
  │    Pusher WebSocket → wss://ws-us2.pusher.com/...
  │    ChatMessageEvent → NormalizedChatMessage → aggregator → sendToView.chat_message()
  │
  └─ YouTubeAdapter.connect(videoId)
       gRPC streaming → youtube.googleapis.com (ConnectRPC)
       TEXT_MESSAGE_EVENT → NormalizedChatMessage → aggregator → sendToView.chat_message()

Desktop (Vue webview)
  ├─ Electroview RPC ←→ Bun process (encrypted WebSocket, AES-GCM)
  ├─ rpc.send.joinChannel({ platform, channelSlug }) → adapter.connect()
  └─ rpc.addMessageListener("chat_message", handler) → messages.value.unshift(msg)
```

### Ключевые находки (из разработки)

- **CEF обязателен на Linux**: WebKitGTK не даёт `crypto.subtle` для `views://` протокола → Electrobun IPC шифрование падает → белый экран. Фикс: `bundleCEF: true` + `defaultRenderer: "cef"` в `electrobun.config.ts` (linux).
- **`electrobun/view` API**: нет `rpc.on.*` — только `rpc.addMessageListener(name, handler)` / `rpc.removeMessageListener`.
- **RPC таймаут**: по умолчанию **1 секунда** (`DEFAULT_MAX_REQUEST_TIME = 1000` в `shared/rpc.ts`). Запросы отправленные до открытия WS-сокета тихо таймаутятся.
- **`waitForSocket()`**: в `main.ts` нужно ждать открытия `view.bunSocket` перед монтированием Vue, иначе `rpc.send.*` в `onMounted` падают с таймаутом.
- **BackendConnection**: отправляет `X-Client-Secret` как **заголовок WS** (не query string) — Bun поддерживает, браузер нет.
- **Dev URL**: при `dev:hmr` нужно проверять `localhost:5173` с таймаутом 500мс, иначе при запуске без Vite — белое окно.
- **`@grpc/grpc-js` удалён**: заменён на `@connectrpc/connect` + `@connectrpc/connect-node`.
- **`@desktop/*` aliases удалены**: заменены на относительные импорты.

---

## Статус разработки

### ✅ Инфраструктура

- [x] Monorepo (bun workspaces): shared, desktop, backend
- [x] `@twirchat/shared`: types.ts, constants.ts, protocol.ts
- [x] Все тесты desktop: 18/18 (aggregator, pkce, store)
- [x] Electrobun настроен: CEF на Linux, DevTools, HMR dev-режим

### ✅ Desktop — backend-слой

- [x] SQLite БД с миграциями (`bun:sqlite`)
- [x] `AccountStore`: CRUD аккаунтов, шифрование токенов (XOR)
- [x] `SettingsStore`: настройки (JSON в SQLite)
- [x] `client-secret.ts`: UUID генерация/хранение
- [x] `BackendConnection`: WS-клиент к backend, авто-реконнект (exponential backoff), `X-Client-Secret` header
- [x] `ChatAggregator`: кольцевой буфер 500, дедупликация, inject-методы

### ✅ Desktop — платформы

- [x] `BasePlatformAdapter`: EventEmitter pattern (on/off/emit)
- [x] `TwitchAdapter`: IRC WebSocket
  - [x] Анонимный режим: `justinfan<random>`
  - [x] Авторизованный режим: oauth-токен
  - [x] Полный IRC-парсер с тегами (PRIVMSG, USERNOTICE, PING, JOIN, RECONNECT)
  - [x] Нормализация: badges, emotes из IRC-тегов
  - [x] События: sub, resub, subgift, raid
- [x] `KickAdapter`: Pusher WebSocket (анонимный)
  - [x] Получение chatroom_id через REST
  - [x] ChatMessageEvent, FollowersUpdated, SubscriptionEvent
- [x] `YouTubeAdapter`: gRPC через ConnectRPC (authenticated)
  - [x] fetchLiveChatId: videoId / поиск активного стрима
  - [x] TEXT_MESSAGE_EVENT, SUPER_CHAT_EVENT, NEW_SPONSOR_EVENT, MEMBER_MILESTONE_CHAT_EVENT, MEMBERSHIP_GIFTING_EVENT

### ✅ Desktop — auth

- [x] `auth/twitch.ts`: PKCE OAuth, обмен через backend (`/api/auth/twitch/exchange`)
- [x] `auth/youtube.ts`: OAuth flow
- [x] `auth/kick.ts`: OAuth flow
- [x] `auth/server.ts`: локальный HTTP-сервер для OAuth callback (порт 45821)

### ✅ Desktop — overlay

- [x] `overlay-server.ts`: `Bun.serve` на порту 45823, раздаёт `dist/overlay/`, WS push
- [x] `views/overlay/App.vue`: WS-клиент, TransitionGroup анимации, URL параметры кастомизации

### ✅ Desktop — главное окно (Vue 3)

- [x] `App.vue`: nav-rail (Chat / Events / Platforms / Settings), CSS dark/light тема
- [x] `ChatList.vue`: auto-scroll, empty-state (нет аккаунтов / нет подключения / нет сообщений), scroll-to-bottom pill
- [x] `ChatMessage.vue`: отображение сообщений (бейджики, цвет ника, эмоуты)
- [x] `PlatformsPanel.vue`: connect/disconnect аккаунтов, join/leave каналов, toasts
- [x] `EventsFeed.vue`: лента событий (follow, sub, raid, ...)
- [x] `SettingsPanel.vue`: настройки (тема, шрифт, фильтры)
- [x] `StreamEditor.vue`: редактирование стрима (title, category)
- [x] `main.ts`: `waitForSocket()` — ждёт открытия RPC WS перед монтированием Vue

### ✅ Backend (packages/backend)

- [x] `Bun.serve`: HTTP + WebSocket
- [x] `Bun.sql` Postgres: миграции, ClientStore, AccountStore, сессии OAuth
- [x] ConnectionManager: реестр WS-соединений по client-secret
- [x] WS-протокол: ping/pong, роутинг сообщений
- [x] Kick OAuth 2.1 + PKCE: старт flow, callback, сохранение, push `auth_success`
- [x] Twitch OAuth: PKCE, exchange через backend, push `auth_success`
- [x] YouTube OAuth
- [x] HTTP: `/api/stream-status`, `/api/update-stream`, `/api/search-categories`

---

## 🔴 Текущие проблемы / в работе

### Twitch чат не показывается в UI

**Симптом**: канал добавлен в PlatformsPanel, но сообщения не появляются в ChatList.

**Предполагаемые причины**:
1. `rpc.send.joinChannel()` таймаутит (1с) если сокет ещё не готов → `adapter.connect()` не вызывается. PlatformsPanel не показывает ошибку (try/catch отсутствует).
2. `sendToView.chat_message(msg)` отправляется через RPC, но webview не получает если CEF не bundled (до фикса `bundleCEF: true`).
3. В dev-режиме (`http://localhost:5173`) `crypto.subtle` доступен для localhost → RPC работает, но возможно есть другая проблема с message listener.

**Статус**: расследуется, фиксим.

### Известные ограничения

- YouTube адаптер требует авторизации (нет анонимного режима)
- `sendMessage` в Kick и YouTube не реализован в адаптерах
- `joinedChannels` в PlatformsPanel — только локальное состояние (сбрасывается при перезапуске)

---

## 📋 Следующие задачи

### Приоритет: высокий

- [ ] **Починить Twitch чат в UI**: убедиться что `adapter.connect()` вызывается и сообщения доходят до webview
- [ ] **Персистентность каналов**: сохранять joined channels в SQLite, восстанавливать при старте
- [ ] **Auto-connect при старте**: при запуске приложения автоматически переподключаться к сохранённым каналам

### Приоритет: средний

- [ ] **Рендер эмоутов**: в ChatMessage.vue эмоуты пока не рендерятся как картинки
- [ ] **SVG иконки платформ**: заменить текстовые placeholder на реальные SVG (Twitch, YouTube, Kick)
- [ ] **Виртуализированный список**: для больших чатов (vue-virtual-scroller или кастомный)
- [ ] **Badges**: подтягивать реальные badge-изображения с Twitch API

### Приоритет: низкий

- [ ] **Фаза 7 — Сборка и дистрибуция**:
  - [ ] Сборка macOS `.app`
  - [ ] Сборка Windows `.exe`
  - [ ] GitHub Actions CI/CD

---

## Технические детали

### Bun API везде

| Нужно       | Bun API           | Не используем          |
|-------------|-------------------|------------------------|
| HTTP + WS   | `Bun.serve()`     | express, ws, fastify   |
| Postgres    | `Bun.sql`         | pg, postgres.js        |
| SQLite      | `bun:sqlite`      | better-sqlite3         |
| Файлы       | `Bun.file()`      | fs.readFile            |
| Shell       | `Bun.$`...``      | execa, child_process   |
| Тесты       | `bun test`        | jest, vitest           |

### Анонимное слушание

| Платформа | Режим                    | Что доступно | Что требует OAuth              |
|-----------|--------------------------|--------------|--------------------------------|
| Twitch    | IRC `justinfan<random>`  | Чтение чата  | Отправка, EventSub events      |
| Kick      | Pusher WS                | Чтение чата  | Отправка, follow/sub события   |
| YouTube   | Недоступен               | —            | Всё                            |

### Скрипты packages/desktop

```json
"dev"        : "bun run build:views && electrobun dev"
"dev:hmr"    : "concurrently \"bun run hmr:main\" \"bun run start\""
"hmr:main"   : "vite --config vite.main.config.ts --port 5173"
"start"      : "bun src/bun/index.ts"
"build:views": "vite build --config vite.main.config.ts && vite build --config vite.overlay.config.ts"
"build"      : "bun run build:views && electrobun build"
"typecheck"  : "tsgo --noEmit"
"test"       : "bun test tests/"
```

### Зависимости packages/desktop

```json
{
  "@bufbuild/protobuf": "2.11.0",
  "@connectrpc/connect": "2.1.1",
  "@connectrpc/connect-node": "2.1.1",
  "@twirchat/shared": "workspace:*",
  "@twurple/api": "8.0.3",      ← установлен, не используется
  "@twurple/auth": "8.0.3",     ← установлен, не используется
  "@twurple/chat": "8.0.3",     ← установлен, не используется
  "electrobun": "1.16.0",
  "vue": "3.5.30"
}
```

### Ресурсы

| Ресурс              | URL                                             |
|---------------------|-------------------------------------------------|
| Twitch IRC          | https://dev.twitch.tv/docs/irc/                 |
| Kick API            | https://docs.kick.com                           |
| YouTube Live        | https://developers.google.com/youtube/v3/live/  |
| Electrobun docs     | https://electrobun.dev/docs                     |
| ConnectRPC          | https://connectrpc.com/docs/node/                |
