# Learnings — autocomplete plan

## [2026-04-09] Initial Setup

### Worktree
- Created at: `/home/satont/Projects/twirchat/worktrees/feat/chat-autocomplete-mentions-emotes`
- node_modules symlinked
- Branch: `feat/chat-autocomplete-mentions-emotes`

### Key Architecture Findings
- `sevenTVService` is a singleton in the Bun main process — NOT accessible from webview. RPC bridge required.
- `mentionColorCache` is currently module-private in `useMessageParsing.ts` — Map key format: `${platform}:${username.toLowerCase()}`
- `fuzzyFilter<T extends { label: string }>` exists at `packages/desktop/src/views/main/utils/fuzzyFilter.ts` — requires `label` field
- `ChatInput.vue` currently has no `messages` prop
- Dropdown pattern: `mousedown.prevent` — reference in `StreamEditor.vue`
- Kick: `sevenTvChannelId = broadcasterUserId` (string number), Twitch: `channelSlug`

### Constraints
- NO sevenTVService import in src/views/
- NO emote picker button
- NO Twitch/Kick/YouTube native emotes — only 7TV
- NO new HTTP endpoints on backend
- NO backend changes
- NO mentionColorCache duplication
- NO inline SVG — use .svg file imports
- Do NOT use @blur to close popup (race condition)
- Do NOT use Teleport
- Max 15 suggestions

### RPC Notes
- `packages/desktop/src/shared/rpc.ts` already imports `SevenTVEmote` from `@twirchat/shared/protocol`
- `WebviewSender` is fully derived from `WebviewMessages`; no manual update needed when adding push message types
- `packages/shared/types.ts` does not export `SevenTVEmote`; the canonical type lives in `packages/shared/protocol.ts`

### Working Directory for all tasks
`/home/satont/Projects/twirchat/worktrees/feat/chat-autocomplete-mentions-emotes`

### 2026-04-09 Export cache note
- `mentionColorCache` in `useMessageParsing.ts` now needs to be exported for cross-module reuse.
- Frontend typecheck completed successfully after the single-line export change.
