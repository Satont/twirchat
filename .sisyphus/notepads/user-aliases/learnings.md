# Learnings — user-aliases

## Project Conventions
- Aliases keyed by (platform, platform_user_id) — stable across username changes
- bun:sqlite queries — raw SQL in store files, never in views/
- Pinia setup stores in `src/views/main/stores/`
- rpc.ts is shared between bun and webview — NO bun:sqlite imports allowed
- Both modern + compact chat themes must be handled in ChatMessage.vue
- System messages have no author → guard with `v-if="!isSystemMessage"`
- Empty alias submit = remove alias (clear = remove UX)
- Max alias length: 50 characters
- ChatList resolves aliases locally via Pinia store: `useAliasStore().getAlias(platform, author.id)`
- `ChatMessage` can receive only the resolved alias string; no alias map prop needed
