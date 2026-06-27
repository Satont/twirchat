# TwirChat: Full Deno Monorepo Migration

## Overview

Migrate `packages/backend` from Bun to Deno, making the entire monorepo a Deno project. Replace `Bun.serve()` with ElysiaJS, `Bun.sql` with postgres.js, and consolidate all packages under a root `deno.json`.

## Decisions

| Decision          | Choice                                | Rationale                                                              |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| HTTP framework    | ElysiaJS (npm:elysia)                 | Type-safe routes, built-in WebSocket, validation, Bun-compatible API   |
| PostgreSQL driver | postgres.js (npm:postgres)            | Template tag syntax similar to Bun.sql, well-maintained, works in Deno |
| Config validation | zod (keep)                            | Works in Deno via npm:, already used                                   |
| Monorepo root     | Root deno.json with workspace imports | Deno native monorepo support                                           |
| Desktop runtime   | deno desktop                          | Already migrated                                                       |
| Backend runtime   | deno run                              | Standard Deno runtime                                                  |

## Architecture

### Current (Bun backend)

```
packages/backend/
├── src/index.ts          — Bun.serve() with routes + WebSocket
├── src/config.ts         — process.env via zod
├── src/db/store.ts       — sql`template tags` from 'bun'
├── src/db/migrations.ts  — sql`CREATE TABLE...`
├── src/routes/*.ts       — Route handlers
├── src/ws/*.ts           — WebSocket handlers
└── package.json          — Bun dependencies
```

### Target (Deno backend)

```
packages/backend/
├── deno.json             — Package config + imports
├── src/index.ts          — Elysia + Deno.serve(app.fetch)
├── src/config.ts         — Deno.env via zod
├── src/db/store.ts       — sql`template tags` from 'postgres'
├── src/db/migrations.ts  — sql`CREATE TABLE...`
├── src/routes/*.ts       — Route handlers (minimal changes)
├── src/ws/*.ts           — WebSocket handlers (Elysia .ws())
└── (no package.json)
```

## Monorepo Structure

### Root deno.json

```jsonc
{
  "workspace": ["packages/shared", "packages/backend", "packages/desktop"],
  "imports": {
    "@twirchat/shared": "./packages/shared/index.ts",
    "@twirchat/shared/": "./packages/shared/",
  },
}
```

Each package gets its own `deno.json` with package-specific config.

### packages/backend/deno.json

```jsonc
{
  "name": "@twirchat/backend",
  "version": "0.0.1",
  "imports": {
    "elysia": "npm:elysia",
    "postgres": "npm:postgres",
    "zod": "npm:zod",
    "@twirchat/shared": "../shared/index.ts",
    "@twirchat/shared/": "../shared/",
  },
  "tasks": {
    "dev": "deno run --allow-all --watch src/index.ts",
    "start": "deno run --allow-all src/index.ts",
    "typecheck": "deno check src/index.ts",
    "test": "deno test --allow-all tests/",
  },
}
```

## Migration Map

### Bun → Deno API Replacements

| Bun API                            | Deno Replacement                         | Files                                     |
| ---------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `Bun.serve({ routes, websocket })` | `new Elysia()` + `Deno.serve(app.fetch)` | `src/index.ts`                            |
| `sql\`...\`` from 'bun'            | `sql\`...\`` from 'postgres'             | `src/db/store.ts`, `src/db/migrations.ts` |
| `process.env`                      | `Deno.env.get()`                         | `src/config.ts`                           |
| `process.exit(1)`                  | `Deno.exit(1)`                           | `src/config.ts`, `src/db/migrations.ts`   |
| `server.upgrade(req)`              | Elysia `.ws()` handler                   | `src/index.ts`                            |
| `server.timeout(req, 0)`           | Not needed (Elysia handles this)         | `src/index.ts`                            |
| `import.meta.dir`                  | `import.meta.dirname`                    | If used                                   |

### ElysiaJS Route Pattern

Current (Bun routes):

```typescript
const server = Bun.serve({
  routes: {
    '/health': () => json({ ok: true }),
    '/api/accounts': accountRoutes,
    // ...
  },
  fetch(req) {
    /* fallback */
  },
  websocket: { open, message, close },
})
```

Target (Elysia):

```typescript
const app = new Elysia()
  .get('/health', () => ({ ok: true }))
  .use(authRoutes)
  .use(accountRoutes)
  .use(streamRoutes)
  .use(webhookRoutes)
  .ws('/ws', {
    open(ws) {
      handleWsOpen(ws)
    },
    message(ws, msg) {
      handleWsMessage(ws, msg)
    },
    close(ws) {
      handleWsClose(ws)
    },
  })

Deno.serve({ port: config.PORT }, app.fetch)
```

### PostgreSQL Migration

Current (Bun.sql):

```typescript
import { sql } from 'bun'

const rows = await sql<Row[]>`
  SELECT * FROM desktop_clients WHERE secret = ${secret}
`
```

Target (postgres.js):

```typescript
import postgres from 'postgres'

const sql = postgres(Deno.env.get('DATABASE_URL')!)

const rows = await sql<Row[]>`
  SELECT * FROM desktop_clients WHERE secret = ${secret}
`
```

The template tag syntax is nearly identical. Main differences:

- Connection setup: `postgres(url)` instead of Bun's auto-connect from `DATABASE_URL`
- Type parameter syntax: `sql<Row[]>` works the same
- `sql` from postgres.js returns arrays directly (same as Bun.sql)

### Config Migration

Current:

```typescript
const result = envSchema.safeParse(process.env)
if (!result.success) process.exit(1)
```

Target:

```typescript
const result = envSchema.safeParse(Deno.env.toObject())
if (!result.success) Deno.exit(1)
```

## Files Changed

### packages/backend — Modified

| File                   | Changes                                              |
| ---------------------- | ---------------------------------------------------- |
| `src/index.ts`         | Bun.serve → Elysia + Deno.serve                      |
| `src/config.ts`        | process.env → Deno.env, process.exit → Deno.exit     |
| `src/db/store.ts`      | import sql from 'postgres' instead of 'bun'          |
| `src/db/migrations.ts` | import sql from 'postgres', process.exit → Deno.exit |
| `src/routes/*.ts`      | Minimal: Elysia route syntax (mostly same handlers)  |
| `src/ws/handlers.ts`   | Adapt to Elysia WebSocket API                        |

### packages/backend — New

| File        | Purpose                        |
| ----------- | ------------------------------ |
| `deno.json` | Package config, imports, tasks |

### packages/backend — Removed

| File           | Reason                |
| -------------- | --------------------- |
| `package.json` | Replaced by deno.json |

### Root — Modified

| File               | Changes                                 |
| ------------------ | --------------------------------------- |
| `deno.json` (root) | Add workspace config for all 3 packages |

## Dependencies

### packages/backend/deno.json imports

```jsonc
{
  "imports": {
    "elysia": "npm:elysia",
    "postgres": "npm:postgres",
    "zod": "npm:zod",
    "@urql/core": "npm:@urql/core",
    "graphql": "npm:graphql",
    "@twirchat/shared": "../shared/index.ts",
    "@twirchat/shared/": "../shared/",
  },
}
```

## Risks

1. **ElysiaJS Bun dependency**: Elysia uses uWebSocket which is Bun-native. In Deno it works via `Deno.serve(app.fetch)` but WebSocket might need `Deno.upgradeWebSocket` fallback.
2. **postgres.js template tags**: Syntax is similar to Bun.sql but not identical — need to verify all queries work.
3. **npm: specifier compatibility**: All npm packages (elysia, postgres, zod, @urql/core, graphql) need to work under Deno's npm: specifier.
4. **GraphQL codegen**: The 7TV GraphQL codegen setup uses `@graphql-codegen/cli` which is Bun-specific. May need adaptation for Deno.
