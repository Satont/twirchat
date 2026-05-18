# Chat Moderation Plan — Learnings

## Project Conventions
- Runtime: Bun (not node/npm)
- Frontend typecheck: `vue-tsc --noEmit` (NOT tsgo — Vue SFC require Vue Language Tools)
- Backend typecheck: `tsgo --noEmit`
- Lint/format: `bun run fix` (oxlint + oxfmt), then `bun run check`
- Tests: `bun test`
- Monorepo root: `/home/satont/Projects/twirchat`
- Desktop package: `packages/desktop`
- Backend package: `packages/backend`
- Shared types: `packages/shared/types.ts`

## Electrobun RPC Pattern
- Schema in `packages/desktop/src/shared/rpc.ts`
- Main process handlers in `packages/desktop/src/bun/index.ts`
- Webview calls via `rpc.request.*` (from `Electroview.defineRPC`)

## Pinia / Stores
- Settings: `settingsStore` with `storeToRefs`
- Accounts: `accountStore.findByPlatform(platform)`
- Store files: `packages/desktop/src/store/`

## Hotkeys System (prev feature — patterns to reuse)
- Composables in `packages/desktop/src/views/main/composables/`
- CSS vars scoped to `.app.dark` don't reach Teleported components — sync class to `document.body`
- App uses Pinia stores consistently
