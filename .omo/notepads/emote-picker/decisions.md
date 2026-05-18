# Emote Picker — Decisions

## Architecture Decisions
- EmotePicker.vue is a PURE DISPLAY COMPONENT (no Popover primitives)
  - PopoverRoot/Trigger/Content live in ChatInput.vue
  - EmotePicker receives platform + channelId props, emits 'select' with alias
- useEmoteCache is a singleton composable (module-level state)
  - emoteCache = ref<Map<string, SevenTVEmote[]>>(new Map())
  - listenersRegistered = false (only register RPC listeners once)
- VGrid scroll reset via watch(filteredEmotes, () => gridRef.value?.scrollToIndex(0))
- Insertion logic: test ONLY via Playwright (no changes to autocompleteUtils.ts)
