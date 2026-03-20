# TwirChat — план разработки

Мультиплатформенный менеджер чата для стримеров (Twitch, YouTube, Kick).
Стек: **Bun + TypeScript**, monorepo (bun workspaces).

---

## Архитектура

```
twirchat/                          ← monorepo root
├── package.json                  ← workspaces: ["packages/*"]
└── packages/
    ├── shared/                   ← @twirchat/shared — общие типы и протокол
    │   ├── types.ts              ← NormalizedChatMessage, NormalizedEvent, AppSettings, ...
    │   ├── constants.ts          ← порты, URL-константы, BACKEND_WS_URL
    │   ├── protocol.ts           ← BackendToDesktopMessage / DesktopToBackendMessage
    │   └── index.ts
    ├── backend/                  ← @twirchat/backend — публичный SaaS-сервис
    │   └── src/
    │       ├── index.ts          ← Bun.serve (HTTP + WebSocket)
    │       ├── db/               ← Bun.sql (Postgres)
    │       │   ├── migrations.ts ← CREATE TABLE IF NOT EXISTS ...
    │       │   ├── store.ts      ← ClientStore, AccountStore, KickOAuthSessionStore
    │       │   └── index.ts
    │       ├── auth/
    │       │   ├── kick.ts       ← Kick OAuth 2.1 + PKCE (backend flow)
    │       │   └── pkce.ts       ← generateCodeVerifier/Challenge/State
    │       ├── ws/
    │       │   ├── connection-manager.ts ← Map<clientSecret, ServerWebSocket>
    │       │   └── handlers.ts   ← open/close/message handlers
    │       └── routes/
    │           └── index.ts      ← HTTP-маршруты
    └── desktop/                  ← @twirchat/desktop — desktop-приложение (Bun)
        ├── src/
        │   ├── index.ts          ← точка входа, init + wiring
        │   ├── backend-connection.ts ← WS-клиент к backend, автореконнект
        │   ├── store/
        │   │   ├── db.ts         ← bun:sqlite, миграции
        │   │   ├── client-secret.ts ← UUID генерация/хранение
        │   │   ├── account-store.ts ← CRUD аккаунтов (зашифр. токены)
        │   │   ├── settings-store.ts
        │   │   └── crypto.ts     ← XOR-шифрование токенов
        │   ├── chat/
        │   │   └── aggregator.ts ← ChatAggregator, кольцевой буфер 500 сообщ.
        │   ├── platforms/
        │   │   ├── base-adapter.ts
        │   │   └── kick/adapter.ts ← Kick через Pusher WS (анонимный режим)
        │   └── auth/             ← локальный OAuth-сервер (Twitch остаётся здесь)
        └── tests/
            ├── aggregator.test.ts ✅
            ├── pkce.test.ts       ✅
            └── store.test.ts      ✅
```

### Потоки данных

```
Desktop                        Backend                     Kick/Twitch/YT
  │                               │
  ├─ initDb() → генерирует UUID   │
  ├─ BackendConnection.connect()  │
  │    ws://backend/ws            │
  │    Header: X-Client-Secret    │
  │──────────── WS ──────────────▶│
  │                               │
  │  POST /api/auth/kick/start    │
  │──────────── HTTP ────────────▶│
  │◀─── {url} ──────────────────  │── opens browser
  │                               │◀── OAuth callback ── Kick
  │                               │    saves tokens in Postgres
  │◀─── auth_success (WS) ──────  │
  │                               │
  │  (Kick webhook events)        │◀── POST /webhook/kick ── Kick
  │◀─── chat_message (WS) ──────  │    verify HMAC, normalize
```

### Принципы

- **Backend** — Managed SaaS (публичный URL), принимает вебхуки Kick/YouTube, хранит в **Postgres** через `Bun.sql`
- **Desktop → Backend**: идентификация через UUID-секрет (`X-Client-Secret`), генерируется при первом старте, хранится в SQLite
- **Backend → Desktop**: WebSocket — backend держит WS-сервер, desktop подключается и получает события
- **Twitch остаётся в desktop** — EventSub WS transport, не требует публичного URL
- **Анонимное слушание**: Kick → Pusher WebSocket, Twitch → IRC justinfan

---

## Статус разработки

### ✅ Завершено

#### Инфраструктура

- [x] Monorepo с bun workspaces (`packages/shared`, `packages/desktop`, `packages/backend`)
- [x] `@twirchat/shared`: types.ts, constants.ts, protocol.ts — полностью готово
- [x] tsconfig path aliases во всех пакетах (`@twirchat/shared`, `@desktop/*`, `@backend/*`)
- [x] Все тесты desktop проходят (18/18): aggregator, pkce, store

#### Desktop (packages/desktop)

- [x] SQLite БД с миграциями (`bun:sqlite`)
- [x] `client-secret.ts` — UUID генерация/хранение при первом старте
- [x] `AccountStore` — CRUD аккаунтов с шифрованием токенов
- [x] `SettingsStore` — настройки
- [x] `ChatAggregator` — кольцевой буфер, дедупликация, inject-методы для backend WS
- [x] `BasePlatformAdapter` + `KickAdapter` (анонимный режим через Pusher WS)
- [x] `BackendConnection` — WS-клиент к backend с автореконнектом (экспоненциальный backoff)
- [x] `src/index.ts` — полная инициализация: DB → UUID → WS → роутинг событий

#### Backend (packages/backend)

- [x] `Bun.serve` с HTTP + WebSocket (нет внешних зависимостей для HTTP/WS)
- [x] `Bun.sql` для Postgres (встроенный клиент, без npm-пакетов)
- [x] Postgres миграции: `desktop_clients`, `platform_accounts`, `kick_oauth_sessions`
- [x] `ClientStore`, `AccountStore`, `KickOAuthSessionStore`
- [x] `ConnectionManager` — реестр активных WS-соединений
- [x] WS-протокол: ping/pong, роутинг сообщений
- [x] Kick OAuth 2.1 + PKCE: старт flow, callback, обмен токенов, сохранение в Postgres, push `auth_success` в desktop
- [x] HTTP-маршруты: `POST /api/auth/kick/start`, `GET /auth/kick/callback`, `GET /api/accounts`, `DELETE /api/accounts/:platform`, `GET /health`
- [x] UUID-аутентификация desktop-клиентов через `X-Client-Secret`

---

## ✅ Спринт 2 — Kick (завершено)

#### Backend — Kick вебхуки

- [x] `POST /webhook/kick` — принимать вебхуки от Kick
- [x] Верификация подписи: заголовок `Kick-Event-Signature` (HMAC SHA256)
- [x] Подписка на события через `kick-subscriptions.ts`
  - Events: `chat.message.sent`, `channel.followed`, `channel.subscription.new`, `channel.subscription.renewal`, `channel.subscription.gifts`
- [x] Нормализация Kick-событий → `NormalizedChatMessage` / `NormalizedEvent`
- [x] Пуш нормализованных событий в desktop через WS

#### Desktop — Kick

- [x] `KickAdapter`: получить `chatroom_id` через `GET /public/v1/channels/{slug}`, подключиться к Pusher WS
- [x] Нормализация `ChatMessageSentEvent` → `NormalizedChatMessage`
- [x] OAuth через backend WS flow (`auth_start` → `auth_url` → браузер → `auth_success`)

---

## ✅ Фаза 3 — Twitch (завершено)

### Desktop

- [x] `TwitchAdapter`: прямой IRC WebSocket (`wss://irc-ws.chat.twitch.tv`)
  - [x] Анонимный режим: `justinfan<random>` — только чтение
  - [x] Авторизованный режим: oauth-токен для отправки сообщений
- [x] Полный IRC-парсер с тегами
- [x] `PRIVMSG` → `NormalizedChatMessage` (бейджики, эмоуты из IRC-тегов)
- [x] `USERNOTICE` → sub/resub/subgift/raid → `NormalizedEvent`
- [x] Twitch OAuth: Authorization Code + PKCE (`src/auth/twitch.ts`)

---

## ✅ Фаза 4 — YouTube (завершено)

### Desktop

- [x] `YouTubeAdapter`: gRPC стрим через `@grpc/grpc-js` + `@grpc/proto-loader`
  - [x] Авторизованный режим, `fetchLiveChatId` через REST
  - [x] gRPC endpoint `youtube.googleapis.com:443`, сервис `V3DataLiveChatMessageService.StreamList`
  - [x] Нормализация: `TEXT_MESSAGE_EVENT`, `SUPER_CHAT_EVENT`, `NEW_SPONSOR_EVENT`, `MEMBER_MILESTONE_CHAT_EVENT`, `MEMBERSHIP_GIFTING_EVENT`
- [x] YouTube OAuth (`src/auth/youtube.ts`)

---

## ✅ Фаза 5 — OBS-оверлей (завершено)

### Desktop

- [x] `overlay-server.ts` — `Bun.serve` на порту 45823
- [x] WebSocket endpoint `ws://localhost:45823/ws` — пуш событий чата
- [x] Overlay фронтенд (`overlay/index.html` + `overlay/frontend.ts`) — подключение к WS, отображение сообщений с эмоутами, бейджиками, аватарками
- [x] Параметры кастомизации через URL query string (`bg`, `textColor`, `fontSize`, `fontFamily`, `maxMessages`, `timeout`, `showPlatform`, `showAvatar`, `showBadges`, `animation`, `position`, `platforms`)
- [x] Анимации: `slide` / `fade` / `none`, позиция `top` / `bottom`
- [x] Авто-реконнект с exponential backoff

---

## Текущая фаза: Фаза 6 — UI главного окна

### Desktop

- [ ] Главное окно (HTML/CSS/JS или React)
- [ ] Виртуализированный список сообщений
- [ ] Иконки платформ (SVG: Twitch, YouTube, Kick)
- [ ] Аватарки, бейджики, цвет ника
- [ ] Рендер эмоутов
- [ ] Sidebar: статус платформ, кнопки подключить/отключить
- [ ] Страница настроек (аккаунты, тема, фонт, фильтр)
- [ ] Лента событий (follow, sub, raid)

---

## Фаза 7 — Сборка и дистрибуция

- [ ] Настроить Electrobun или standalone Bun app
- [ ] Сборка macOS `.app`
- [ ] Сборка Windows `.exe`
- [ ] GitHub Actions CI/CD pipeline

---

## Технические детали

### Bun API используется везде

| Нужно            | Bun API                      | Не используем        |
| ---------------- | ---------------------------- | -------------------- |
| HTTP + WebSocket | `Bun.serve()`                | express, ws, fastify |
| Postgres         | `Bun.sql`                    | pg, postgres.js      |
| SQLite           | `bun:sqlite`                 | better-sqlite3       |
| Файлы            | `Bun.file()`                 | fs.readFile          |
| Shell-команды    | `Bun.$`...``                 | execa, child_process |
| Env vars         | `process.env` (автозагрузка) | dotenv               |
| Тесты            | `bun test`                   | jest, vitest         |

### WS-протокол (packages/shared/protocol.ts)

- `BackendToDesktopMessage`: `chat_message`, `chat_event`, `platform_status`, `auth_url`, `auth_success`, `auth_error`, `error`, `pong`
- `DesktopToBackendMessage`: `ping`, `auth_start`, `auth_logout`, `channel_join`, `channel_leave`, `send_message`

### Анонимное слушание

| Платформа | Анонимный режим          | Что доступно | Что требует OAuth            |
| --------- | ------------------------ | ------------ | ---------------------------- |
| Kick      | Pusher WS (неофициально) | Чтение чата  | Follow/sub события, отправка |
| Twitch    | IRC `justinfan<random>`  | Чтение чата  | Отправка, EventSub follow    |
| YouTube   | Недоступен               | —            | Всё                          |

### Kick OAuth — backend flow

1. Desktop: `POST /api/auth/kick/start` с `{clientSecret}`
2. Backend: генерирует PKCE, сохраняет сессию, возвращает `{url}`
3. Desktop: открывает URL в браузере
4. Kick → браузер → `GET /auth/kick/callback?code=...&state=...` на backend
5. Backend: обменивает code на токены, сохраняет в Postgres, пушит `auth_success` в desktop через WS

### Шифрование токенов (desktop SQLite)

Простое XOR-шифрование на основе `os.homedir() + APP_NAME` — достаточно для защиты от случайного чтения файла БД.
Токены в backend Postgres хранятся открытым текстом (Postgres сам по себе требует аутентификацию).

---

## Зависимости

### packages/shared

Нет зависимостей (только `@types/bun` для разработки).

### packages/backend

```json
{
  "dependencies": {
    "@twirchat/shared": "workspace:*"
  }
}
```

Всё остальное — встроенные Bun API (`Bun.serve`, `Bun.sql`, `WebSocket`).

### packages/desktop

```json
{
  "dependencies": {
    "@twirchat/shared": "workspace:*",
    "@twurple/auth": "^7",
    "@twurple/chat": "^7",
    "@twurple/eventsub-ws": "^7",
    "@twurple/api": "^7",
    "@grpc/grpc-js": "^1",
    "@grpc/proto-loader": "^0.7"
  }
}
```

---

## Ресурсы

| Ресурс                 | URL                                                                 |
| ---------------------- | ------------------------------------------------------------------- |
| Kick API               | https://docs.kick.com                                               |
| Kick OAuth             | https://docs.kick.com/getting-started/generating-tokens-oauth2-flow |
| Kick Events            | https://docs.kick.com/events/introduction                           |
| Kick Event Types       | https://docs.kick.com/events/event-types                            |
| Twitch EventSub        | https://dev.twitch.tv/docs/eventsub/                                |
| Twitch Chat IRC        | https://dev.twitch.tv/docs/irc/                                     |
| YouTube Live Streaming | https://developers.google.com/youtube/v3/live/getting-started       |
| Bun SQL docs           | https://bun.sh/docs/api/sql                                         |
| Bun SQLite docs        | https://bun.sh/docs/api/sqlite                                      |
