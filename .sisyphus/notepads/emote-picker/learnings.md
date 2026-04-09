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
