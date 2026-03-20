# @twirchat/backend

Backend service for TwirChat — handles platform OAuth, account storage, WebSocket connections to the desktop app, and Kick webhook ingestion.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [Docker](https://docs.docker.com/get-docker/) (for PostgreSQL)
- A Kick developer app — register at [kick.com/settings/developer](https://kick.com/settings/developer)

## Quick start

```sh
# 1. Start PostgreSQL
docker compose up -d

# 2. Copy env template and fill in your Kick credentials
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

| Variable              | Default                                    | Description                                                                                                     |
| --------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `PORT`                | `3000`                                     | HTTP + WebSocket listen port                                                                                    |
| `DATABASE_URL`        | —                                          | PostgreSQL connection string — `postgres://user:pass@host:port/db`. Bun also accepts `POSTGRES_URL` or `PGURL`. |
| `KICK_CLIENT_ID`      | —                                          | From [kick.com/settings/developer](https://kick.com/settings/developer)                                         |
| `KICK_CLIENT_SECRET`  | —                                          | From [kick.com/settings/developer](https://kick.com/settings/developer)                                         |
| `KICK_REDIRECT_URI`   | `http://localhost:3000/auth/kick/callback` | Must match the URI registered in your Kick app                                                                  |
| `KICK_WEBHOOK_URL`    | —                                          | Public HTTPS URL that Kick POSTs events to (`/webhook/kick`)                                                    |
| `KICK_WEBHOOK_SECRET` | —                                          | HMAC secret for verifying Kick payloads — generate with `openssl rand -hex 32`                                  |

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

Every request (except OAuth callbacks, webhooks, and `/health`) requires an `X-Client-Secret` header.  
The desktop app generates a random secret on first launch and persists it locally. New secrets are auto-registered on first use.

## Architecture

- **`Bun.sql`** — connects to PostgreSQL using `POSTGRES_*` env vars automatically; no extra driver config needed.
- **Migrations** — run on startup via `runMigrations()` (`src/db/migrations.ts`); creates `desktop_clients`, `platform_accounts`, and `kick_oauth_sessions` tables.
- **WebSocket** — `GET /ws` upgraded by `Bun.serve`; messages use the shared protocol from `@twirchat/shared/protocol`.
- **Kick OAuth** — PKCE flow; session stored in DB during the OAuth dance, then exchanged for tokens and saved to `platform_accounts`.
- **Kick webhooks** — HMAC-verified POST to `/webhook/kick`; normalized events are broadcast to all connected desktop clients over WebSocket.
