# Hotkeys System

## TL;DR

> **Quick Summary**: Implement a full keyboard-shortcut system for TwirChat's watched-channel tab navigation, with user-configurable bindings stored in AppSettings.
>
> **Deliverables**:
>
> - `packages/shared/types.ts` — `HotkeySettings` type + `hotkeys` field in `AppSettings` + defaults
> - `packages/desktop/src/views/main/composables/useHotkeys.ts` — module-singleton global keydown composable with pause/resume API
> - `packages/desktop/src/views/main/utils/fuzzyFilter.ts` — pure fuzzy filter utility (extracted for testability)
> - `packages/desktop/src/views/main/components/TabSelectorModal.vue` — Ctrl+L/K command-palette-style tab picker
> - `packages/desktop/src/views/main/App.vue` — wired hotkeys + new modal
> - `packages/desktop/src/views/main/components/SettingsPanel.vue` — new "Keyboard Shortcuts" section with click-to-rebind
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 + Task 4 + Task 5 → Task 6 + Task 7 → Task 8 → F1–F4

---

## Context

### Original Request

Implement GitHub issues #19, #20, #21, #22, #24 (Hotkeys system and all sub-issues):

- #21: Ctrl+T opens new tab modal
- #20: Ctrl+Tab / Ctrl+Shift+Tab cycles through watched-channel tabs
- #19: Ctrl+L / Ctrl+K opens fuzzy tab-selector modal
- #22: All hotkeys customizable in Settings panel

### Interview Summary

**Key Discussions**:

- No existing global hotkey infrastructure — pure greenfield in webview
- Tab system has two layers: main section tabs (chat/events/platforms/settings) and watched-channel tabs (home + WatchedChannel.id values)
- `activeWatchedTab` ref lives in `App.vue` — that's the correct owner for hotkey dispatch
- Settings stored as JSON in SQLite via SettingsStore, deep-merged on load — safely extensible
- `tabChannelIds` is a `Set<string>` with V8 insertion-order guarantees — safe for cycling

**Research Findings**:

- Existing local panel shortcuts (Ctrl+H/W in PanelNode.vue) are NOT global — component-scoped `@keydown` handlers
- `composables/` directory exists and is empty — ready for new composable
- `AddChannelModal.vue` establishes the Teleport+backdrop modal pattern to follow

### Metis Review

**Identified Gaps** (addressed):

- Ctrl+Tab may not be interceptable in Electrobun BrowserWindow → **Task 1 must verify this first**
- Input-guard missing — global listener must skip actions when focus is in input/textarea → **added as MUST in Task 3**
- SettingsPanel recording mode must pause() global hotkeys → **pause/resume API added to useHotkeys**
- `SettingsPanel.vue` local ref shallow-copies `settings` — hotkeys object needs explicit deep-copy → **added to Task 7**
- `HotkeySettings` keys must be required (not optional) with defaults in `DEFAULT_SETTINGS` → **added to Task 2**
- `Ctrl+K` hardcoded alias lives in `useHotkeys.ts`, not in settings → **clarified in Task 3 + Task 6**
- `data-testid` attributes needed on modals for Playwright AC → **added to Task 5**

---

## Work Objectives

### Core Objective

Add a keyboard shortcut system so users can navigate watched-channel tabs via keyboard and customize all bindings in settings.

### Concrete Deliverables

- `packages/shared/types.ts` — `HotkeySettings` interface, `hotkeys` in `AppSettings`, `DEFAULT_SETTINGS.hotkeys`
- `packages/desktop/src/views/main/composables/useHotkeys.ts` — global keydown composable
- `packages/desktop/src/views/main/utils/fuzzyFilter.ts` — extracted pure filter function
- `packages/desktop/src/views/main/components/TabSelectorModal.vue` — tab-selector modal
- Updated `App.vue` — wires all hotkeys, shows `TabSelectorModal`
- Updated `SettingsPanel.vue` — Keyboard Shortcuts section with click-to-rebind

### Definition of Done

- [ ] `bun run typecheck` passes in packages/desktop
- [ ] `bun run check` (lint + format) passes
- [ ] Ctrl+T opens AddChannelModal (verified: modal visible in DOM)
- [ ] Ctrl+Tab / Ctrl+Shift+Tab cycles `activeWatchedTab` (verified: DOM tab highlighted)
- [ ] Ctrl+L / Ctrl+K opens TabSelectorModal (verified: modal visible, search input focused)
- [ ] Rebinding persists after `rpc.request.getSettings()` call
- [ ] All shortcuts no-op when focus is in a text input

### Must Have

- Input-guard: no hotkeys fire when `document.activeElement` is input/textarea/select/contentEditable
- `useHotkeys.ts` is the ONLY place with `window.addEventListener('keydown')`
- `pause()` / `resume()` API on useHotkeys, called during settings recording mode
- `HotkeySettings` all keys required (not optional), `DEFAULT_SETTINGS.hotkeys` provides all defaults
- `Ctrl+K` hardcoded alias in `useHotkeys.ts` registration (not in settings schema)
- `data-testid="add-channel-modal"` on AddChannelModal, `data-testid="tab-selector-modal"` on TabSelectorModal
- `hotkeys: { ...props.settings.hotkeys }` deep-copy in SettingsPanel `local` ref init

### Must NOT Have (Guardrails)

- NO `window.addEventListener('keydown')` outside `useHotkeys.ts`
- NO new RPC calls for hotkeys (uses existing `getSettings`/`saveSettings`)
- NO hotkeys for panel split/close (PanelNode.vue local shortcuts stay local)
- NO command palette actions in TabSelectorModal — tabs only, no main-section navigation
- NO restructuring existing SettingsPanel sections — only append new section
- NO per-binding enable/disable toggles (out of scope)
- NO OS-level global shortcuts (webview only)
- NO migration of PanelNode Ctrl+H/W/Shift+H shortcuts to the global system

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES (bun test, tests/ directory exists)
- **Automated tests**: YES (Tests for pure logic; QA scenarios via Playwright for UI)
- **Framework**: bun test
- **TDD scope**: `useHotkeys.ts` composable logic + `fuzzyFilter.ts` pure function

### QA Policy

Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Playwright — navigate, interact, assert DOM, screenshot
- **Pure logic**: Bash (bun test) — import, call functions, compare output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — independent):
├── Task 1: Verify key intercept feasibility in Electrobun [quick]
└── Task 2: Add HotkeySettings type to shared/types.ts [quick]

Wave 2 (After Wave 1 — parallel, no cross-deps):
├── Task 3: Create useHotkeys.ts composable (TDD) [deep]
├── Task 4: Create fuzzyFilter.ts utility (TDD) [quick]
└── Task 5: Create TabSelectorModal.vue component [visual-engineering]

Wave 3 (After Wave 2 — integration):
├── Task 6: Wire hotkeys + TabSelectorModal into App.vue [unspecified-high]
└── Task 7: Add Keyboard Shortcuts section to SettingsPanel.vue [visual-engineering]

Wave 4 (After Wave 3 — cleanup):
└── Task 8: Run bun run fix, verify typecheck + lint [quick]

Wave FINAL (After ALL — parallel review):
├── F1: Plan compliance audit [oracle]
├── F2: Code quality review [unspecified-high]
├── F3: Real manual QA [unspecified-high]
└── F4: Scope fidelity check [deep]
→ Present results → Get explicit user okay

Critical Path: Task 1 → Task 2 → Task 3 → Task 6 → Task 8 → F1-F4
```

### Dependency Matrix

- **1**: none → unblocks 2, 3
- **2**: 1 → unblocks 3, 4, 5, 6, 7
- **3**: 2 → unblocks 6
- **4**: 2 → unblocks 5
- **5**: 2, 4 → unblocks 6
- **6**: 3, 5 → unblocks 8
- **7**: 2, 3 → unblocks 8
- **8**: 6, 7 → unblocks FINAL
- **FINAL**: 8

### Agent Dispatch Summary

- **Wave 1**: T1 → `quick`, T2 → `quick` (2 parallel)
- **Wave 2**: T3 → `deep`, T4 → `quick`, T5 → `visual-engineering` (3 parallel)
- **Wave 3**: T6 → `unspecified-high`, T7 → `visual-engineering` (2 parallel)
- **Wave 4**: T8 → `quick`
- **FINAL**: F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep` (4 parallel)

---

## TODOs

---

- [ ] 1. Verify Ctrl+Tab and Ctrl+L are interceptable in Electrobun BrowserWindow

  **What to do**:
  - Start the desktop app in dev mode: `cd packages/desktop && bun run start` (or `bun run dev:hmr`)
  - Open the browser dev console (Electrobun should expose it in dev mode)
  - Run the following test snippet in the console:
    ```js
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey && e.key === 'Tab') || (e.ctrlKey && (e.key === 'l' || e.key === 'L'))) {
        e.preventDefault()
        console.log('INTERCEPTED:', e.key)
      }
    })
    ```
  - Press Ctrl+Tab → verify "INTERCEPTED: Tab" appears in console
  - Press Ctrl+L → verify "INTERCEPTED: l" appears in console
  - **If Ctrl+Tab is NOT interceptable**: update `DEFAULT_SETTINGS.hotkeys.nextTab` to `'alt+arrowright'` and `prevTab` to `'alt+arrowleft'` in Task 2
  - **If Ctrl+L is NOT interceptable**: update `DEFAULT_SETTINGS.hotkeys.tabSelector` to `'ctrl+k'` only in Task 2
  - Document the result in a comment at the top of `useHotkeys.ts` when writing Task 3

  **Must NOT do**:
  - Do not write any feature code in this task
  - Do not modify any files

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single empirical test with no code changes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with nothing, this is Wave 1 solo-start)
  - **Parallel Group**: Wave 1 (can run alongside Task 2)
  - **Blocks**: Tasks 3, 6 (default binding values depend on this result)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/PanelNode.vue` — existing local keydown example (Ctrl+H, Ctrl+W)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Ctrl+Tab is interceptable in Electrobun webview
    Tool: Bash (manual dev console test or Playwright if app is running)
    Preconditions: App is running in dev mode
    Steps:
      1. Inject keydown listener via console or Playwright evaluate:
         window._interceptTest = (e) => { if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); window._ctrlTabFired = true } }
         window.addEventListener('keydown', window._interceptTest)
      2. Simulate Ctrl+Tab: await page.keyboard.press('Control+Tab')
      3. Read result: const fired = await page.evaluate(() => window._ctrlTabFired)
    Expected Result: fired === true (meaning keydown event reached the webview listener)
    Failure Indicators: fired === undefined or false (browser intercepted before webview)
    Evidence: .sisyphus/evidence/task-1-ctrl-tab-intercept.txt (write "INTERCEPTABLE" or "NOT INTERCEPTABLE")

  Scenario: Ctrl+L is interceptable in Electrobun webview
    Tool: Same Playwright evaluate approach
    Preconditions: App running
    Steps:
      1. Inject: window.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'l') window._ctrlLFired = true })
      2. await page.keyboard.press('Control+l')
      3. Read: const fired = await page.evaluate(() => window._ctrlLFired)
    Expected Result: fired === true
    Evidence: .sisyphus/evidence/task-1-ctrl-l-intercept.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-1-ctrl-tab-intercept.txt` — "INTERCEPTABLE" or "NOT INTERCEPTABLE: use alt+arrowright"
  - [ ] `.sisyphus/evidence/task-1-ctrl-l-intercept.txt` — "INTERCEPTABLE" or "NOT INTERCEPTABLE: use ctrl+k only"

  **Commit**: NO (no code changes)

---

- [ ] 2. Add HotkeySettings type and defaults to shared/types.ts

  **What to do**:
  - Open `packages/shared/types.ts`
  - Add `HotkeySettings` interface **before** `AppSettings`:
    ```typescript
    export interface HotkeySettings {
      /** Open Add Channel modal */
      newTab: string
      /** Cycle to next watched-channel tab */
      nextTab: string
      /** Cycle to previous watched-channel tab */
      prevTab: string
      /** Open fuzzy tab selector modal */
      tabSelector: string
    }
    ```
  - Add `hotkeys: HotkeySettings` field to `AppSettings` interface (non-optional — required, defaults handle backward compat)
  - Add `hotkeys` to `DEFAULT_SETTINGS`:
    ```typescript
    hotkeys: {
      newTab: 'ctrl+t',
      nextTab: 'ctrl+tab',
      prevTab: 'ctrl+shift+tab',
      tabSelector: 'ctrl+l',
    },
    ```
  - **If Task 1 found Ctrl+Tab NOT interceptable**: use `'alt+arrowright'` / `'alt+arrowleft'` instead
  - **If Task 1 found Ctrl+L NOT interceptable**: use `'ctrl+k'` for tabSelector
  - Run `cd packages/shared && bun run typecheck` (or from root: `bun run typecheck` in shared package)

  **Must NOT do**:
  - Do not make `hotkeys` optional — it is required, `DEFAULT_SETTINGS` provides all values
  - Do not change any existing fields in `AppSettings` or `DEFAULT_SETTINGS`
  - Do not add per-binding enable/disable toggles

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple type + constant addition, no logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — alongside Task 1
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Tasks 3, 4, 5, 6, 7
  - **Blocked By**: Task 1 (to know if defaults need updating)
    - NOTE: Can be written optimistically with Ctrl+Tab/Ctrl+L defaults, then amended after Task 1 result

  **References**:

  **Pattern References**:
  - `packages/shared/types.ts:111-127` — `AppSettings` interface (add `hotkeys` field here)
  - `packages/shared/types.ts:144-175` — `DEFAULT_SETTINGS` (add `hotkeys` block here)
  - `packages/shared/types.ts:129-142` — `OverlayConfig` — model for nested settings sub-object pattern

  **API/Type References**:
  - `packages/desktop/src/store/settings-store.ts:5-42` — `deepMerge` is called on load; new `hotkeys` field will be deep-merged with defaults automatically

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: HotkeySettings type is exported and AppSettings.hotkeys is typed correctly
    Tool: Bash (bun typecheck)
    Preconditions: types.ts modified
    Steps:
      1. cd packages/shared
      2. Run: bunx tsc --noEmit
    Expected Result: Exit code 0, no type errors mentioning HotkeySettings or AppSettings
    Failure Indicators: Type error on hotkeys field
    Evidence: .sisyphus/evidence/task-2-typecheck.txt (tsc output or "PASS")

  Scenario: DEFAULT_SETTINGS.hotkeys has all four required keys
    Tool: Bash (bun eval)
    Preconditions: types.ts modified
    Steps:
      1. bun eval "import { DEFAULT_SETTINGS } from './packages/shared/types.ts'; console.log(JSON.stringify(DEFAULT_SETTINGS.hotkeys))"
    Expected Result: {"newTab":"ctrl+t","nextTab":"ctrl+tab","prevTab":"ctrl+shift+tab","tabSelector":"ctrl+l"} (or updated values from Task 1)
    Failure Indicators: undefined, missing keys
    Evidence: .sisyphus/evidence/task-2-defaults.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-2-typecheck.txt`
  - [ ] `.sisyphus/evidence/task-2-defaults.txt`

  **Commit**: YES (groups alone)
  - Message: `feat(shared): add HotkeySettings type and defaults to AppSettings`
  - Files: `packages/shared/types.ts`
  - Pre-commit: `cd packages/shared && bunx tsc --noEmit`

---

- [ ] 3. Create useHotkeys.ts composable (TDD)

  **What to do**:
  - Create `packages/desktop/src/views/main/composables/useHotkeys.ts`
  - **Write tests first** in `packages/desktop/tests/useHotkeys.test.ts` before implementing

  **Test cases to cover** (write BEFORE implementation):
  - Handler fires when matching key combo is pressed
  - Handler does NOT fire when `document.activeElement` is an `<input>`
  - Handler does NOT fire when `document.activeElement` is a `<textarea>`
  - Handler does NOT fire when `document.activeElement.isContentEditable === true`
  - Handler does NOT fire after `pause()` is called
  - Handler fires again after `resume()` is called
  - Key format parsing: `parseKeyCombo('ctrl+t')` returns `{ ctrlKey: true, key: 't' }`
  - Key format parsing: `parseKeyCombo('ctrl+shift+tab')` returns `{ ctrlKey: true, shiftKey: true, key: 'Tab' }`
  - `Ctrl+K` alias always fires tabSelector action regardless of `settings.hotkeys.tabSelector`

  **Implementation**:

  ```typescript
  // Module-level singleton (not per-call closure):
  type HotkeyAction = 'newTab' | 'nextTab' | 'prevTab' | 'tabSelector'
  type HotkeyHandlers = Record<HotkeyAction, () => void>

  let _handlers: HotkeyHandlers | null = null
  let _isPaused = false
  let _isInitialized = false

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName.toLowerCase()
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
  }

  // parseKeyCombo: 'ctrl+shift+tab' -> { ctrlKey, shiftKey, key: 'Tab' }
  // key normalization: 'tab' -> 'Tab', 't' -> 't', etc.
  export function parseKeyCombo(combo: string): { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; key: string }

  function globalKeydown(e: KeyboardEvent) {
    if (_isPaused || !_handlers) return
    if (isEditableTarget(e.target)) return
    const settings = ... // read from external ref
    // Check Ctrl+K hardcoded alias first
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      _handlers.tabSelector()
      return
    }
    // Check configurable bindings...
  }

  export function useHotkeys(
    settingsRef: Ref<AppSettings | null>,
    handlers: HotkeyHandlers
  ): { pause: () => void; resume: () => void }
  ```

  - `useHotkeys` registers a single `window.addEventListener('keydown', globalKeydown)` on first call
  - On each keydown: reads current `settingsRef.value.hotkeys` dynamically (so binding changes take effect immediately)
  - Checks Ctrl+K hardcoded alias, then checks each configurable binding
  - Returns `{ pause, resume }` — sets `_isPaused` flag
  - Call `window.removeEventListener` in `onUnmounted` callback (via the composable)

  **Key format convention**:
  - Storage format: `'ctrl+t'`, `'ctrl+shift+tab'`, `'alt+arrowright'` (all lowercase)
  - Key names: modifier keys spelled out (`ctrl`, `shift`, `alt`), special keys match `e.key.toLowerCase()` (`tab`, `arrowright`, `arrowleft`)
  - Comparison: `e.key.toLowerCase() === keyPart` after stripping modifier prefixes

  **Must NOT do**:
  - Do NOT install any hotkey library (useMagicKeys, tinykeys, etc.) — raw keydown only
  - Do NOT add `window.addEventListener('keydown')` anywhere outside this file
  - Do NOT handle Escape key globally — modals handle their own Escape
  - Do NOT read settings via `rpc.request` inside the composable — receive as Ref parameter

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires careful singleton design, edge-case handling, TDD
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Module-singleton composable pattern, `onUnmounted` cleanup

  **Parallelization**:
  - **Can Run In Parallel**: YES — alongside Tasks 4 and 5
  - **Parallel Group**: Wave 2 (with Tasks 4 and 5)
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: Task 2 (needs `HotkeySettings` type)

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/PanelNode.vue` — search for `@keydown` — panel-local key handler pattern to understand what already exists and NOT conflict with
  - `packages/desktop/src/views/main/App.vue:1-5` — import/composable usage pattern

  **API/Type References**:
  - `packages/shared/types.ts` — `HotkeySettings`, `AppSettings` (import for Ref typing)

  **Test References**:
  - `packages/desktop/tests/aggregator.test.ts` — bun test file structure and import patterns to follow

  **Acceptance Criteria**:

  ```
  Scenario: Global hotkey fires the correct handler
    Tool: Bash (bun test)
    Preconditions: tests/useHotkeys.test.ts written
    Steps:
      1. cd packages/desktop
      2. bun test tests/useHotkeys.test.ts
    Expected Result: All test cases PASS (0 failures)
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-3-tests.txt (bun test output)

  Scenario: Input-guard prevents hotkeys in text inputs
    Tool: Bash (bun test - specific test case)
    Preconditions: test case for input-guard exists
    Steps:
      1. Test simulates document.activeElement = input element
      2. Fires keydown event
      3. Asserts handler was NOT called
    Expected Result: handler call count = 0
    Evidence: included in task-3-tests.txt

  Scenario: pause/resume API works correctly
    Tool: Bash (bun test)
    Steps:
      1. Call pause() → fire hotkey → assert not called
      2. Call resume() → fire hotkey → assert called
    Expected Result: Both assertions pass
    Evidence: included in task-3-tests.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-3-tests.txt` — full bun test output

  **Commit**: YES
  - Message: `feat(desktop): add useHotkeys composable with input-guard and pause/resume API`
  - Files: `packages/desktop/src/views/main/composables/useHotkeys.ts`, `packages/desktop/tests/useHotkeys.test.ts`
  - Pre-commit: `cd packages/desktop && bun test tests/useHotkeys.test.ts`

---

- [ ] 4. Create fuzzyFilter.ts utility (TDD)

  **What to do**:
  - Create `packages/desktop/src/views/main/utils/fuzzyFilter.ts`
  - **Write tests first** in `packages/desktop/tests/fuzzyFilter.test.ts`

  **Implementation**:

  ```typescript
  /**
   * Returns items whose label contains all characters of query in order (case-insensitive).
   * Items are sorted by how early the match starts (lower index = higher rank).
   */
  export function fuzzyFilter<T extends { label: string }>(items: T[], query: string): T[] {
    if (!query) return items
    const q = query.toLowerCase()
    return items
      .filter((item) => {
        let qi = 0
        for (const ch of item.label.toLowerCase()) {
          if (ch === q[qi]) qi++
          if (qi === q.length) return true
        }
        return false
      })
      .sort((a, b) => {
        const ai = a.label.toLowerCase().indexOf(q[0]!)
        const bi = b.label.toLowerCase().indexOf(q[0]!)
        return ai - bi
      })
  }
  ```

  **Test cases to cover**:
  - Empty query returns all items
  - Query 'hm' matches 'home' but not 'ch1'
  - Query matches case-insensitively: 'HOME' matches 'home'
  - Query 'ch' matches 'channel1' and 'mychannels' but sorts 'channel1' first (earlier match)
  - Query with no match returns empty array
  - Items with unicode characters don't throw

  **Must NOT do**:
  - Do NOT use any fuzzy library (fuse.js, etc.)
  - Keep it a pure function with no side effects

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small pure function with tests
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — alongside Tasks 3 and 5
  - **Parallel Group**: Wave 2 (with Tasks 3 and 5)
  - **Blocks**: Task 5 (TabSelectorModal uses fuzzyFilter)
  - **Blocked By**: Task 2 (no direct dep, but should wait for wave readiness)

  **References**:

  **Test References**:
  - `packages/desktop/tests/aggregator.test.ts` — test file import and structure pattern

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: fuzzyFilter matches correct items
    Tool: Bash (bun test)
    Preconditions: tests/fuzzyFilter.test.ts written
    Steps:
      1. cd packages/desktop
      2. bun test tests/fuzzyFilter.test.ts
    Expected Result: All test cases PASS (0 failures)
    Evidence: .sisyphus/evidence/task-4-tests.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-4-tests.txt`

  **Commit**: YES
  - Message: `feat(desktop): add fuzzyFilter utility with tests`
  - Files: `packages/desktop/src/views/main/utils/fuzzyFilter.ts`, `packages/desktop/tests/fuzzyFilter.test.ts`
  - Pre-commit: `cd packages/desktop && bun test tests/fuzzyFilter.test.ts`

---

- [ ] 5. Create TabSelectorModal.vue component

  **What to do**:
  - Create `packages/desktop/src/views/main/components/TabSelectorModal.vue`
  - Follow the `AddChannelModal.vue` modal pattern: Teleport to body + backdrop click to close

  **Props**:

  ```typescript
  interface TabItem {
    id: string // 'home' or WatchedChannel.id
    label: string // Display name
    platform?: 'twitch' | 'kick' | 'youtube' // undefined for home
    isLive?: boolean
  }

  defineProps<{
    tabs: TabItem[]
    activeTabId: string
  }>()

  defineEmits<{
    select: [id: string]
    close: []
  }>()
  ```

  **Behavior**:
  - On mount: auto-focus the search `<input>` element
  - Search input filters `tabs` through `fuzzyFilter(tabs, query)` (import from `../utils/fuzzyFilter`)
  - Selected item index via `selectedIdx` ref, initially 0 (or index of `activeTabId` if found)
  - ArrowDown: increment `selectedIdx` (clamp to `filteredTabs.length - 1`)
  - ArrowUp: decrement `selectedIdx` (clamp to 0; if list empty, stay at -1)
  - Enter: emit `select(filteredTabs[selectedIdx].id)` then emit `close()`
  - Escape: emit `close()`
  - Backdrop click: emit `close()`
  - Click on item: emit `select(item.id)` then emit `close()`
  - On `query` change: reset `selectedIdx` to 0

  **Template structure**:

  ```html
  <Teleport to="body">
    <div class="modal-backdrop" data-testid="tab-selector-modal" @click.self="emit('close')">
      <div class="modal" @keydown.stop>
        <div class="modal-search">
          <input
            ref="searchRef"
            v-model="query"
            placeholder="Switch to tab…"
            class="search-input"
            data-testid="tab-selector-search"
            @keydown.down.prevent="selectedIdx = Math.min(selectedIdx + 1, filteredTabs.length - 1)"
            @keydown.up.prevent="selectedIdx = Math.max(selectedIdx - 1, 0)"
            @keydown.enter.prevent="confirmSelection"
            @keydown.escape.prevent="emit('close')"
          />
        </div>
        <div class="modal-list" data-testid="tab-selector-list">
          <button
            v-for="(tab, idx) in filteredTabs"
            :key="tab.id"
            class="tab-item"
            :class="{ selected: idx === selectedIdx, active: tab.id === activeTabId }"
            data-testid="tab-selector-item"
            @click="selectTab(tab.id)"
          >
            <!-- platform icon + label + live dot -->
          </button>
        </div>
        <div v-if="filteredTabs.length === 0" class="modal-empty">No tabs match "{{ query }}"</div>
      </div>
    </div>
  </Teleport>
  ```

  **Styling**:
  - Same `--c-bg`, `--c-surface`, `--c-border`, `--c-text` CSS variables as rest of app
  - Modal max-width: 400px, centered (same as AddChannelModal)
  - Each tab item shows: platform icon (reuse SVGs from ChannelTabBar.vue), live dot if `isLive`, tab label
  - Selected item: `background: rgba(167, 139, 250, 0.15)` (same purple accent as nav-item.active)

  **Focus restore on close**:
  - Save `document.activeElement` before mount in `previousFocus` variable
  - On `close` emit / unmount: restore focus via `(previousFocus as HTMLElement)?.focus()`

  **Must NOT do**:
  - Do NOT list main section tabs (chat/events/platforms/settings) — watched tabs only
  - Do NOT add non-navigation actions (settings, auth, etc.)
  - Do NOT use external fuzzy library

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Vue component with modal, search input, keyboard navigation, platform icons, live status
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Template patterns, `@keydown.stop` on modal, `onMounted` autofocus

  **Parallelization**:
  - **Can Run In Parallel**: YES — alongside Tasks 3 and 4
  - **Parallel Group**: Wave 2 (with Tasks 3 and 4)
  - **Blocks**: Task 6
  - **Blocked By**: Tasks 2, 4 (needs HotkeySettings type and fuzzyFilter)

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/AddChannelModal.vue` — Teleport + backdrop + modal structure to follow exactly
  - `packages/desktop/src/views/main/components/ChannelTabBar.vue:83-113` — platform icon SVGs to reuse
  - `packages/desktop/src/views/main/App.vue:474-498` — `--c-*` CSS variables in use

  **API/Type References**:
  - `packages/shared/types.ts:WatchedChannel` — source of `platform` and `displayName`
  - `packages/desktop/src/views/main/utils/fuzzyFilter.ts` — import fuzzyFilter here

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: TabSelectorModal opens, shows tabs, and allows fuzzy search
    Tool: Playwright
    Preconditions: App running, at least 1 watched channel added, TabSelectorModal shown (via showTabSelector = true in App)
    Steps:
      1. Press Ctrl+K (or trigger showTabSelector programmatically)
      2. await page.waitForSelector('[data-testid="tab-selector-modal"]')
      3. Verify search input is focused: await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'tab-selector-search')
      4. Type 'home': await page.keyboard.type('home')
      5. Verify filtered list: await page.locator('[data-testid="tab-selector-item"]').count() — should be >= 1
      6. Verify "My channels" (home tab) appears in results
    Expected Result: Modal visible, search focuses, 'home' shows in results
    Failure Indicators: Modal not visible, input not focused, no results
    Evidence: .sisyphus/evidence/task-5-modal-open.png

  Scenario: Keyboard navigation and selection works
    Tool: Playwright
    Preconditions: Modal open, at least 2 tabs available
    Steps:
      1. Press ArrowDown → second item becomes selected (has class 'selected')
      2. Press ArrowDown again → third item (or wraps)
      3. Press Enter → modal closes, active tab changes
      4. await page.locator('[data-testid="tab-selector-modal"]').count() — should be 0
    Expected Result: Modal closed after Enter, tab switched
    Evidence: .sisyphus/evidence/task-5-keyboard-nav.png

  Scenario: Escape closes modal without changing tab
    Tool: Playwright
    Steps:
      1. Open modal (Ctrl+K)
      2. Press Escape
      3. await page.locator('[data-testid="tab-selector-modal"]').count()
    Expected Result: count === 0 (modal gone)
    Evidence: .sisyphus/evidence/task-5-escape-close.png
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-5-modal-open.png`
  - [ ] `.sisyphus/evidence/task-5-keyboard-nav.png`
  - [ ] `.sisyphus/evidence/task-5-escape-close.png`

  **Commit**: YES
  - Message: `feat(desktop): add TabSelectorModal component with fuzzy search and keyboard navigation`
  - Files: `packages/desktop/src/views/main/components/TabSelectorModal.vue`
  - Pre-commit: `cd packages/desktop && bun run typecheck`

---

- [ ] 6. Wire hotkeys and TabSelectorModal into App.vue

  **What to do**:
  - Import `useHotkeys` from `'./composables/useHotkeys'`
  - Import `TabSelectorModal` from `'./components/TabSelectorModal'`
  - Add `showTabSelector = ref(false)` reactive ref
  - Add `TabItem` type construction for the modal (tabs list = [{id: 'home', label: 'My channels'}, ...tabWatchedChannels mapped to {id, label, platform, isLive}])
  - Call `useHotkeys(settings, { ... })` in `<script setup>` with handlers:
    - `newTab: () => { showAddModal.value = true }`
    - `nextTab: () => { cycleTab(+1) }`
    - `prevTab: () => { cycleTab(-1) }`
    - `tabSelector: () => { showTabSelector.value = true }`
  - Implement `cycleTab(direction: 1 | -1)`:
    ```typescript
    function cycleTab(direction: 1 | -1) {
      // Switch main tab to 'chat' first if not already
      if (activeTab.value !== 'chat') {
        activeTab.value = 'chat'
      }
      const tabList = ['home', ...[...tabChannelIds.value]]
      if (tabList.length <= 1) return
      const currentIdx = tabList.indexOf(activeWatchedTab.value)
      const nextIdx = (currentIdx + direction + tabList.length) % tabList.length
      activeWatchedTab.value = tabList[nextIdx]!
    }
    ```
  - Add `data-testid="add-channel-modal"` to `<AddChannelModal>` component usage in template
  - Add `<TabSelectorModal>` to template:
    ```html
    <TabSelectorModal
      v-if="showTabSelector"
      :tabs="tabSelectorItems"
      :active-tab-id="activeWatchedTab"
      @select="(id) => { activeWatchedTab = id; activeTab = 'chat' }"
      @close="showTabSelector = false"
    />
    ```
  - Expose `pauseHotkeys` / `resumeHotkeys` from `useHotkeys()` return value and pass to SettingsPanel via a `provide/inject` OR via a module-level export from `useHotkeys.ts` — use module-level export of `pause`/`resume` to avoid prop drilling

  **Must NOT do**:
  - Do NOT add `window.addEventListener('keydown')` in App.vue — let useHotkeys handle it
  - Do NOT change `switchTab()` function — `cycleTab` is new, separate from `switchTab`
  - Do NOT add main section tab cycling (chat/events/platforms/settings via Ctrl+Tab)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration work touching App.vue, composable wiring, state management
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Composable integration, reactive state, computed tab list construction

  **Parallelization**:
  - **Can Run In Parallel**: YES — alongside Task 7
  - **Parallel Group**: Wave 3 (with Task 7)
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 3, 5 (needs useHotkeys and TabSelectorModal)

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/App.vue:31-51` — existing refs and state (`activeWatchedTab`, `tabChannelIds`, `tabWatchedChannels`, `showAddModal`)
  - `packages/desktop/src/views/main/App.vue:395-400` — `switchTab()` function pattern (cycleTab is similar)
  - `packages/desktop/src/views/main/App.vue:658-665` — AddChannelModal usage in template (add data-testid here)
  - `packages/desktop/src/views/main/composables/useHotkeys.ts` — import and usage (built in Task 3)
  - `packages/desktop/src/views/main/components/TabSelectorModal.vue` — import (built in Task 5)

  **API/Type References**:
  - `packages/shared/types.ts:WatchedChannel` — `platform`, `displayName` fields for tab items

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Ctrl+T opens Add Channel modal
    Tool: Playwright
    Preconditions: App running, no modal open, focus NOT in any text input
    Steps:
      1. Click somewhere on the app background to ensure no input focus
      2. await page.keyboard.press('Control+t')
      3. await page.waitForSelector('[data-testid="add-channel-modal"]', { timeout: 3000 })
    Expected Result: Add Channel modal visible in DOM
    Failure Indicators: Timeout (modal never appeared), browser intercepted Ctrl+T
    Evidence: .sisyphus/evidence/task-6-ctrl-t.png

  Scenario: Ctrl+T does NOT open modal when focus is in ChatInput
    Tool: Playwright
    Preconditions: App running, chat input focused
    Steps:
      1. await page.locator('textarea.chat-input, input.chat-input, [data-testid="chat-input"]').focus()
      2. await page.keyboard.press('Control+t')
      3. const modalCount = await page.locator('[data-testid="add-channel-modal"]').count()
    Expected Result: modalCount === 0 (modal did NOT open)
    Evidence: .sisyphus/evidence/task-6-ctrl-t-in-input.txt (write modal count)

  Scenario: Ctrl+Tab cycles to next watched-channel tab
    Tool: Playwright
    Preconditions: At least 2 tabs exist (home + 1 watched channel), activeWatchedTab === 'home'
    Steps:
      1. Verify initial tab: await page.locator('.tab.active').first().textContent()  — should contain 'My channels'
      2. await page.keyboard.press('Control+Tab')
      3. const activeTab = await page.locator('.tab.active').first().textContent()
    Expected Result: Active tab changed from 'My channels' to the first watched channel name
    Failure Indicators: Tab did not change (Ctrl+Tab not intercepted)
    Evidence: .sisyphus/evidence/task-6-ctrl-tab.png

  Scenario: Ctrl+K opens TabSelectorModal
    Tool: Playwright
    Preconditions: App running, no modal open
    Steps:
      1. await page.keyboard.press('Control+k')
      2. await page.waitForSelector('[data-testid="tab-selector-modal"]', { timeout: 3000 })
    Expected Result: Tab selector modal visible
    Evidence: .sisyphus/evidence/task-6-ctrl-k.png
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-6-ctrl-t.png`
  - [ ] `.sisyphus/evidence/task-6-ctrl-t-in-input.txt`
  - [ ] `.sisyphus/evidence/task-6-ctrl-tab.png`
  - [ ] `.sisyphus/evidence/task-6-ctrl-k.png`

  **Commit**: YES
  - Message: `feat(desktop): wire hotkeys and TabSelectorModal into App.vue`
  - Files: `packages/desktop/src/views/main/App.vue`
  - Pre-commit: `cd packages/desktop && bun run typecheck`

---

- [ ] 7. Add Keyboard Shortcuts section to SettingsPanel.vue

  **What to do**:
  - Open `packages/desktop/src/views/main/components/SettingsPanel.vue`
  - **Fix existing bug first**: In the `local` ref initialization, add `hotkeys` deep-copy:
    ```typescript
    const local = ref<AppSettings>(
      props.settings
        ? {
            ...props.settings,
            overlay: { ...props.settings.overlay },
            hotkeys: { ...props.settings.hotkeys }, // ADD THIS
          }
        : {
            ...DEFAULT_SETTINGS,
            overlay: { ...DEFAULT_SETTINGS.overlay },
            hotkeys: { ...DEFAULT_SETTINGS.hotkeys },
          },
    )
    ```
  - Do the same in the `watch(props.settings)` handler:
    ```typescript
    local.value = { ...s, overlay: { ...s.overlay }, hotkeys: { ...s.hotkeys } }
    ```
  - Import `pause` and `resume` from `'../composables/useHotkeys'` (module-level exports)
  - Add recording state:
    ```typescript
    const recordingAction = ref<keyof HotkeySettings | null>(null)
    ```
  - `startRecording(action)`: set `recordingAction.value = action`, call `pause()`
  - Key recording handler: `window.addEventListener('keydown', onRecordKeydown)` when `recordingAction` is set; on next keydown: format key combo, update `local.value.hotkeys[action]`, call `stopRecording()`
  - `stopRecording()`: set `recordingAction.value = null`, `window.removeEventListener('keydown', onRecordKeydown)`, call `resume()`
  - `onRecordKeydown(e: KeyboardEvent)`: `e.preventDefault()`, `e.stopImmediatePropagation()`, if key is `Escape` → cancel recording (don't save), otherwise format key combo string and save to `local.value.hotkeys[action]`
  - Add new `<section class="settings-section">` at the end of `settings-content`:

    ```html
    <section class="settings-section">
      <h3 class="section-title">Keyboard Shortcuts</h3>
      <div v-for="(action, key) in hotkeysConfig" :key="key" class="form-row">
        <div class="form-label">
          <span>{{ action.label }}</span>
          <span class="form-hint">{{ action.description }}</span>
        </div>
        <button
          class="hotkey-badge"
          :class="{ recording: recordingAction === key }"
          @click="startRecording(key as keyof HotkeySettings)"
        >
          <template v-if="recordingAction === key">Press a key…</template>
          <template v-else>
            <kbd>{{ formatKeyCombo(local.hotkeys[key as keyof HotkeySettings]) }}</kbd>
          </template>
        </button>
      </div>
    </section>
    ```

  - `hotkeysConfig` computed/const:
    ```typescript
    const hotkeysConfig = {
      newTab: { label: 'Open new tab', description: 'Add a watched channel tab' },
      nextTab: { label: 'Next tab', description: 'Cycle to the next tab' },
      prevTab: { label: 'Previous tab', description: 'Cycle to the previous tab' },
      tabSelector: {
        label: 'Tab selector',
        description: 'Open fuzzy tab search (Ctrl+K always works)',
      },
    }
    ```
  - `formatKeyCombo(combo: string)`: capitalize first letters, `'ctrl+t'` → `'Ctrl+T'`, `'ctrl+shift+tab'` → `'Ctrl+Shift+Tab'`

  **Must NOT do**:
  - Do NOT restructure existing settings sections
  - Do NOT change the Save button behavior or existing save flow
  - Do NOT allow `Escape` to be recorded as a binding (cancel recording instead)
  - Do NOT show conflict warning UI (out of scope) — just save without warning

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: New UI section in Vue component with recording interaction, kbd styling
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Component reactivity, watch patterns, event listener lifecycle

  **Parallelization**:
  - **Can Run In Parallel**: YES — alongside Task 6
  - **Parallel Group**: Wave 3 (with Task 6)
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 2, 3 (needs HotkeySettings type and pause/resume from useHotkeys)

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/SettingsPanel.vue:113-167` — existing settings section pattern to follow for new section
  - `packages/desktop/src/views/main/components/SettingsPanel.vue:16-20` — local ref initialization (fix the deep-copy issue here)
  - `packages/desktop/src/views/main/components/SettingsPanel.vue:25-35` — watch(props.settings) handler (also fix here)

  **API/Type References**:
  - `packages/shared/types.ts:HotkeySettings` — key names for `hotkeysConfig`
  - `packages/desktop/src/views/main/composables/useHotkeys.ts` — `pause` and `resume` named exports

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Keyboard Shortcuts section renders with current bindings
    Tool: Playwright
    Preconditions: App running, navigate to Settings tab
    Steps:
      1. await page.locator('.nav-item[title="Settings"]').click()
      2. await page.waitForSelector('.settings-panel')
      3. Scroll down to Keyboard Shortcuts section
      4. Verify 4 rows: 'Open new tab', 'Next tab', 'Previous tab', 'Tab selector'
      5. Check each shows a <kbd> element with binding text
    Expected Result: All 4 rows visible with correct default bindings
    Evidence: .sisyphus/evidence/task-7-settings-hotkeys.png

  Scenario: Click-to-rebind enters recording mode and captures new binding
    Tool: Playwright
    Preconditions: Settings panel visible
    Steps:
      1. Click the 'Open new tab' binding badge (currently showing 'Ctrl+T')
      2. Verify badge text changes to 'Press a key…'
      3. Press Control+p
      4. Verify badge text changes to 'Ctrl+P'
      5. Click Save changes button
      6. Verify: bun eval call to getSettings() shows hotkeys.newTab === 'ctrl+p'
    Expected Result: Binding persisted as 'ctrl+p'
    Failure Indicators: Badge doesn't enter recording, binding doesn't update, save doesn't persist
    Evidence: .sisyphus/evidence/task-7-rebind.png

  Scenario: Recording mode suppresses global hotkeys (Ctrl+T does NOT open modal during recording)
    Tool: Playwright
    Preconditions: In recording mode for 'Open new tab'
    Steps:
      1. Click 'Open new tab' badge → recording mode active
      2. Press Control+t (to set new binding)
      3. Verify: [data-testid="add-channel-modal"] count === 0 (modal did NOT open)
      4. Verify: badge now shows 'Ctrl+T' (recorded as new binding, did not trigger action)
    Expected Result: No modal opened, binding recorded as 'ctrl+t'
    Evidence: .sisyphus/evidence/task-7-recording-suppression.txt

  Scenario: Escape cancels recording without changing binding
    Tool: Playwright
    Steps:
      1. Note current binding: e.g. 'Ctrl+T'
      2. Click badge to enter recording mode
      3. Press Escape
      4. Verify badge returns to showing 'Ctrl+T' (unchanged)
      5. Verify recordingAction === null (no longer in recording mode)
    Expected Result: Binding unchanged, recording cancelled
    Evidence: .sisyphus/evidence/task-7-escape-cancel.png
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-7-settings-hotkeys.png`
  - [ ] `.sisyphus/evidence/task-7-rebind.png`
  - [ ] `.sisyphus/evidence/task-7-recording-suppression.txt`
  - [ ] `.sisyphus/evidence/task-7-escape-cancel.png`

  **Commit**: YES
  - Message: `feat(desktop): add Keyboard Shortcuts section to SettingsPanel with click-to-rebind`
  - Files: `packages/desktop/src/views/main/components/SettingsPanel.vue`
  - Pre-commit: `cd packages/desktop && bun run typecheck`

---

- [ ] 8. Run bun run fix, verify typecheck and lint pass

  **What to do**:
  - From the monorepo root: `bun run fix` (runs oxfmt formatter + oxlint fixer across all changed files)
  - From `packages/desktop`: `bun run typecheck` (`vue-tsc --noEmit`)
  - From monorepo root: `bun run check` (typecheck + lint + format check)
  - Fix any remaining lint or type errors
  - Run `bun test tests/` in `packages/desktop` to confirm all tests pass

  **Must NOT do**:
  - Do NOT skip lint/format errors — fix them all
  - Do NOT use `// eslint-disable` or `@ts-ignore` to paper over errors

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (sequential after Waves 1-3)
  - **Blocks**: Final verification wave
  - **Blocked By**: Tasks 6, 7

  **References**:

  **Pattern References**:
  - `AGENTS.md` (root) — `bun run fix`, `bun run check`, `bun run typecheck` commands

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: bun run check exits clean
    Tool: Bash
    Steps:
      1. cd /home/satont/Projects/twirchat
      2. bun run check
    Expected Result: Exit code 0, no errors or warnings
    Failure Indicators: Non-zero exit, lint errors, type errors, format issues
    Evidence: .sisyphus/evidence/task-8-check.txt (full output)

  Scenario: All unit tests pass
    Tool: Bash
    Steps:
      1. cd packages/desktop
      2. bun test tests/
    Expected Result: All tests pass (0 failures), includes useHotkeys.test.ts and fuzzyFilter.test.ts
    Evidence: .sisyphus/evidence/task-8-tests.txt (bun test output)
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-8-check.txt`
  - [ ] `.sisyphus/evidence/task-8-tests.txt`

  **Commit**: YES
  - Message: `fix: format and lint all hotkeys system files`
  - Files: all changed files
  - Pre-commit: `bun run check`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, check types, bun eval). For each "Must NOT Have": search codebase for forbidden patterns (grep for `window.addEventListener('keydown')` outside useHotkeys.ts, grep for new RPC calls, grep for `hotkeys?:` optionality). Check `.sisyphus/evidence/` files exist. Compare deliverables against plan.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run `cd packages/desktop && bun run typecheck` and `bun run check`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in production, commented-out code, unused imports. Check for AI slop: excessive comments, over-abstraction, generic variable names like `data`/`result`. Check `useHotkeys.ts` for module-singleton correctness.
      Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
      Start app in dev mode. Execute ALL QA scenarios from Tasks 5, 6, 7 — follow exact steps. Test: (a) Ctrl+T in textarea stays closed, (b) Ctrl+Tab cycles correctly with 3+ tabs, (c) Ctrl+K opens modal with fuzzy search working, (d) rebind to Ctrl+P → press Ctrl+P → tab selector opens, (e) rebind Escape cancelled, binding unchanged. Save all evidence screenshots.
      Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
      For each task (1-8): read "What to do", compare to actual diff. Verify 1:1 — nothing missing, nothing extra. Check that `PanelNode.vue` local shortcuts were NOT touched, that no new RPC entries were added to `rpc.ts`, that `TabSelectorModal` does NOT contain main-section tab navigation. Flag any unaccounted changes.
      Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

```
commit 1 (Task 2): feat(shared): add HotkeySettings type and defaults to AppSettings
  packages/shared/types.ts

commit 2 (Task 3): feat(desktop): add useHotkeys composable with input-guard and pause/resume API
  packages/desktop/src/views/main/composables/useHotkeys.ts
  packages/desktop/tests/useHotkeys.test.ts

commit 3 (Task 4): feat(desktop): add fuzzyFilter utility with tests
  packages/desktop/src/views/main/utils/fuzzyFilter.ts
  packages/desktop/tests/fuzzyFilter.test.ts

commit 4 (Task 5): feat(desktop): add TabSelectorModal component with fuzzy search and keyboard navigation
  packages/desktop/src/views/main/components/TabSelectorModal.vue

commit 5 (Task 6): feat(desktop): wire hotkeys and TabSelectorModal into App.vue
  packages/desktop/src/views/main/App.vue

commit 6 (Task 7): feat(desktop): add Keyboard Shortcuts section to SettingsPanel with click-to-rebind
  packages/desktop/src/views/main/components/SettingsPanel.vue

commit 7 (Task 8): fix: format and lint all hotkeys system files
  all changed files
```

---

## Success Criteria

### Verification Commands

```bash
# Type check
cd packages/desktop && bun run typecheck   # Expected: no errors

# Lint + format
bun run check                               # Expected: exit 0

# Unit tests
cd packages/desktop && bun test tests/     # Expected: all pass

# Verify HotkeySettings in DEFAULT_SETTINGS
bun eval "import { DEFAULT_SETTINGS } from './packages/shared/types.ts'; console.log(JSON.stringify(DEFAULT_SETTINGS.hotkeys))"
# Expected: {"newTab":"ctrl+t","nextTab":"ctrl+tab","prevTab":"ctrl+shift+tab","tabSelector":"ctrl+l"}
```

### Final Checklist

- [ ] `HotkeySettings` type exported from `packages/shared/types.ts`, all 4 keys required
- [ ] `DEFAULT_SETTINGS.hotkeys` has all 4 defaults
- [ ] `useHotkeys.ts` is the ONLY file with `window.addEventListener('keydown')`
- [ ] `pause()`/`resume()` module-level exports from `useHotkeys.ts`
- [ ] `TabSelectorModal.vue` has `data-testid="tab-selector-modal"`
- [ ] `AddChannelModal` usage in App.vue has `data-testid="add-channel-modal"`
- [ ] `cycleTab()` switches to `'chat'` first if `activeTab !== 'chat'`
- [ ] `SettingsPanel.vue` local ref deep-copies `hotkeys` object
- [ ] Recording mode `Escape` cancels without saving
- [ ] All bun test assertions pass (0 failures)
- [ ] `bun run check` exits 0
