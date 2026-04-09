# Emote Picker — Emote Menu Button with Search & Virtual Scroll

## TL;DR

> **Quick Summary**: Add an emote-menu button to the chat input area that opens a popover with fuzzy search and a `virtua` VGrid virtual scroll, allowing users to browse and insert channel emotes without performance degradation.
>
> **Deliverables**:
> - `src/views/main/composables/useEmoteCache.ts` — shared emote cache composable (extracted from `useAutocomplete`)
> - `src/views/main/components/EmotePicker.vue` — popover with search input + virtual scroll grid
> - `src/views/main/components/ChatInput.vue` — updated with emote button + two-branch insertion logic
> - `src/views/main/composables/useAutocomplete.ts` — updated to delegate to `useEmoteCache`
>
> **Estimated Effort**: Short (1–2 days)
> **Parallel Execution**: YES — Tasks 1 and 2 are the foundation; Task 3 and 4 run after.
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 (Final Verification)

---

## Context

### Original Request
Build an emote menu button with search. The design doesn't need to match the reference screenshot exactly — just needs: a button in the chat input row, a popover/panel with search, and virtual scroll to avoid lag with many emotes. Proactively fix virtual scroll pitfalls.

### Interview Summary

**Key Discussions**:
- Design: free, no need to match screenshot
- Search: fuzzy filter (same `fuzzyFilter` utility already in the codebase)
- Virtual scroll: mandatory, emote counts can reach 500–2000+
- Insertion: clicking an emote should insert its alias into the textarea
- Pitfalls: must be proactively addressed in implementation

**Research Findings**:
- `virtua@0.49.0` is already installed — has `VGrid` for Vue grids
- `reka-ui` has `PopoverRoot/Trigger/Content` — already used in `ChatAppearancePopover.vue`
- `useAutocomplete` has a private `emoteCache` that must be extracted to avoid dual-fetch
- `SevenTVEmote` has `.alias` not `.label` — must map before calling `fuzzyFilter<{label:string}>`
- `replaceToken` silently drops insertion when no `:token` is active — must use two-branch logic
- Popover button is at bottom of screen — must set `side="top"` with `avoidCollisions`
- Non-scoped CSS required for `PopoverContent` (reka-ui portals outside component DOM)
- `VGrid` requires **fixed height** container (not `max-height`) for scroll container detection
- `emote.id` must be used as VGrid item key — never array index
- Scroll must reset to index 0 on filter change to avoid out-of-bounds rendering

### Metis Review
**Identified Gaps** (addressed):
- Data ownership: dual-fetch risk → resolved by extracting `useEmoteCache` as shared composable
- Silent emote drop: `replaceToken` fallthrough → resolved by two-branch insertion logic
- `fuzzyFilter` type mismatch: `.alias` vs `.label` → resolved by mapping before filter
- `VGrid` height: `max-height` vs fixed → resolved: use `height: 400px` fixed
- Scroll reset: no `scrollToIndex(0)` on filter → resolved: explicit watch in EmotePicker
- Popover direction: opens downward → resolved: `side="top"` + `avoidCollisions`
- Nested tooltip conflict: `EmoteTooltip` inside popover → resolved: use plain `title` attribute only

---

## Work Objectives

### Core Objective
Extract emote cache into a shared composable, build an EmotePicker popover component with fuzzy search and virtua VGrid virtual scroll, and wire it into ChatInput with correct cursor-aware insertion logic.

### Concrete Deliverables
- `packages/desktop/src/views/main/composables/useEmoteCache.ts` (new)
- `packages/desktop/src/views/main/components/EmotePicker.vue` (new)
- `packages/desktop/src/views/main/composables/useAutocomplete.ts` (updated — delegates to useEmoteCache)
- `packages/desktop/src/views/main/components/ChatInput.vue` (updated — emote button + EmotePicker + insertion)

### Definition of Done
- [ ] `bun run typecheck` (via `vue-tsc --noEmit`) — zero errors
- [ ] `bun run lint` — zero errors
- [ ] `bun test tests/` — all tests pass
- [ ] Emote button visible in chat input row
- [ ] Picker opens above button, shows emotes with images
- [ ] Search filters emotes in real time
- [ ] Clicking emote inserts alias into textarea
- [ ] With 500+ emotes, DOM element count ≤ 60 emote cells

### Must Have
- Emote button in `.input-row` (between textarea and send button)
- Popover opens **upward** (`side="top"`)
- Search input focused on open
- `VGrid` virtual scroll with `emote.id` keys
- Scroll resets to 0 on filter change
- Two-branch emote insertion (`:token` branch + cursor-position branch)
- Shared `useEmoteCache` consumed by both `useAutocomplete` AND `EmotePicker`
- Loading state when emotes are being fetched
- Empty state when no emotes available
- Emote name shown via `title` attribute on hover

### Must NOT Have (Guardrails)
- **NO** emote categories, tabs, source filtering (7TV vs Twitch), or recents section in v1
- **NO** keyboard grid navigation (arrow keys through emote cells) — mouse-only + search + Escape
- **NO** `<EmoteTooltip>` inside the picker grid (z-index/portal stacking conflicts)
- **NO** `<Transition>` / `<TransitionGroup>` on virtual scroll items (causes flicker with recycled DOM)
- **NO** manual `IntersectionObserver` for image lazy-loading (browser handles `<img>` natively)
- **NO** modifications to `replaceToken`, `autocompleteUtils.ts`, or `fuzzyFilter.ts`
- **NO** modifications to `useAutocomplete`'s public API (suggestions, isOpen, selectedIndex, etc.)
- **NO** skeleton/shimmer loading UI — a simple spinner or empty div is fine
- **NO** emote picker keyboard navigation (arrow keys through the grid)
- **NO** draggable/resizable picker — fixed dimensions only
- **NO** inline `<svg>` in the emote button — use an existing pattern or a small inline SVG consistent with other buttons in ChatInput.vue (which already uses inline SVGs for the send/close buttons)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (`bun test tests/`)
- **Automated tests**: YES — Tests-after (unit tests for `useEmoteCache` insertion logic)
- **Framework**: `bun test`
- **If TDD**: N/A — tests-after for this work

### QA Policy
Every task includes agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Playwright — navigate, interact, screenshot
- **Library/Module**: `bun test` — import, call, assert

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation):
├── Task 1: Extract useEmoteCache composable + update useAutocomplete [quick]

Wave 2 (After Task 1):
├── Task 2: Build EmotePicker.vue (popover + search + VGrid) [visual-engineering]

Wave 3 (After Task 2):
├── Task 3: Wire EmotePicker into ChatInput.vue (button + insertion) [visual-engineering]

Wave FINAL (After Task 3 — parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high + playwright skill)
└── Task F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

### Dependency Matrix
- **Task 1**: no deps — starts immediately
- **Task 2**: depends on Task 1 (needs `useEmoteCache`)
- **Task 3**: depends on Task 2 (needs `EmotePicker.vue`)
- **F1–F4**: depend on Task 3

### Agent Dispatch Summary
- Wave 1: Task 1 → `quick`
- Wave 2: Task 2 → `visual-engineering`
- Wave 3: Task 3 → `visual-engineering`
- Wave FINAL: F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high` + playwright, F4 → `deep`

---

## TODOs

- [x] 1. Extract `useEmoteCache` composable + update `useAutocomplete`

  **What to do**:
  - Create new file `packages/desktop/src/views/main/composables/useEmoteCache.ts`
  - Extract the following from `useAutocomplete.ts` into `useEmoteCache.ts`:
    - `emoteCache = ref<Map<string, SevenTVEmote[]>>(new Map())`
    - `loadEmotes(platform, channelId)` function (calls `rpc.request.getChannelEmotes`)
    - All 4 RPC message listeners: `onEmotesSet`, `onEmoteAdded`, `onEmoteRemoved`, `onEmoteUpdated`
    - `onMounted` / `onUnmounted` registration of those 4 listeners
  - `useEmoteCache` should be a **singleton** using a module-level ref so all consumers share the same Map (or accept a `channelKey` param and manage internally):
    ```typescript
    // Recommended: module-level shared state (singleton pattern)
    const emoteCache = ref<Map<string, SevenTVEmote[]>>(new Map())
    let listenersRegistered = false
    
    export function useEmoteCache() {
      // register RPC listeners once, globally
      // expose: emoteCache (readonly), loadEmotes()
      // ...
    }
    ```
  - Update `useAutocomplete.ts`:
    - Remove the extracted code
    - Import and call `useEmoteCache()` to get `emoteCache` and `loadEmotes`
    - All existing public API of `useAutocomplete` remains **unchanged** (suggestions, isOpen, selectedIndex, mode, selectSuggestion, moveUp, moveDown, close)
    - Keep `getCurrentChannelKey()` inside `useAutocomplete` — it is autocomplete-specific
  - Write unit test `packages/desktop/tests/useEmoteCache.test.ts`:
    - Test: two calls to `useEmoteCache()` return the same reactive Map
    - Test: `loadEmotes` populates the cache under `"platform:channelId"` key
    - Test: calling `loadEmotes` twice for the same key does NOT call RPC twice (idempotent)

  **Must NOT do**:
  - Do NOT change the public API of `useAutocomplete` (the return object must remain identical)
  - Do NOT move `getCurrentChannelKey`, suggestion computation, or token logic out of `useAutocomplete`
  - Do NOT add any UI in this task — pure logic only
  - Do NOT add categories or grouping to the emote cache
  - Do NOT rename or restructure the `SevenTVEmote` type

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure TypeScript refactor, no UI work, clear extract/delegate pattern
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Module-level singleton composable pattern with `ref` outside the function

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 — starts immediately
  - **Blocks**: Task 2, Task 3
  - **Blocked By**: nothing

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/desktop/src/views/main/composables/useAutocomplete.ts:43` — `emoteCache` ref definition (the exact code to extract)
  - `packages/desktop/src/views/main/composables/useAutocomplete.ts:120-135` — `loadEmotes` function (extract verbatim)
  - `packages/desktop/src/views/main/composables/useAutocomplete.ts:160-218` — all 4 event handlers + `onMounted`/`onUnmounted` (extract verbatim)
  - `packages/desktop/src/views/main/composables/useAutocomplete.ts:206-218` — `rpc.addMessageListener` / `rpc.removeMessageListener` pattern (follow exactly)

  **API/Type References**:
  - `packages/shared/protocol.ts:17-25` — `SevenTVEmote` interface (id, alias, name, animated, zeroWidth, aspectRatio, imageUrl)
  - `packages/desktop/src/shared/rpc.ts:106-109` — `getChannelEmotes` RPC request definition
  - `packages/desktop/src/shared/rpc.ts:202-213` — `channel_emotes_set/added/removed/updated` message types

  **Acceptance Criteria**:
  - [ ] `bun test packages/desktop/tests/useEmoteCache.test.ts` → PASS
  - [ ] `vue-tsc --noEmit` from `packages/desktop/` → no new errors
  - [ ] `bun run lint` from root → no new errors
  - [ ] `useAutocomplete`'s public API is unchanged (same return shape)

  **QA Scenarios**:

  ```
  Scenario: Shared cache between two consumers
    Tool: Bash (bun test)
    Steps:
      1. Run: cd packages/desktop && bun test tests/useEmoteCache.test.ts
      2. Assert test "two consumers share the same cache Map" passes
      3. Assert test "loadEmotes is idempotent (no double RPC)" passes
    Expected Result: All tests pass, 0 failures
    Evidence: .sisyphus/evidence/task-1-unit-tests.txt (capture test output)

  Scenario: useAutocomplete still works after refactor
    Tool: Bash (vue-tsc)
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit
      2. Assert: zero TypeScript errors in useAutocomplete.ts
    Expected Result: Clean type check
    Evidence: .sisyphus/evidence/task-1-typecheck.txt
  ```

  **Commit**: YES — `feat(desktop): extract useEmoteCache composable from useAutocomplete`
  - Files: `src/views/main/composables/useEmoteCache.ts`, `src/views/main/composables/useAutocomplete.ts`, `tests/useEmoteCache.test.ts`
  - Pre-commit: `bun test tests/`

---

- [x] 2. Build `EmotePicker.vue` — popover + search + VGrid virtual scroll

  **What to do**:
  - Create `packages/desktop/src/views/main/components/EmotePicker.vue`
  - Component props:
    ```typescript
    interface Props {
      platform: string
      channelId: string
    }
    interface Emits {
      select: [alias: string]
    }
    ```
  - Internal logic:
    - Call `useEmoteCache()` to get `emoteCache` and `loadEmotes`
    - On `onMounted`: call `loadEmotes(props.platform, props.channelId)`
    - `allEmotes` computed: `emoteCache.get(`${platform}:${channelId}`) ?? []`
    - `searchQuery = ref('')`
    - `filteredEmotes` computed: map emotes to `{ ...emote, label: emote.alias }` then run `fuzzyFilter(mapped, searchQuery.value)` — **the `.label` mapping is mandatory before fuzzyFilter**
    - `isLoading` computed: `allEmotes.length === 0 && !emoteCache.has(key)`
    - Virtual scroll: use `virtua`'s `VGrid` component
      ```vue
      <VGrid
        ref="gridRef"
        :data="filteredEmotes"
        :item-width="52"
        :item-height="52"
        class="emote-grid"
      >
        <template #default="{ item }">
          <div
            class="emote-cell"
            :key="item.id"
            :title="item.alias"
            @click="emit('select', item.alias)"
          >
            <img
              :src="item.imageUrl"
              :alt="item.alias"
              width="40"
              height="40"
              loading="lazy"
              class="emote-img"
            />
          </div>
        </template>
      </VGrid>
      ```
    - Scroll reset on filter change: `watch(filteredEmotes, () => { gridRef.value?.scrollToIndex(0) })`
    - Search input ref (`searchInputRef`) exposed via `defineExpose({ focus: () => searchInputRef.value?.focus() })`
  - Popover structure: use reka-ui `PopoverRoot` / `PopoverTrigger` / `PopoverContent`
    - **No** — EmotePicker is the **content** of the popover. The trigger/root lives in ChatInput.vue. EmotePicker receives the emote list and emits `select`. It is a pure display component.
    - Therefore EmotePicker has NO popover primitives itself — just the search input + VGrid + styling.
  - Layout (EmotePicker.vue):
    ```
    <div class="emote-picker">
      <div class="emote-picker-search">
        <input ref="searchInputRef" v-model="searchQuery" placeholder="Search emotes…" />
      </div>
      <div v-if="isLoading" class="emote-picker-loading">Loading…</div>
      <div v-else-if="filteredEmotes.length === 0" class="emote-picker-empty">No emotes found</div>
      <div v-else class="emote-picker-grid-container">
        <VGrid …>…</VGrid>
      </div>
    </div>
    ```
  - Container dimensions: `.emote-picker-grid-container` must have **fixed `height: 360px`** (NOT `max-height`) so VGrid can measure the scroll container. Width: `320px` set on `.emote-picker`.
  - Styling: dark theme matching existing components (`--c-surface-2`, `--c-border`, `--c-text` CSS vars)
  - **IMPORTANT**: `<style>` block in EmotePicker.vue must be **scoped** — it's a standalone component. The popover content CSS (which is portalled) lives in ChatInput.vue's non-scoped style.

  **Must NOT do**:
  - Do NOT use `max-height` on the VGrid container — use fixed `height: 360px`
  - Do NOT use `<EmoteTooltip>` — use plain `title` attribute only
  - Do NOT add `<Transition>` / `<TransitionGroup>` on virtual scroll items
  - Do NOT use array index as VGrid key — use `emote.id`
  - Do NOT add category tabs, favorites section, or emote source filter
  - Do NOT include keyboard arrow-key grid navigation
  - Do NOT include `PopoverRoot/Trigger/Content` in this component (that's ChatInput's job)
  - Do NOT call `rpc.request.getChannelEmotes` directly — use `useEmoteCache`

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Vue SFC with CSS styling, virtua VGrid integration, responsive layout
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: VGrid usage, scoped styles, composable patterns, defineExpose

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 — after Task 1
  - **Blocks**: Task 3
  - **Blocked By**: Task 1 (`useEmoteCache` must exist)

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/desktop/src/views/main/components/ui/ChatAppearancePopover.vue` — popover CSS pattern, non-scoped styles for portalled content, overall structure to follow
  - `packages/desktop/src/views/main/components/AutocompletePopup.vue:33-36` — how emote image + label are rendered (`.emote-image` CSS class)
  - `packages/desktop/src/views/main/composables/useAutocomplete.ts:85-98` — how `SevenTVEmote` → `EmoteSuggestion` mapping works (reference for the label mapping approach)
  - `packages/desktop/src/views/main/utils/fuzzyFilter.ts` — fuzzyFilter signature: `fuzzyFilter<T extends { label: string }>(items, query)` — note the `.label` requirement

  **API/Type References**:
  - `packages/shared/protocol.ts:17-25` — `SevenTVEmote` shape (use `.alias` as label, `.imageUrl` for src, `.id` as key, `.name` for title attribute)
  - `packages/desktop/src/views/main/composables/useEmoteCache.ts` (the new file from Task 1) — import `useEmoteCache`

  **External References**:
  - `virtua` VGrid Vue API: the component is `<VGrid>` from `virtua/vue`. Props: `data` (array), `item-width` (px), `item-height` (px). Slot: `#default="{ item }"`. Ref methods: `scrollToIndex(0)`. Check `node_modules/virtua` for exact import path.

  **Acceptance Criteria**:
  - [ ] Component renders without TypeScript errors
  - [ ] `vue-tsc --noEmit` → zero errors in EmotePicker.vue
  - [ ] `bun run lint` → zero errors in EmotePicker.vue

  **QA Scenarios**:

  ```
  Scenario: EmotePicker mounts and renders emotes
    Tool: Playwright (load playwright skill)
    Preconditions: App running via bun run dev:hmr, connected channel with emotes loaded
    Steps:
      1. Navigate to main window (http://localhost:5173)
      2. Component is mounted as part of ChatInput (after Task 3) — for Task 2 isolation,
         do a quick smoke check: import and render EmotePicker in isolation if possible,
         OR defer full visual QA to Task 3 Playwright test
    Expected Result: No console errors on import
    Evidence: .sisyphus/evidence/task-2-lint.txt (bun run lint output)

  Scenario: VGrid renders ≤ 60 emote cells with 500 emotes
    Tool: Bash (unit test or bun eval)
    Steps:
      1. Write a test that mounts EmotePicker with a mocked emoteCache of 500 emotes
      2. Assert document.querySelectorAll('.emote-cell').length <= 60
    Expected Result: DOM has at most 60 .emote-cell elements
    Evidence: .sisyphus/evidence/task-2-vgrid-count.txt

  Scenario: Search filters correctly
    Tool: Bash (bun test)
    Steps:
      1. Run: bun test tests/ -t "EmotePicker search"
      2. Assert: with emotes ['Kappa', 'Keepo', 'PogChamp'] and query 'kap', only 'Kappa' is in filteredEmotes
    Expected Result: filteredEmotes.length === 1, filteredEmotes[0].alias === 'Kappa'
    Evidence: .sisyphus/evidence/task-2-search-test.txt

  Scenario: Scroll resets to 0 on filter change
    Tool: Bash (unit test)
    Steps:
      1. Test that `gridRef.scrollToIndex(0)` is called when filteredEmotes changes
    Expected Result: scrollToIndex(0) called
    Evidence: .sisyphus/evidence/task-2-scroll-reset.txt
  ```

  **Commit**: YES — `feat(desktop): add EmotePicker component with search and virtual grid`
  - Files: `src/views/main/components/EmotePicker.vue`
  - Pre-commit: `bun run lint && vue-tsc --noEmit`

---

- [x] 3. Wire `EmotePicker` into `ChatInput.vue` + two-branch insertion logic

  **What to do**:

  **Step A — Add emote button to `.input-row`**:
  - Import `EmotePicker.vue` and `PopoverRoot/Trigger/Content` from `reka-ui`
  - Add `showEmotePicker = ref(false)` and `emotePickerRef = ref<InstanceType<typeof EmotePicker> | null>(null)`
  - In the template, inside `.input-row`, add before the send button:
    ```vue
    <PopoverRoot v-model:open="showEmotePicker">
      <PopoverTrigger as-child>
        <button class="emote-btn" title="Emotes" :disabled="isDisabled" @click="onEmoteButtonClick">
          <!-- smiley face SVG icon (inline, matching existing send button style) -->
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" :side-offset="8" align="end" :avoid-collisions="true" class="emote-picker-popover">
        <EmotePicker
          ref="emotePickerRef"
          :platform="currentPlatform"
          :channel-id="currentChannelId"
          @select="onEmoteSelect"
        />
      </PopoverContent>
    </PopoverRoot>
    ```
  - Add non-scoped CSS for `.emote-picker-popover` (reka-ui portals it):
    ```css
    /* non-scoped in ChatInput.vue */
    .emote-picker-popover {
      background: var(--c-surface-2, #1f1f24);
      border: 1px solid var(--c-border, #2a2a33);
      border-radius: 12px;
      padding: 0;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      z-index: 200;
      overflow: hidden;
    }
    ```

  **Step B — Compute current platform + channelId for EmotePicker**:
  - Add computed `currentChannelInfo`:
    ```typescript
    const currentChannelInfo = computed((): { platform: string; channelId: string } | null => {
      if (props.watchedChannel) {
        return { platform: props.watchedChannel.platform, channelId: props.watchedChannel.channelSlug }
      }
      for (const [, info] of props.statuses) {
        if (info.channelLogin && info.status === 'connected') {
          return { platform: info.platform, channelId: info.channelLogin }
        }
      }
      return null
    })
    ```
  - Use `currentChannelInfo.value?.platform ?? ''` and `currentChannelInfo.value?.channelId ?? ''` as props to EmotePicker. If null, disable the emote button.

  **Step C — onEmoteButtonClick handler**:
  - When picker opens, focus the search input after next tick:
    ```typescript
    async function onEmoteButtonClick(): Promise<void> {
      showEmotePicker.value = !showEmotePicker.value
      if (showEmotePicker.value) {
        await nextTick()
        emotePickerRef.value?.focus()
      }
    }
    ```

  **Step D — Two-branch insertion logic** (the most critical part):
  ```typescript
  function onEmoteSelect(alias: string): void {
    // Branch 1: active :token at end of text → use replaceToken
    const token = parseToken(text.value)
    if (token.mode === 'emote') {
      text.value = replaceToken(text.value, {
        type: 'emote',
        label: alias,
        imageUrl: '',
        animated: false,
      })
    } else {
      // Branch 2: no active :token → insert at cursor position (or append)
      const el = textareaEl.value
      const pos = el?.selectionStart ?? text.value.length
      const insertion = alias + ' '
      text.value = text.value.slice(0, pos) + insertion + text.value.slice(pos)
      // Restore cursor after insertion
      nextTick(() => {
        if (el) {
          const newPos = pos + insertion.length
          el.focus()
          el.setSelectionRange(newPos, newPos)
        }
      })
    }
    // Close picker after selection
    showEmotePicker.value = false
    // Refocus textarea
    nextTick(() => textareaEl.value?.focus())
  }
  ```
  - Import `parseToken` and `replaceToken` from `../utils/autocompleteUtils` (already imported via `useAutocomplete`)
  - **The `parseToken` and `replaceToken` are already exported from `useAutocomplete.ts`** (line 24: `export { parseToken, replaceToken }`) — import from there OR directly from `../utils/autocompleteUtils`

  **Step E — Emote button styling**:
  - Add `.emote-btn` CSS (scoped) matching `.send-btn` style but smaller/ghost:
    ```css
    .emote-btn {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: var(--c-text-2, #8b8b99);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .emote-btn:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.08);
      color: var(--c-text, #e2e2e8);
    }
    .emote-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .emote-btn.is-open {
      background: rgba(167, 139, 250, 0.15);
      color: #a78bfa;
    }
    ```
  - Add `:class="{ 'is-open': showEmotePicker }"` to the emote button

  **Step F — Write unit tests** `packages/desktop/tests/emote-insertion.test.ts`:
  ```typescript
  // Test the insertion logic directly (extract to a pure function for testability)
  function insertEmoteIntoText(text: string, alias: string, cursorPos: number): string { … }

  test('empty text → prepend alias', () => {
    expect(insertEmoteIntoText('', 'Kappa', 0)).toBe('Kappa ')
  })
  test('no token, cursor at end → append', () => {
    expect(insertEmoteIntoText('hello', 'Kappa', 5)).toBe('hello Kappa ')
  })
  test('no token, cursor mid-text → insert at cursor', () => {
    expect(insertEmoteIntoText('hello world', 'Kappa', 5)).toBe('hello Kappa world')
  })
  test(':token active → replaceToken branch', () => {
    // parseToken(':kap') returns { mode: 'emote', query: 'kap' }
    // replaceToken(':kap', { type:'emote', label:'Kappa', ... }) = 'Kappa '
    expect(insertEmoteIntoText(':kap', 'Kappa', 4)).toBe('Kappa ')
  })
  ```
  Note: the insertion logic should be extracted to a **pure function** `insertEmoteIntoText(text, alias, cursorPos)` in `autocompleteUtils.ts` for easy testing (this is the ONLY change to that file — adding a pure function, not modifying existing ones).
  Wait — **Must NOT modify `autocompleteUtils.ts`** per guardrails. Instead, place `insertEmoteIntoText` as a local helper inside `ChatInput.vue`'s `<script setup>` and test via a thin wrapper export. OR accept testing only via Playwright for the insertion behavior.
  **Decision**: Test insertion via Playwright (end-to-end). No changes to `autocompleteUtils.ts`.

  **Must NOT do**:
  - Do NOT modify `autocompleteUtils.ts` or `fuzzyFilter.ts`
  - Do NOT use `replaceToken` alone without the two-branch check — silent emote drop must be prevented
  - Do NOT use `max-height` on `.emote-picker-popover` — EmotePicker itself handles its height
  - Do NOT add a `<style scoped>` block for `.emote-picker-popover` — it must be non-scoped (portalled)
  - Do NOT add keyboard arrow-key navigation for the emote grid

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Vue component wiring, CSS styling, event handler logic, reka-ui popover integration
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: reka-ui popover pattern, nextTick focus, scoped vs non-scoped styles

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 — after Task 2
  - **Blocks**: Final Verification
  - **Blocked By**: Task 2 (`EmotePicker.vue` must exist)

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/desktop/src/views/main/components/ui/ChatAppearancePopover.vue` — reka-ui `PopoverRoot/Trigger/Content` pattern, non-scoped popover CSS, popover structure (FOLLOW THIS EXACTLY)
  - `packages/desktop/src/views/main/components/ChatInput.vue:327-352` — existing `.input-row` with textarea and send button (insert emote button between them)
  - `packages/desktop/src/views/main/components/ChatInput.vue:512-534` — `.send-btn` CSS (model `.emote-btn` on this)
  - `packages/desktop/src/views/main/composables/useAutocomplete.ts:24` — `export { parseToken, replaceToken }` (import from here)

  **API/Type References**:
  - `packages/desktop/src/views/main/utils/autocompleteUtils.ts:36-51` — `replaceToken` implementation (understand what it does and doesn't do)
  - `packages/desktop/src/views/main/utils/autocompleteUtils.ts:21-33` — `parseToken` implementation (used for the Branch 1 check)
  - `packages/desktop/src/views/main/components/EmotePicker.vue` (from Task 2) — component props/emits/expose

  **Acceptance Criteria**:
  - [ ] `vue-tsc --noEmit` → zero errors in ChatInput.vue
  - [ ] `bun run lint` → zero errors
  - [ ] Emote button visible in UI (Playwright screenshot)
  - [ ] Popover opens above the button (`side="top"`)
  - [ ] Typing in search box filters emotes
  - [ ] Clicking emote inserts alias + space into textarea
  - [ ] Escape closes popover
  - [ ] Insertion works with empty textarea (appends)
  - [ ] Insertion works with active `:token` (replaces)
  - [ ] Insertion works with cursor mid-text (inserts at cursor)

  **QA Scenarios**:

  ```
  Scenario: Emote button visible in .input-row
    Tool: Playwright (load playwright skill)
    Preconditions: App running via bun run dev:hmr in packages/desktop/
    Steps:
      1. Navigate to http://localhost:5173
      2. Query selector: assert document.querySelector('.emote-btn') !== null
      3. Assert button is visible and not disabled (assuming a connected channel)
      4. Take screenshot: .sisyphus/evidence/task-3-emote-button.png
    Expected Result: .emote-btn present in DOM, visible
    Failure Indicators: querySelector returns null, screenshot shows no emote button
    Evidence: .sisyphus/evidence/task-3-emote-button.png

  Scenario: Popover opens above button on click
    Tool: Playwright
    Preconditions: Same as above, channel with emotes connected
    Steps:
      1. Click .emote-btn
      2. Wait for .emote-picker to appear in DOM (timeout: 3s)
      3. Assert .emote-picker is visible
      4. Get bounding rect of .emote-btn and .emote-picker
      5. Assert emote-picker.bottom <= emote-btn.top + 20 (opens above)
      6. Take screenshot: .sisyphus/evidence/task-3-picker-open.png
    Expected Result: Picker visible, positioned above the button
    Failure Indicators: Picker opens below button, or doesn't appear
    Evidence: .sisyphus/evidence/task-3-picker-open.png

  Scenario: Search input focused on picker open
    Tool: Playwright
    Steps:
      1. Click .emote-btn to open picker
      2. Assert document.activeElement matches the search input inside .emote-picker
    Expected Result: Search input has focus immediately after picker opens
    Evidence: .sisyphus/evidence/task-3-search-focus.txt (log activeElement)

  Scenario: Search filters emotes
    Tool: Playwright
    Preconditions: Picker open, emotes loaded
    Steps:
      1. Count initial visible emote cells: initial = querySelectorAll('.emote-cell').length
      2. Type 'kap' into the search input
      3. Wait 300ms for filter to apply
      4. Count cells again: filtered = querySelectorAll('.emote-cell').length
      5. Assert filtered < initial (or filtered === 0 if no matching emote)
      6. Assert each visible cell's title attribute contains 'kap' (case-insensitive) OR filtered === 0
    Expected Result: Cell count decreased or is 0
    Evidence: .sisyphus/evidence/task-3-search-filter.png

  Scenario: VGrid renders ≤ 60 cells with 500+ emotes
    Tool: Playwright
    Preconditions: Picker open, channel has 500+ emotes loaded
    Steps:
      1. Open picker
      2. Clear search input (empty query = show all)
      3. Evaluate: document.querySelectorAll('.emote-cell').length
      4. Assert result <= 60
    Expected Result: DOM has ≤ 60 .emote-cell elements (VGrid virtualization working)
    Failure Indicators: 200+ emote cells in DOM
    Evidence: .sisyphus/evidence/task-3-vgrid-count.txt

  Scenario: Emote click inserts alias (no active :token, empty textarea)
    Tool: Playwright
    Steps:
      1. Clear textarea (ensure it's empty)
      2. Open picker
      3. Click first visible .emote-cell
      4. Assert picker is closed (showEmotePicker = false)
      5. Assert textarea value = "{clickedEmoteAlias} " (alias + space)
    Expected Result: Textarea contains alias + trailing space
    Failure Indicators: Textarea still empty, picker still open
    Evidence: .sisyphus/evidence/task-3-insert-empty.png

  Scenario: Emote click inserts at cursor (mid-text, no :token)
    Tool: Playwright
    Steps:
      1. Type "hello world" into textarea
      2. Set cursor to position 5 (after "hello") via setSelectionRange(5, 5)
      3. Open picker
      4. Click first visible .emote-cell (note its alias, e.g. "Kappa")
      5. Assert textarea value = "hello Kappa world"
    Expected Result: Emote inserted at cursor position, not appended
    Failure Indicators: "hello worldKappa " or "Kappa hello world"
    Evidence: .sisyphus/evidence/task-3-insert-cursor.png

  Scenario: Emote click replaces active :token
    Tool: Playwright
    Steps:
      1. Type ":kap" into textarea
      2. Open picker
      3. Find and click the "Kappa" emote (search for it if needed)
      4. Assert textarea value = "Kappa " (NOT ":kapKappa ")
    Expected Result: :kap replaced by Kappa (space at end)
    Evidence: .sisyphus/evidence/task-3-insert-token.png

  Scenario: Escape closes picker
    Tool: Playwright
    Steps:
      1. Open picker (click .emote-btn)
      2. Press Escape key
      3. Assert .emote-picker is not in DOM (or not visible)
    Expected Result: Picker closed
    Evidence: .sisyphus/evidence/task-3-escape-close.png
  ```

  **Commit**: YES — `feat(desktop): wire EmotePicker into ChatInput with cursor-aware insertion`
  - Files: `src/views/main/components/ChatInput.vue`
  - Pre-commit: `bun run check` (typecheck + lint + format)

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, check component structure). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `vue-tsc --noEmit` from `packages/desktop/` + `bun run lint` + `bun test tests/`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (load `playwright` skill)
  Start `bun run dev:hmr` from `packages/desktop/`. Use Playwright to:
  1. Open main window, verify emote button visible in `.input-row`
  2. Click emote button, verify popover opens above button
  3. Type in search box, verify emotes filter
  4. Click an emote, verify alias inserted into textarea
  5. Press Escape, verify popover closes
  6. Save screenshot evidence to `.sisyphus/evidence/final-qa/`
  Output: `Scenarios [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (`git diff --name-only HEAD~3..HEAD`). Verify nothing beyond scope was built (no emote categories, no keyboard nav, no tooltip nesting). Flag any unaccounted changes.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Task 1**: `feat(desktop): extract useEmoteCache composable from useAutocomplete`
  Files: `src/views/main/composables/useEmoteCache.ts`, `src/views/main/composables/useAutocomplete.ts`
  Pre-commit: `bun test tests/`

- **Task 2**: `feat(desktop): add EmotePicker component with search and virtual grid`
  Files: `src/views/main/components/EmotePicker.vue`
  Pre-commit: `bun run lint && vue-tsc --noEmit`

- **Task 3**: `feat(desktop): wire EmotePicker into ChatInput with cursor-aware insertion`
  Files: `src/views/main/components/ChatInput.vue`
  Pre-commit: `bun run check`

---

## Success Criteria

### Verification Commands
```bash
# From packages/desktop/
vue-tsc --noEmit   # Expected: no errors
bun run lint       # Expected: no errors
bun test tests/    # Expected: all pass

# DOM count with 500 emotes (Playwright)
document.querySelectorAll('.emote-cell').length  # Expected: ≤ 60
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Emote picker visually functional
