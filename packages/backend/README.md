# @twirchat/backend

The backend serves public platform metadata, provider relays, Twitch history, and the anonymous YouTube gRPC relay. It also handles Twitch and Kick OAuth (code exchange and token refresh with the app secrets) and legacy Kick account and webhook routes. YouTube user authorization runs in the desktop app.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [Docker](https://docs.docker.com/get-docker/) (for PostgreSQL)
- A Kick developer app — register at [kick.com/settings/developer](https://kick.com/settings/developer)

## Quick start

```sh
# 1. Start PostgreSQL
docker compose up -d

# 2. Copy the environment template and fill in the platform app credentials
cp .env.example .env
$EDITOR .env

# 3. Install dependencies (from monorepo root or this directory)
bun install

# 4. Start the server in watch mode
bun run dev
```

The server starts on `http://localhost:3000` (or `PORT` from your `.env`).  
Migrations run automatically on first startup — no manual setup needed.

## Environment variables

| Variable               | Default                                    | Description                                                                                                     |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `PORT`                 | `3000`                                     | HTTP + WebSocket listen port                                                                                    |
| `DATABASE_URL`         | —                                          | PostgreSQL connection string — `postgres://user:pass@host:port/db`. Bun also accepts `POSTGRES_URL` or `PGURL`. |
| `KICK_CLIENT_ID`       | —                                          | From [kick.com/settings/developer](https://kick.com/settings/developer)                                         |
| `KICK_CLIENT_SECRET`   | —                                          | From [kick.com/settings/developer](https://kick.com/settings/developer)                                         |
| `KICK_REDIRECT_URI`    | `http://localhost:3000/auth/kick/callback` | Must match the URI registered in your Kick app                                                                  |
| `KICK_WEBHOOK_URL`     | —                                          | Public HTTPS URL that Kick POSTs events to (`/webhook/kick`)                                                    |
| `KICK_WEBHOOK_SECRET`  | —                                          | HMAC secret for verifying Kick payloads — generate with `openssl rand -hex 32`                                  |
| `TWITCH_CLIENT_ID`     | —                                          | Confidential Twitch app ID for public Helix requests and desktop sign-in                                        |
| `TWITCH_CLIENT_SECRET` | —                                          | Confidential Twitch app secret                                                                                  |
| `YOUTUBE_API_KEY`      | —                                          | Optional key for YouTube channel resolution and the anonymous gRPC relay                                        |

## Local webhook testing (ngrok)

Kick requires a public HTTPS URL to deliver webhook events.  
For local development, use [ngrok](https://ngrok.com):

```sh
ngrok http 3000
# Copy the https://... URL and set it in .env:
# KICK_WEBHOOK_URL=https://<your-id>.ngrok.io/webhook/kick
```

## Scripts

| Script       | Command                            | Description                                  |
| ------------ | ---------------------------------- | -------------------------------------------- |
| `dev`        | `bun --watch src/index.ts`         | Start with file-watching (auto-restart)      |
| `start`      | `bun src/index.ts`                 | Start without watching (production-like)     |
| `build:prod` | typechecks + `bun build --compile` | Compile to single binary in `.out/backend`   |
| `typecheck`  | `tsgo --noEmit`                    | Type-check with `@typescript/native-preview` |
| `test`       | `bun test tests/`                  | Run tests                                    |

## HTTP endpoints

| Method   | Path                      | Auth                     | Description                                                      |
| -------- | ------------------------- | ------------------------ | ---------------------------------------------------------------- |
| `GET`    | `/ws`                     | `X-Client-Secret` header | WebSocket upgrade — desktop client connection                    |
| `POST`   | `/api/auth/kick/start`    | body `clientSecret`      | Start Kick PKCE OAuth flow; returns `{ url }` to open in browser |
| `GET`    | `/auth/kick/callback`     | —                        | Kick OAuth redirect target (browser)                             |
| `GET`    | `/api/accounts`           | `X-Client-Secret` header | List connected platform accounts for this client                 |
| `DELETE` | `/api/accounts/:platform` | `X-Client-Secret` header | Disconnect a platform account                                    |
| `POST`   | `/webhook/kick`           | HMAC signature           | Receive Kick event webhooks                                      |
| `GET`    | `/health`                 | —                        | Health check — returns `{ ok: true }`                            |

### Client authentication

Routes that require desktop authentication use the `X-Client-Secret` header. The desktop app generates this identifier on first launch and persists it locally. New identifiers are registered on first use.

## Architecture

- **`Bun.sql`** — connects to PostgreSQL using `POSTGRES_*` env vars automatically; no extra driver config needed.
- **Migrations** — run on startup via `runMigrations()` (`src/db/migrations.ts`); creates `desktop_clients`, `platform_accounts`, and `kick_oauth_sessions` tables.
- **WebSocket** — `GET /ws` upgraded by `Bun.serve`; messages use the shared protocol from `@twirchat/shared/protocol`.
- **Kick OAuth** — PKCE flow; session stored in DB during the OAuth dance, then exchanged for tokens and saved to `platform_accounts`.
- **Kick webhooks** — HMAC-verified POST to `/webhook/kick`; normalized events are broadcast to all connected desktop clients over WebSocket.

## Provider emotes and cosmetics relay

The desktop fetches 7TV, FFZ and BTTV catalogs, personal emote sets, provider badges,
7TV cosmetics and opted-in presence through this backend. Native image downloads and
OBS message payloads use the image relay too; an existing local image-cache entry
keeps its original source URL identity and remains reusable.

| Method | Path                               | Auth            | Purpose                                         |
| ------ | ---------------------------------- | --------------- | ----------------------------------------------- |
| GET    | /proxy/provider-image?url=…        | Public asset    | Exact upstream image bytes and format           |
| GET    | /api/provider-metadata?url=…       | X-Client-Secret | Allowlisted catalog/user/set/badge requests     |
| POST   | /api/provider-metadata?url=…       | X-Client-Secret | Fixed 7TV cosmetics lookup or opted-in presence |
| GET    | /proxy/7tv/:id?size=4x&format=webp | Public asset    | Compatible legacy 7TV image URL                 |

Image targets are HTTPS assets on cdn.7tv.app/io, cdn.betterttv.net and
cdn.frankerfacez.com. The relay preserves GIF/WebP/AVIF/static variants and FFZ
animated paths; it does not reconstruct every image as WebP. Metadata targets are
limited to the specific existing 7TV, FFZ and BTTV API paths used by the desktop.
Client credentials and cookies are never forwarded, redirects are rejected, and
arbitrary GraphQL queries are not accepted.

The shared FIFO cache holds at most 512 entries / 96 MiB, with coalesced requests,
eight concurrent upstream requests, 128 pending requests and a ten-second deadline
including queue time. Individual image/metadata responses are capped while streaming
at 20 MiB / 8 MiB. Successful image/catalog/cosmetics TTLs are 24 hours / five
minutes / one minute; 404s cache for 30 seconds. Presence is never cached and is
still sent only when the desktop user has opted in.

Deploy the backend routes together with the updated desktop. Users download provider
content from their configured TwirChat backend; only that backend needs upstream
provider connectivity. Public image responses contain no account credentials and
allow ordinary OBS browser image requests.

## External Twitch message history

`POST /api/twitch/history` requires `X-Client-Secret`. Desktop never contacts history providers
directly. Default recent sources are rm.lilb.dev, recent-messages.robotty.de,
recent-messages.zneix.eu, logs.zonian.dev and rm.iore.tv. The Zonian archive adapter also handles
channel/user logs with explicit time bounds, including numeric Twitch user IDs.

Set `TWITCH_HISTORY_PROVIDERS` to a JSON array of `{id,kind,url,maxMessages?}` to change or combine
sources without updating desktop. Recent URL templates contain `{channel}`; archive URLs are
Rustlog-compatible base URLs. An empty value uses defaults; `[]` disables external history.
See [.env.example](.env.example). Restart backend after changing its environment.

The request accepts `channel`, `limit` (1–1000), optional `username`/`userId`, literal `text`,
exclusive `after`/`before` epoch milliseconds, `archive`, and `beforeId` for stable pagination
within the final millisecond (`before = cursor timestamp + 1`). Results contain raw Twitch IRC
lines; `beforeIdInclusive` retains an equal ID from an earlier channel/platform in a composite
desktop cursor. Responses include
source statuses/capabilities and explicit `partial`/`truncated` flags. Recent providers use
received-time cursors, so the gateway fetches their complete bounded window and applies Twitch
send-time/ID filters itself. Archive requests always include from/to; undated latest-month/day
redirects cannot silently narrow a requested date range.

The service merges original Twitch IDs per normalized channel, preserves configured source
priority and suppresses IDs marked deleted by any fetched source. It never merges two different
Twitch IDs merely because their text is equal. Recent source windows and final queries have
separate coalesced caches sharing a 16 MiB payload budget (128 entries each). Upstream concurrency
is limited to 16, the queue to 512, query singleflight to 64. Archive scans stop after 16 pages,
five seconds or 4 MiB total decoded payload per provider and report partial results when bounded.
Provider opt-outs, unlogged channels, retention windows and outages remain visible limitations.

Desktop imports history through an insert-ignore path, preserving live/local payloads. Initial
home/watched history and reconnects publish cold snapshots, without live notifications, counters
or OBS replay. Channel/date/text logs, user-card logs and transcript exports use the same gateway;
open-chat searches see the hydrated buffers. Exports stage pages in temporary file-backed SQLite
so remote history does not replace the active database or require an unbounded in-memory array.
An export over one million messages fails explicitly; narrow its date/channel filter.

Users can disable third-party history in Settings → Chat logging → Load Twitch history through
backend. This leaves local logs available. Providers only know logs they retained; this feature
does not promise complete history for every Twitch channel. Deploy the updated backend and
desktop together; no running backend or user application is restarted by these code changes.

Protocol references: [Robotty API](https://recent-messages.robotty.de/api),
[Zonian](https://logs.zonian.dev/api), [Rustlog OpenAPI](https://logs.ivr.fi/openapi.json),
[Leafyrino implementation](https://github.com/Leafyzito/leafyrino/blob/leafyrino/src/providers/recentmessages/Impl.cpp),
[Twitch IRC](https://dev.twitch.tv/docs/chat/irc).
