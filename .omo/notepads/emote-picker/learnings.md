# Emote Picker — Learnings

## Project Structure
- Worktree: /home/satont/Projects/twirchat/worktrees/feat/emote-picker
- Desktop package: packages/desktop/
- Frontend: packages/desktop/src/views/main/ (Vue 3 SFC via Vite)
- Composables: packages/desktop/src/views/main/composables/
- Components: packages/desktop/src/views/main/components/
- Tests: packages/desktop/tests/

## Key Dependencies
- `virtua@0.49.0` installed - has `VGrid` for Vue grids
- `reka-ui` - has `PopoverRoot/Trigger/Content` - already used in ChatAppearancePopover.vue
- `fuzzyFilter` - in packages/desktop/src/views/main/utils/fuzzyFilter.ts - requires `{label: string}` shape
- `SevenTVEmote` type has `.alias` not `.label` - must map before fuzzyFilter

## Critical Patterns
- `useEmoteCache` must be a MODULE-LEVEL singleton (ref outside function, `let listenersRegistered = false`)
- VGrid container needs FIXED `height: 360px` (NOT max-height) for scroll container detection
- Popover CSS for portalled content (reka-ui) must be NON-SCOPED in ChatInput.vue
- EmotePicker.vue uses SCOPED styles for its internal layout
- Two-branch insertion: Branch 1 = active :token → replaceToken; Branch 2 = cursor position insert

## Files to NOT Modify
- packages/desktop/src/views/main/utils/autocompleteUtils.ts
- packages/desktop/src/views/main/utils/fuzzyFilter.ts
- useAutocomplete's PUBLIC API must remain unchanged (suggestions, isOpen, selectedIndex, mode, selectSuggestion, moveUp, moveDown, close)

## 2026-04-09

- `useEmoteCache` must be a module-level singleton so repeated composable calls share the same Map.
- Bun tests in this worktree need an explicit `mock.module('vue', ...)` shim for composables that import Vue runtime APIs.
- `bun test` passed for the new cache tests, but desktop `vue-tsc` still fails in this environment because workspace deps are unresolved (`vue`, `pinia`, `@twurple/*`, `youtubei.js`, `@babylonjs/core`).

## EmotePicker Implementation
- virtua/vue only exports VList, Virtualizer, WindowVirtualizer. No VGrid. Emulating grid by chunking items into rows and rendering a flex row in each VList item works perfectly.
- fuzzyFilter requires objects with a `label: string` property. When mapping items for fuzzyFilter, `Object.assign({}, item, { label: item.alias })` should be used instead of spread syntax (`{ ...item, label: item.alias }`) to avoid oxlint warning `oxc(no-map-spread)`.
- Use fixed inline `style="height: Xpx"` for VList, `max-height` doesn't work correctly.

- **Popover Component Pattern**:  provides a solid pattern for dropdowns like emote pickers. We used `PopoverRoot` with a `v-model:open` for the trigger, `PopoverContent` set to `portalled` (meaning any scoped CSS on it wouldn't apply, so it requires a non-scoped CSS block).
- **Two-Branch Emote Insertion**: It's crucial to check if the user is currently typing a token (`parseToken`) when they click an emote. If they are, use `replaceToken` to replace the current `:alias` with the selected emote. Otherwise, read the cursor position (`textareaEl.selectionStart`), slice the text value, and inject the emote alias, then safely restore the cursor focus via `nextTick()`.

- **Popover Component Pattern**: `reka-ui` provides a solid pattern for dropdowns like emote pickers. We used `PopoverRoot` with a `v-model:open` for the trigger, `PopoverContent` set to `portalled` (meaning any scoped CSS on it wouldn't apply, so it requires a non-scoped CSS block).
- **Two-Branch Emote Insertion**: It's crucial to check if the user is currently typing a token (`parseToken`) when they click an emote. If they are, use `replaceToken` to replace the current `:alias` with the selected emote. Otherwise, read the cursor position (`textareaEl.selectionStart`), slice the text value, and inject the emote alias, then safely restore the cursor focus via `nextTick()`.

- **Popover Trigger Double Toggle**: When `PopoverTrigger as-child` is paired with `v-model:open`, do not manually toggle the open ref in the trigger click handler. Let reka-ui own the toggle and use a `watch(openRef, ...)` for side effects like focusing the emote picker.
2026-04-10: useEmoteCache should only cache non-empty RPC results; empty arrays must not write the cache so the picker can retry until channel_emotes_set arrives.
