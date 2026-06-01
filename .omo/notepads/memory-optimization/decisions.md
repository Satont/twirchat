# Memory Optimization - Decisions

## [2026-04-08] Architecture Decisions

### Task 1: Baseline measurement

- Use `bun run --cwd packages/desktop dev` to start app (NOT `start` alone)
- Wait 30s for idle baseline
- Save to .sisyphus/evidence/memory-baseline.txt

### Task 5: mentionColorCache

- Change from `reactive(new Map<>())` to plain `new Map<>()`
- Add size guard BEFORE set() calls: if (size > 2000) clear()
- Reactivity is safe to remove: messageParts computed recomputes when message changes (prop), not when cache changes

### Task 6: App.vue buffer mutations

- Use .unshift() + .length = cap instead of spread+slice
- For watchedMessages Map: mutate in-place + triggerRef()
- Import triggerRef from 'vue'

### Task 7: ChatList virtua

- Use VList from 'virtua/vue'
- Pass activeMessages directly (no .reverse())
- Use :reverse="true" prop on VList for bottom-anchoring
- Remove flex-direction: column-reverse CSS if present
- Check useChatScroll.ts for scroll conflicts before integrating
