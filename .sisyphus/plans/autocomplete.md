# Chat Autocomplete — @username + :emote (Issues #46, #47)

## TL;DR

> **Quick Summary**: Add a fuzzy-search autocomplete popup to `ChatInput.vue` triggered by `@` (username mentions) and `:` (7TV emotes). Emotes live in the Bun main process and are exposed to the webview via a new RPC request + push messages.
>
> **Deliverables**:
> - `getChannelEmotes` RPC method + bun-side handler
> - `channel_emotes_set` / `channel_emote_added` / `channel_emote_removed` / `channel_emote_updated` webview push messages
> - `useAutocomplete.ts` composable
> - `AutocompletePopup.vue` component
> - Integration in `ChatInput.vue` (+ messages prop, keyboard handling)
> - Existing `mentionColorCache` exported and reused for username colors
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 (RPC schema) → Task 2 (bun handler) → Task 3 (composable) → Task 5 (ChatInput integration)

---

## Context

### Original Request
Реализовать систему автокомплита: `@username` из чата, `:emote` из 7TV, с fuzzy поиском и popup UI (аватар/картинка + имя). Переиспользовать существующий стор цветов пользователей.

### Interview Summary
**Key Discussions**:
- Только autocomplete (no emote picker button)
- Fuzzy search — `fuzzyFilter` уже есть в `utils/fuzzyFilter.ts`
- Эмоты: только 7TV, Twitch/Kick/YouTube native — вне scope
- Цвета пользователей: переиспользовать `mentionColorCache` из `useMessageParsing.ts`
- Только `:` и `@` — никаких новых иконок / кнопок
- Backend не трогаем

**Research Findings**:
- `sevenTVService` — **singleton в Bun main process**. В webview НЕ доступен. Нужен новый RPC.
- `mentionColorCache` — module-private Map в `useMessageParsing.ts` → нужно экспортировать
- `fuzzyFilter<T extends { label: string }>` — требует поле `label`. SevenTVEmote.alias → маппинг
- `ChatInput.vue` не имеет `messages` prop → нужно добавить для username кандидатов
- `ChatList.vue` не передаёт `messages` в `ChatInput` → нужно добавить
- Паттерн dropdown: `mousedown.prevent` чтобы не терять фокус textarea (взять из `StreamEditor.vue`)
- Kick: `sevenTvChannelId = broadcasterUserId` (строка числа), Twitch: `channelSlug`

### Metis Review
**Identified Gaps** (addressed):
- RPC нужен `getChannelEmotes` — без него Vue не может получить эмоты
- Push messages нужны для real-time обновлений emote set (add/remove/update)
- `mentionColorCache` нужно экспортировать из `useMessageParsing.ts`
- Enter при открытом popup должен вставлять suggestion, а не отправлять сообщение

---

## Work Objectives

### Core Objective
Добавить fuzzy autocomplete popup в `ChatInput.vue`, который срабатывает при вводе `@` (mentions) и `:` (7TV emotes), со списком подсказок с иконками.

### Concrete Deliverables
- `packages/desktop/src/shared/rpc.ts` — 1 новый request + 4 новых webview messages
- `packages/desktop/src/bun/index.ts` — handler + emote push on set/add/remove/update
- `packages/desktop/src/views/main/composables/useAutocomplete.ts` — новый composable
- `packages/desktop/src/views/main/components/AutocompletePopup.vue` — новый компонент
- `packages/desktop/src/views/main/components/ChatInput.vue` — интеграция
- `packages/desktop/src/views/main/components/ChatList.vue` — добавить messages prop в ChatInput
- `packages/desktop/src/views/main/composables/useMessageParsing.ts` — export mentionColorCache

### Definition of Done
- [ ] При вводе `@fo` в ChatInput появляется popup со списком имён из чата, fuzzy filtered
- [ ] При вводе `:pe` появляется popup с эмотами, fuzzy filtered
- [ ] Enter / Tab при открытом popup вставляет suggestion (не отправляет сообщение)
- [ ] Escape закрывает popup
- [ ] Стрелки вверх/вниз навигируют по списку
- [ ] `bun run check` проходит без ошибок

### Must Have
- Fuzzy поиск через существующий `fuzzyFilter`
- Цвета username через `mentionColorCache` (переиспользование, не дублирование)
- Popup появляется позиционированным над textarea (не под ней)
- mousedown.prevent на элементах списка (не теряем фокус textarea)
- Enter при открытом popup = вставить, не отправить

### Must NOT Have (Guardrails)
- NO импорта `sevenTVService` в frontend-файлы (`src/views/`)
- NO кнопки открытия полного emote picker (issue #47 part 2 — вне scope)
- NO поддержки Twitch/Kick/YouTube native emotes — только 7TV
- NO новых HTTP endpoints на backend
- NO изменений в backend
- NO дублирования `mentionColorCache` — только экспорт существующего
- NO inline SVG в Vue компонентах — использовать `.svg` файлы как компоненты

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (bun test, `tests/` directory)
- **Automated tests**: Tests-after — unit тест на `useAutocomplete` token parsing
- **Framework**: bun test

### QA Policy
- **Frontend/UI**: Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **Logic unit tests**: bun test — для parseToken utility

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — shared contracts):
├── Task 1: RPC schema additions (rpc.ts)           [quick]
└── Task 2: Export mentionColorCache                [quick]

Wave 2 (After Wave 1 — bun handler + frontend logic):
├── Task 3: Bun handler + push messages (bun/index.ts)   [unspecified-high]
│           (depends: Task 1)
└── Task 4: useAutocomplete.ts composable               [unspecified-high]
            (depends: Task 1, Task 2)

Wave 3 (After Wave 2 — UI):
├── Task 5: AutocompletePopup.vue component              [visual-engineering]
│           (depends: Task 4)
└── Task 6: ChatInput.vue + ChatList.vue integration     [visual-engineering]
            (depends: Task 4, Task 5)

Wave FINAL (After ALL tasks):
├── Task F1: Plan compliance audit        [oracle]
├── Task F2: Code quality review          [unspecified-high]
├── Task F3: Real manual QA               [unspecified-high + playwright]
└── Task F4: Scope fidelity check         [deep]
→ Present results → Get explicit user okay
```

### Dependency Matrix
- **T1**: - → T3, T4
- **T2**: - → T4
- **T3**: T1 → T6
- **T4**: T1, T2 → T5, T6
- **T5**: T4 → T6
- **T6**: T3, T4, T5 → FINAL

### Agent Dispatch Summary
- Wave 1: 2 quick tasks
- Wave 2: 2 unspecified-high tasks (parallel)
- Wave 3: 2 visual-engineering tasks (parallel)
- FINAL: 4 parallel review tasks

---

## TODOs

- [x] 1. Add RPC schema entries for emote access

  **What to do**:
  - In `packages/desktop/src/shared/rpc.ts`, add to `BunRequests`:
    ```typescript
    /** Get all 7TV emotes for a channel */
    getChannelEmotes: {
      params: { platform: Platform; channelId: string }
      response: SevenTVEmote[]
    }
    ```
  - Add import: `SevenTVEmote` from `@twirchat/shared/types` (check if already imported, if not add)
  - In `WebviewMessages`, add 4 new push message types:
    ```typescript
    /** Full emote set received for a channel */
    channel_emotes_set: { platform: Platform; channelId: string; emotes: SevenTVEmote[] }
    /** An emote was added to a channel */
    channel_emote_added: { platform: Platform; channelId: string; emote: SevenTVEmote }
    /** An emote was removed from a channel (by ID) */
    channel_emote_removed: { platform: Platform; channelId: string; emoteId: string }
    /** An emote alias was updated */
    channel_emote_updated: { platform: Platform; channelId: string; emoteId: string; newAlias: string }
    ```
  - Update `WebviewSender` type accordingly (it's auto-derived from `WebviewMessages` — check if it needs manual update)

  **Must NOT do**:
  - Do NOT add backend endpoints
  - Do NOT modify `@twirchat/shared/protocol.ts`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure type-level change to a single file, no logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 3, Task 4
  - **Blocked By**: None

  **References**:
  - `packages/desktop/src/shared/rpc.ts` — full file, understand existing structure and imports
  - `packages/shared/types.ts` — check if `SevenTVEmote` is already exported from `@twirchat/shared/types`
  - `packages/desktop/src/seventv/index.ts` — `SevenTVEmote` interface usage

  **Acceptance Criteria**:
  - [ ] `bun run typecheck` in `packages/desktop` passes with no new errors
  - [ ] `rpc.ts` contains `getChannelEmotes` in `BunRequests`
  - [ ] `rpc.ts` contains all 4 `channel_emote*` entries in `WebviewMessages`

  **QA Scenarios**:
  ```
  Scenario: TypeScript compiles without errors
    Tool: Bash
    Steps:
      1. cd packages/desktop && bun run typecheck
    Expected Result: exit code 0, no errors mentioning rpc.ts
    Evidence: .sisyphus/evidence/task-1-typecheck.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `feat(rpc): add getChannelEmotes request and channel_emote* push messages`
  - Files: `packages/desktop/src/shared/rpc.ts`
  - Pre-commit: `bun run typecheck`

- [x] 2. Export `mentionColorCache` from `useMessageParsing.ts`

  **What to do**:
  - In `packages/desktop/src/views/main/composables/useMessageParsing.ts`:
    - Change `const mentionColorCache = new Map<string, string | null>()` to be exported:
      `export const mentionColorCache = new Map<string, string | null>()`
  - That's it — do not change any other logic

  **Must NOT do**:
  - Do NOT refactor the cache structure
  - Do NOT add new cache logic
  - Do NOT change `fetchMentionColor` or `highlightMentions`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single `export` keyword addition
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `packages/desktop/src/views/main/composables/useMessageParsing.ts:10` — line to export

  **Acceptance Criteria**:
  - [ ] `mentionColorCache` is exported from `useMessageParsing.ts`
  - [ ] Other files importing from `useMessageParsing` still compile

  **QA Scenarios**:
  ```
  Scenario: Export is visible and importable
    Tool: Bash
    Steps:
      1. cd packages/desktop && bun run typecheck
    Expected Result: exit code 0
    Evidence: .sisyphus/evidence/task-2-typecheck.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(rpc): add getChannelEmotes request and channel_emote* push messages`
  - Files: `packages/desktop/src/views/main/composables/useMessageParsing.ts`

- [ ] 3. Implement Bun-side handler and emote push messages

  **What to do**:
  - In `packages/desktop/src/bun/index.ts`:

  1. **Add RPC request handler** for `getChannelEmotes` inside the `requests` object passed to `defineElectrobunRPC`:
     ```typescript
     getChannelEmotes: ({ platform, channelId }) => {
       return sevenTVService.getEmotes(platform, channelId)
     }
     ```

  2. **Push emote set on load**: Find where `sevenTVService.handleEmoteSet(...)` is called (it's called when backend sends a `seventv_emote_set` message). After calling `handleEmoteSet`, push to webview:
     ```typescript
     sendToView.channel_emotes_set({ platform, channelId, emotes: sevenTVService.getEmotes(platform, channelId) })
     ```

  3. **Push on emote add**: Find where `sevenTVService.handleEmoteAdded(...)` is called. After it:
     ```typescript
     sendToView.channel_emote_added({ platform, channelId, emote })
     ```

  4. **Push on emote remove**: Find where `sevenTVService.handleEmoteRemoved(...)` is called. After it:
     ```typescript
     sendToView.channel_emote_removed({ platform, channelId, emoteId })
     ```

  5. **Push on emote update**: Find where `sevenTVService.handleEmoteUpdated(...)` is called. After it:
     ```typescript
     sendToView.channel_emote_updated({ platform, channelId, emoteId, newAlias })
     ```

  **Must NOT do**:
  - Do NOT import sevenTVService anywhere in `src/views/`
  - Do NOT add HTTP endpoints
  - Do NOT change `sevenTVService` internals

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Requires understanding of bun/index.ts structure and finding the correct call sites
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 4)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 6
  - **Blocked By**: Task 1

  **References**:
  - `packages/desktop/src/bun/index.ts` — full file, find `defineElectrobunRPC` and `sevenTVService.handle*` call sites
  - `packages/desktop/src/seventv/index.ts` — `handleEmoteSet`, `handleEmoteAdded`, `handleEmoteRemoved`, `handleEmoteUpdated` signatures
  - `packages/desktop/src/shared/rpc.ts` (after Task 1) — `getChannelEmotes` request + `channel_emote*` message types
  - Pattern: existing RPC handlers like `getAccounts`, `getStatuses` for handler style reference

  **Acceptance Criteria**:
  - [ ] `rpc.request.getChannelEmotes({ platform: 'twitch', channelId: 'test' })` is handled without TypeScript error
  - [ ] `channel_emotes_set` is pushed when a 7TV emote set arrives from backend
  - [ ] `bun run typecheck` passes in packages/desktop (using `tsgo` for bun-side)

  **QA Scenarios**:
  ```
  Scenario: getChannelEmotes handler returns array
    Tool: Bash
    Steps:
      1. cd packages/desktop && bun run typecheck
    Expected Result: exit code 0, no type errors in bun/index.ts
    Evidence: .sisyphus/evidence/task-3-typecheck.txt

  Scenario: Push messages are wired
    Tool: Bash (grep)
    Steps:
      1. grep -n "channel_emotes_set\|channel_emote_added\|channel_emote_removed\|channel_emote_updated" packages/desktop/src/bun/index.ts
    Expected Result: 4 lines found (one per message type)
    Evidence: .sisyphus/evidence/task-3-grep.txt
  ```

  **Commit**: YES (groups with Task 1 commit or separate)
  - Message: `feat(rpc): implement getChannelEmotes handler and emote push messages in bun/index.ts`
  - Files: `packages/desktop/src/bun/index.ts`

- [ ] 4. Create `useAutocomplete.ts` composable

  **What to do**:
  Create `packages/desktop/src/views/main/composables/useAutocomplete.ts`:

  The composable must:
  1. Accept:
     - `text: Ref<string>` — the textarea model
     - `messages: Ref<NormalizedChatMessage[]>` — for username candidates
     - `watchedChannel: Ref<WatchedChannel | null | undefined>` — for emote context
     - `statuses: Ref<Map<string, PlatformStatusInfo>>` — for home tab context

  2. **Token detection**: Parse the current word being typed (word before cursor). Detect:
     - Token starting with `@` → mention mode, query = text after `@`
     - Token starting with `:` with ≥1 char after `:` → emote mode, query = text after `:`
     - Otherwise → no autocomplete

  3. **Username candidates**: Derived from `messages` — unique `author.displayName` values (deduplicated, case-preserving). Each item: `{ label: string; color: string | null }` where `color` comes from `mentionColorCache.get(`${platform}:${username.toLowerCase()}`)` (the exported map from Task 2).

  4. **Emote candidates**: Maintained via `rpc.on` listeners:
     - On `channel_emotes_set`: store `emotes` array in a `Ref<SevenTVEmote[]>` keyed by `${platform}:${channelId}`
     - On `channel_emote_added`: push to array
     - On `channel_emote_removed`: filter out by `emoteId`
     - On `channel_emote_updated`: update alias
     - On mount (or when `watchedChannel` changes): call `rpc.request.getChannelEmotes(...)` to seed the cache
     - Items for fuzzy: `{ label: string; imageUrl: string; animated: boolean }` where `label = emote.alias`

  5. **Fuzzy filtering**: use `fuzzyFilter` — map candidates to `{ label, ...rest }`, filter, return max 15 results

  6. **Exposed state**:
     - `suggestions: ComputedRef<AutocompleteSuggestion[]>` — filtered list
     - `isOpen: ComputedRef<boolean>` — `suggestions.length > 0 && query !== ''`
     - `selectedIndex: Ref<number>` — keyboard navigation
     - `mode: ComputedRef<'mention' | 'emote' | null>`

  7. **Actions**:
     - `selectSuggestion(index: number)`: replace the token in `text` with the suggestion (`@username ` or `alias `)
     - `moveUp()` / `moveDown()`: navigate selectedIndex with wrap-around
     - `close()`: clear query to close popup

  **Type definitions** (define at top of file):
  ```typescript
  export interface MentionSuggestion {
    type: 'mention'
    label: string      // displayName
    color: string | null
  }
  export interface EmoteSuggestion {
    type: 'emote'
    label: string      // alias
    imageUrl: string
    animated: boolean
  }
  export type AutocompleteSuggestion = MentionSuggestion | EmoteSuggestion
  ```

  **Must NOT do**:
  - Do NOT import `sevenTVService` — only use `rpc`
  - Do NOT duplicate `mentionColorCache` — only import the exported one
  - Do NOT add Pinia store — use local Refs
  - Do NOT exceed 15 suggestions in the list

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex composable with RPC subscription, reactive state, and token parsing logic
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Vue 3 composable patterns, Ref/ComputedRef, lifecycle hooks

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 3)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 5, Task 6
  - **Blocked By**: Task 1, Task 2

  **References**:
  - `packages/desktop/src/views/main/utils/fuzzyFilter.ts` — exact signature to use
  - `packages/desktop/src/views/main/composables/useMessageParsing.ts` — `mentionColorCache` (exported after Task 2), Map key format: `${platform}:${username.toLowerCase()}`
  - `packages/desktop/src/views/main/main.ts` — how `rpc` is imported in composables
  - `packages/shared/types.ts` — `NormalizedChatMessage`, `WatchedChannel`, `PlatformStatusInfo`, `SevenTVEmote`
  - `packages/desktop/src/views/main/stores/` — look at an existing store for Pinia pattern (we're NOT using Pinia here, but for composable style reference)
  - Test reference: `packages/desktop/tests/aggregator.test.ts` — bun test style

  **Acceptance Criteria**:
  - [ ] `bun run typecheck` passes (vue-tsc)
  - [ ] Unit test: `tests/useAutocomplete.test.ts` — test `selectSuggestion` token replacement with at least 3 cases:
    - `"hello @sa"` → select "satont" → `"hello @satont "`
    - `"test :pe"` → select "pepeHands" → `"test pepeHands "`
    - `"mid|text"` (cursor mid-word, no trigger) → no suggestions

  **QA Scenarios**:
  ```
  Scenario: Unit tests pass
    Tool: Bash
    Steps:
      1. cd packages/desktop && bun test tests/useAutocomplete.test.ts
    Expected Result: All tests pass, 0 failures
    Evidence: .sisyphus/evidence/task-4-tests.txt
  ```

  **Commit**: NO (commit with Task 5+6)

- [ ] 5. Create `AutocompletePopup.vue` component

  **What to do**:
  Create `packages/desktop/src/views/main/components/AutocompletePopup.vue`:

  The component receives:
  ```typescript
  props: {
    suggestions: AutocompleteSuggestion[]   // from useAutocomplete
    selectedIndex: number
    mode: 'mention' | 'emote' | null
  }
  emits: {
    select: [index: number]
  }
  ```

  UI requirements:
  - Floating panel positioned **above** the textarea (use `position: absolute; bottom: 100%`)
  - Max height ~240px, scrollable, min-width 200px
  - Each row: left icon/avatar, display name/alias
    - For mentions: colored indicator (use `color` from suggestion), displayName
    - For emotes: `<img :src="imageUrl">` 24×24, alias text. Animated emotes show normal `<img>` (GIF/WEBP autoplay).
  - Highlighted (selected) row: distinct background
  - `@mousedown.prevent` on each row (critical: prevents textarea blur)
  - `@mousedown.prevent` on the container as well for extra safety

  Styling:
  - Dark theme consistent with app (`--c-surface-2`, `--c-border`, `--c-text`, `--c-text-2`)
  - Selected row: `rgba(167, 139, 250, 0.15)` background (purple accent consistent with app)
  - Rounded corners `8px`, subtle drop shadow
  - Emote images: `object-fit: contain`

  **Must NOT do**:
  - Do NOT use inline SVG — only `.svg` file imports or `<img>`
  - Do NOT add animations/transitions (keep it simple)
  - Do NOT use Teleport — position relative to the parent `.chat-input-bar` container
  - Do NOT exceed 15 rows

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Vue SFC UI component with styling and accessibility considerations
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Vue 3 SFC patterns, scoped CSS, SVG-as-components rules

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 6 start delayed, but can be developed in parallel with Task 3)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 6
  - **Blocked By**: Task 4 (needs `AutocompleteSuggestion` type)

  **References**:
  - `packages/desktop/src/views/main/components/ChatInput.vue` — dark theme CSS variables in use (`--c-surface`, `--c-border`, `--c-text-2`)
  - `packages/desktop/src/views/main/components/StreamEditor.vue` — `@mousedown.prevent` dropdown pattern
  - `packages/desktop/src/views/main/components/ui/Tooltip.vue` — existing floating panel style reference
  - `packages/desktop/src/views/main/composables/useAutocomplete.ts` (Task 4 output) — `AutocompleteSuggestion` type

  **Acceptance Criteria**:
  - [ ] Component renders without errors when given mock suggestions
  - [ ] `@mousedown.prevent` present on list items (grep-verifiable)
  - [ ] `bun run typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Popup renders mention suggestions
    Tool: Playwright
    Steps:
      1. Navigate to app (http://localhost:5173 dev server or app window)
      2. Focus the chat input textarea
      3. Type "@te" (assuming a user "test" is in messages)
      4. Assert .autocomplete-popup is visible in DOM
      5. Assert popup contains text matching "test"
      6. Screenshot saved
    Expected Result: Popup visible with ≥1 mention suggestion
    Evidence: .sisyphus/evidence/task-5-mentions.png

  Scenario: Popup renders emote suggestions
    Tool: Playwright
    Steps:
      1. Focus chat textarea
      2. Type ":pe"
      3. Assert .autocomplete-popup is visible with img elements
      4. Screenshot saved
    Expected Result: Popup visible with emote images
    Evidence: .sisyphus/evidence/task-5-emotes.png

  Scenario: Popup not rendered when no trigger
    Tool: Playwright
    Steps:
      1. Focus chat textarea
      2. Type "hello world"
      3. Assert .autocomplete-popup is NOT in DOM
    Expected Result: No popup visible
    Evidence: .sisyphus/evidence/task-5-no-popup.png
  ```

  **Commit**: NO (commit with Task 6)

- [ ] 6. Integrate autocomplete into `ChatInput.vue` and pass `messages` prop from `ChatList.vue`

  **What to do**:

  **Part A — `ChatList.vue`**:
  - Pass messages to `<ChatInput>` — add `:messages` prop:
    - In watched channel mode: `:messages="watchedMessages ?? []"`
    - In home tab mode: `:messages="messages"`
    - Update the `<ChatInput>` element at line ~497 accordingly

  **Part B — `ChatInput.vue`**:

  1. Add `messages` prop:
     ```typescript
     messages?: NormalizedChatMessage[]
     ```

  2. Import and instantiate composable:
     ```typescript
     import { useAutocomplete } from '../composables/useAutocomplete'
     import AutocompletePopup from './AutocompletePopup.vue'

     const { suggestions, isOpen, selectedIndex, mode, selectSuggestion, moveUp, moveDown, close } =
       useAutocomplete({
         text,
         messages: computed(() => props.messages ?? []),
         watchedChannel: computed(() => props.watchedChannel),
         statuses: computed(() => props.statuses),
       })
     ```

  3. **Keyboard intercept** — in `onKeydown`, handle autocomplete keys BEFORE the send check:
     ```typescript
     function onKeydown(e: KeyboardEvent) {
       if (isOpen.value) {
         if (e.key === 'ArrowUp') { e.preventDefault(); moveUp(); return }
         if (e.key === 'ArrowDown') { e.preventDefault(); moveDown(); return }
         if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectSuggestion(selectedIndex.value); return }
         if (e.key === 'Escape') { e.preventDefault(); close(); return }
       }
       if (e.key === 'Enter' && !e.shiftKey) {
         e.preventDefault()
         send()
       }
     }
     ```

  4. **Template**: Add `<AutocompletePopup>` inside `.chat-input-bar`, **before** `.input-row`:
     ```html
     <AutocompletePopup
       v-if="isOpen"
       :suggestions="suggestions"
       :selected-index="selectedIndex"
       :mode="mode"
       @select="selectSuggestion"
     />
     ```
     Ensure `.chat-input-bar` has `position: relative` in scoped CSS (add if missing).

  **Must NOT do**:
  - Do NOT remove existing `send()` logic
  - Do NOT break reply flow
  - Do NOT add emote picker button
  - Do NOT use `@blur` to close popup (causes race condition)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Vue SFC integration with keyboard handling and component wiring
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Vue 3 SFC prop patterns, template integration

  **Parallelization**:
  - **Can Run In Parallel**: NO — must come after Task 3, 4, 5
  - **Parallel Group**: Wave 3 (last task in wave)
  - **Blocks**: FINAL wave
  - **Blocked By**: Task 3, Task 4, Task 5

  **References**:
  - `packages/desktop/src/views/main/components/ChatInput.vue` — full file (current state), especially `onKeydown` at line 141
  - `packages/desktop/src/views/main/components/ChatList.vue:497-505` — current ChatInput usage to update
  - `packages/desktop/src/views/main/composables/useAutocomplete.ts` (Task 4 output)
  - `packages/desktop/src/views/main/components/AutocompletePopup.vue` (Task 5 output)
  - `packages/desktop/src/views/main/components/StreamEditor.vue` — `@mousedown.prevent` pattern

  **Acceptance Criteria**:
  - [ ] `@` typed in ChatInput triggers mention suggestions
  - [ ] `:xy` typed triggers emote suggestions
  - [ ] Enter with popup open inserts suggestion (does NOT send message)
  - [ ] Enter with popup closed sends message normally
  - [ ] `bun run check` passes

  **QA Scenarios**:
  ```
  Scenario: @-mention autocomplete inserts username on Enter
    Tool: Playwright
    Steps:
      1. Open app, ensure at least one chat message exists
      2. Click textarea in ChatInput
      3. Type "@" + first 2 chars of a known username
      4. Assert: .autocomplete-popup appears with ≥1 suggestion
      5. Press ArrowDown to select first item
      6. Press Enter
      7. Assert: textarea contains "@username " (with trailing space)
      8. Assert: .autocomplete-popup is gone
      9. Assert: message was NOT sent
    Expected Result: Username inserted correctly, popup closed, no send
    Evidence: .sisyphus/evidence/task-6-mention-insert.png

  Scenario: Emote autocomplete inserts alias on Tab
    Tool: Playwright
    Steps:
      1. Focus textarea, type ":pe"
      2. Assert popup appears with emote images
      3. Press Tab to accept first suggestion
      4. Assert textarea contains alias without colon, followed by space
      5. Assert popup closed
    Expected Result: Emote alias inserted correctly
    Evidence: .sisyphus/evidence/task-6-emote-insert.png

  Scenario: Escape closes popup, text preserved
    Tool: Playwright
    Steps:
      1. Type "@te" to open popup
      2. Press Escape
      3. Assert popup is gone
      4. Assert textarea still focused and still contains "@te"
    Expected Result: Popup closed, text preserved
    Evidence: .sisyphus/evidence/task-6-escape.png

  Scenario: Enter without popup open sends message normally
    Tool: Playwright
    Steps:
      1. Type "hello world" (no @ or : trigger)
      2. Press Enter
      3. Assert: send event fired (observe network request or RPC call)
      4. Assert: textarea is empty after send
    Expected Result: Normal send behavior unaffected
    Evidence: .sisyphus/evidence/task-6-normal-send.png
  ```

  **Commit**: YES
  - Message: `feat(ui): add @mention and :emote autocomplete popup`
  - Files: `packages/desktop/src/views/main/composables/useAutocomplete.ts`, `packages/desktop/src/views/main/components/AutocompletePopup.vue`, `packages/desktop/src/views/main/components/ChatInput.vue`, `packages/desktop/src/views/main/components/ChatList.vue`, `packages/desktop/src/views/main/composables/useMessageParsing.ts`
  - Pre-commit: `bun run check`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun run check` in `packages/desktop`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start the app. Execute EVERY QA scenario from EVERY task. Test edge cases: empty input, very long emote list, switching channels while popup is open. Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify nothing missing, nothing beyond spec. Check "Must NOT do" compliance.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- Wave 1+2: `feat(rpc): add getChannelEmotes request and emote push messages` — rpc.ts, bun/index.ts
- Wave 3: `feat(ui): add @mention and :emote autocomplete popup` — useAutocomplete.ts, AutocompletePopup.vue, ChatInput.vue, ChatList.vue, useMessageParsing.ts
- After FINAL: squash or keep as-is per user preference

---

## Success Criteria

### Verification Commands
```bash
bun run check   # Expected: no errors
bun test tests/ # Expected: all tests pass
```

### Final Checklist
- [ ] `@` triggers mention autocomplete with username colors
- [ ] `:` triggers emote autocomplete with 7TV images
- [ ] Fuzzy search works (not just prefix)
- [ ] Keyboard navigation: Up/Down/Enter/Tab/Escape
- [ ] Enter with popup open = insert, not send
- [ ] No Bun imports in src/views/
- [ ] No emote picker button added
- [ ] `bun run check` passes
