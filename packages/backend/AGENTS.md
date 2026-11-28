# TwirChat Backend

Bun HTTP/WebSocket server. Handles OAuth, account storage, platform webhooks, and desktop client connections.

## OVERVIEW

Backend service for TwirChat desktop app. PostgreSQL for persistence. WebSocket for real-time desktop communication. Kick webhooks for event ingestion.

## STRUCTURE

```
src/
├── index.ts                  # Bun.serve entry point
├── config.ts                 # Environment config loader
├── db/
│   ├── index.ts             # Database exports
│   ├── store.ts             # Data access layer (ClientStore, AccountStore)
│   └── migrations.ts        # Schema migrations
├── auth/
│   ├── kick.ts              # Kick OAuth + callback
│   ├── kick-webhook.ts      # Kick webhook handler
│   └── kick-subscriptions.ts # Kick EventSub management
├── api/
│   ├── channels-status.ts   # Channel live status aggregation
│   ├── kick-chatroom.ts     # Kick chatroom lookup
│   ├── search-categories.ts # Twitch category search
│   ├── stream-status.ts     # Stream status aggregation
│   ├── twitch-badges.ts     # Twitch badge fetching
│   └── update-stream.ts     # Stream metadata updates
├── routes/
│   ├── auth.ts              # OAuth callback routes
│   ├── accounts.ts          # Account management
│   ├── stream.ts            # Stream endpoints
│   ├── webhooks.ts          # Platform webhooks
│   └── utils.ts             # Response helpers
└── ws/
    ├── connection-manager.ts # WS client registry
    └── handlers.ts          # WS message handlers
```

## WHERE TO LOOK

| Task                  | Location                       | Notes                          |
| --------------------- | ------------------------------ | ------------------------------ |
| Add HTTP route        | `src/routes/*.ts`              | Register in `src/index.ts`     |
| Add WS handler        | `src/ws/handlers.ts`           | Add to handlers object         |
| DB schema change      | `src/db/migrations.ts`         | Add migration, runs on startup |
| Add platform OAuth    | `src/auth/{platform}.ts`       | Follow PKCE pattern            |
| Kick webhook handling | `src/auth/kick-webhook.ts`     | Verify HMAC signature          |
| Query database        | `src/db/store.ts`              | Use `sql` template tag         |
| Send WS to desktop    | `src/ws/connection-manager.ts` | `sendToClient()`               |

## ENTRY POINTS

| File                   | Purpose          | When It Runs                  |
| ---------------------- | ---------------- | ----------------------------- |
| `src/index.ts`         | Bun.serve server | Always                        |
| `src/db/migrations.ts` | DB schema        | Runs automatically on startup |

## CONVENTIONS

**Database Access**

```typescript
// Use Bun.sql template tag for safe parameterization
const result = await sql`SELECT * FROM platform_accounts WHERE platform = ${platform}`

// Upsert pattern
await sql`
  INSERT INTO platform_accounts (platform, platform_user_id, ...)
  VALUES (${platform}, ${userId}, ...)
  ON CONFLICT (desktop_client_id, platform) 
  DO UPDATE SET access_token = ${token}, ...
`

// Map snake_case DB to camelCase JS
const mapAccount = (row: any): Account => ({
  platform: row.platform,
  platformUserId: row.platform_user_id,
  // ...
})
```

**WebSocket Protocol**

- Desktop connects to `/ws` with `X-Client-Secret` header
- Server upserts client in `desktop_clients` table
- Messages follow `@twirchat/shared/protocol.ts` types

**Error Handling**

```typescript
// Return structured HTTP errors
return Response.json({ error: 'Invalid platform' }, { status: 400 })

// Log with context
log.error('Auth failed', { platform, error: String(err) })
```

**Type Checking**

- Use `tsgo --noEmit` (native TypeScript compiler preview)
- NOT `vue-tsc` - this is backend code
- Suppressions: `// @ts-ignore — false positive in tsgo for workspace packages`

## ANTI-PATTERNS (THIS PACKAGE)

- **DON'T** use `better-sqlite3`, `pg`, `postgres.js` — use `Bun.sql`
- **DON'T** skip HMAC verification on Kick webhooks — always verify signature
- **DON'T** log full client secrets — only `slice(0, 8)` prefixes if needed
- **DON'T** use `@ts-ignore` without explaining why (prefer `@ts-expect-error` with reason)
- **AVOID** adding new `@ts-ignore` comments — fix underlying type issues

## SECURITY

**Kick Webhooks**

- Verify HMAC-SHA256 signature using `KICK_WEBHOOK_SECRET`
- Reject requests with invalid signatures
- Secret generated via: `openssl rand -hex 32`

**Client Authentication**

- Desktop generates random secret on first launch
- WebSocket upgrades require `X-Client-Secret`; for HTTP, inspect each route’s authentication
- Secret stored in `desktop_clients` table, auto-registered on first use

**OAuth Flows**

- Hosted Kick and MemeAlerts use PKCE primitives from `@twirchat/shared/pkce`.
- Twitch and YouTube user authorization runs in the desktop application.
- Tokens stored encrypted (desktop) or in DB (backend)
- Refresh tokens used for long-lived access

## COMMANDS

```bash
# Development with file watching
bun run dev

# Production start
bun run start

# Type check
bun run typecheck

# Build single binary
bun run build:prod

# Run tests with file isolation for provider mocks and caches
bun run test
```

## ENVIRONMENT VARIABLES

[`src/config.ts`](src/config.ts) owns startup validation and defaults. See the
[backend README](README.md#local-development) for local setup and production deployment links.
The [server entry point](src/index.ts) registers HTTP and WebSocket routes.

## NOTES

**Kick EventSub**

- Subscriptions managed in `kick-subscriptions.ts`
- Webhook events are normalized and routed to the channel owner's connected desktop clients

**7TV Integration**

- `src/seventv/client.ts` owns the GraphQL operations and validates responses at runtime.
- Both catalog lookups use the same emote-set selection and decoder; no code generation is required.

**Twitch Badges**

- Prefetched at backend startup
- Served to desktop via API

See root AGENTS.md for Bun-first API conventions.
