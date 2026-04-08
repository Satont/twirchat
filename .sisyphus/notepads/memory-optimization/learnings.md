# Memory Optimization - Learnings

## [2026-04-08] Session Start

- Plan: memory-optimization
- Boulder: /home/satont/Projects/twirchat/.sisyphus/boulder.json
- Evidence dir: /home/satont/Projects/twirchat/.sisyphus/evidence/

## Key Architecture Facts

- `mentionColorCache` is MODULE-SCOPED in `useMessageParsing.ts` (NOT in ChatMessage.vue)
- App.vue uses Pinia for accounts/settings/channelStatus, but message buffers (messages/events/watchedMessages) are raw refs
- Desktop uses Electrobun + CEF. CEF contributes ~150-300MB shared pages to htop RES on Linux
- Real private memory is measured via /proc/$PID/smaps (USS = Private_Clean + Private_Dirty)
- `process.title = 'TwirChat'` set in src/bun/index.ts - use pgrep TwirChat to find PID
- `bun run --cwd packages/desktop dev` runs BOTH Vite (5173) AND bun process in parallel
- Overlay server is on port 45823; dev test endpoint goes on port 45824
- `vue-tsc --noEmit` for frontend type checking (NOT tsgo)

## Tool Chain

- Monorepo root: /home/satont/Projects/twirchat
- `bun run fix` from monorepo root (formats + fixes lint)
- `bun run check` = typecheck + lint + format check (monorepo root)
- `bun run --cwd packages/desktop typecheck` = vue-tsc

## Critical Guardrails

- DO NOT use reactive() on mentionColorCache
- DO NOT migrate messages/events/watchedMessages to Pinia
- DO NOT use vue-virtual-scroller - use virtua
- DO NOT apply virtua to WatchedChannelsView or EventsFeed (ChatList.vue only)
- DO NOT add @ts-ignore or lint exceptions
- DO NOT add LRU cache library - simple .size > 2000 → .clear() is sufficient

## [2026-04-08 22:15:06] Task 1: Baseline Measurement

=== Date: Wed Apr 8 22:15:06 MSK 2026 ===
=== htop RES (VmRSS) ===
VmRSS: 5908 kB
=== Idle Private RSS (USS = Private_Clean + Private_Dirty) ===
USS: 0.363281 MB

## [2026-04-08] Task 3: Kick fix applied

- ws.close() + ws = null added at start of connectPusher()

## [2026-04-08 22:15:06] Task 2: YouTube fix applied

- clearTimeout guard added before setTimeout in scheduleReconnect()

## [2026-04-08 22:22:00] Task 4: Twitch fix applied

- connectChatClient guard added with async quit + try/catch

## [2026-04-08 22:35:00] Task 5: mentionColorCache fix

- reactive() removed, plain Map
- size cap added before set()
