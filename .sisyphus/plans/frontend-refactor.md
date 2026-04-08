# Frontend Refactor: Vue 3 Best Practices

## TL;DR

> **Quick Summary**: Full refactor of the TwirChat desktop Vue 3 frontend to eliminate inline SVGs,
> deduplicate platform utilities, extract business logic into composables, and migrate all state
> to Pinia stores — aligning the codebase with Vue 3 best practices throughout.
>
> **Deliverables**:
>
> - `src/views/shared/utils/platform.ts` — single source of truth for platformColor + platformIconSvg (pure TS, no Vue, shared with overlay)
> - `src/assets/icons/platforms/` — SVG files for twitch/youtube/kick extracted from inline markup
> - `src/views/main/composables/` — useMessageParsing, usePolling, useChatScroll, useRpcListener
> - `src/views/main/stores/` — accounts, settings, channelStatus, layout (all Pinia)
> - All 21 components refactored: SVG via vite-svg-loader, no inline `<svg>` or `v-html` SVG
> - `main.ts` registers `createPinia()` before mounting app
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: Task 1 → Task 5 → Task 7 → Task 10 → Task 12 → F1–F4

---

## Context

### Original Request

> "Код на desktop приложении говно. Поищи vue best practice, давай не будем использовать any,
> давай создадим скилы со всеми best practice. Хотел бы видеть композаблы, pinia, переиспользование
> компонентов, не хотел бы inline svg или svg как vue component, а хотел бы видеть это как плагин
> для vite — положить svg и импортировать его."

### Interview Summary

**Key Discussions**:

- Full refactor (not partial): SVG extraction + Pinia migration + composables all in one plan
- Layout store: migrate to Pinia (included, not left as custom singleton)
- Tests: none required — QA via agent-executed scenarios
- `platform.ts` utility: PURE TS function (not Vue composable) so overlay can use it too
- `pinia@3.0.4` + `vite-svg-loader@5.1.1` already installed; Vite configs already updated

**Research Findings**:

- Pinia is the official Vue 3 state manager; `defineStore` composable API preferred
- `vite-svg-loader` with `defaultImport: 'component'` turns `.svg` files into Vue components
- 9 files contain `platformColor()`/`platformIconSvg()` duplicates — single utility eliminates all
- `rpc.removeMessageListener` API does NOT exist — `useRpcListener` must use `onBeforeUnmount` pattern with `rpc.on.*` handlers stored in refs and nulled out

### Metis Review

**Identified Gaps** (addressed):

- `platform.ts` must be a PURE utility, not a Vue composable — overlay has no Pinia/Vue app
- Tasks 2+3 (Pinia registration + store skeletons) must be ONE atomic commit
- `WatchedChannelsView.vue` must only be touched in Task 12 (layout migration) — not earlier
- Task 11 is SVG-swap-only for remaining ~14 components — no new composables there
- `layout-tree.ts` and `migration.ts` in `utils/` and `services/` must NOT be moved or touched
- Verify `vue-tsc --noEmit` passes after every wave before proceeding to next

---

## Work Objectives

### Core Objective

Refactor the TwirChat desktop frontend to follow Vue 3 best practices: extract all inline SVGs to
files consumed via vite-svg-loader, deduplicate the `platformColor`/`platformIconSvg` helpers into a
single shared pure utility, migrate all state management to Pinia stores, and move component-level
business logic into focused composables.

### Concrete Deliverables

- `packages/desktop/src/assets/icons/platforms/{twitch,youtube,kick}.svg`
- `packages/desktop/src/views/shared/utils/platform.ts` (pure TS, color + icon exports)
- `packages/desktop/src/views/main/composables/useMessageParsing.ts`
- `packages/desktop/src/views/main/composables/usePolling.ts`
- `packages/desktop/src/views/main/composables/useChatScroll.ts`
- `packages/desktop/src/views/main/composables/useRpcListener.ts`
- `packages/desktop/src/views/main/stores/accounts.ts` (Pinia)
- `packages/desktop/src/views/main/stores/settings.ts` (Pinia)
- `packages/desktop/src/views/main/stores/channelStatus.ts` (Pinia)
- `packages/desktop/src/views/main/stores/layout.ts` (migrated to Pinia)
- `packages/desktop/src/views/main/main.ts` with `createPinia()` registered
- All 21 components: zero inline `<svg>`, zero `v-html` SVG injection, using SVG components

### Definition of Done

- [ ] `vue-tsc --noEmit` (from `packages/desktop`) exits 0 after every wave
- [ ] `bun run lint` (from repo root `/home/satont/Projects/twirchat`) exits 0
- [ ] `bun run format:check` (from repo root) exits 0
- [ ] Zero `platformIconSvg()` v-html calls remain in `src/views/` — all replaced by imported SVG components
- [ ] Zero duplicate local `platformColor`/`platformIconSvg` function/const definitions (imports OK)
- [ ] Non-platform UI SVGs in App.vue, StreamEditor.vue, PlatformsPanel.vue, ChatList.vue are explicitly OUT OF SCOPE
- [ ] `badge.imageUrl` `v-html` in ChatMessage.vue is OUT OF SCOPE (API-dynamic SVG, not hardcoded)
- [ ] All state that was in custom singletons now in Pinia stores (4 stores: accounts, settings, channelStatus, layout)
- [ ] Overlay (`src/views/overlay/App.vue`) imports `platformColor` from `src/views/shared/utils/platform.ts` (no platform icon SVGs — overlay uses color dot only)

### Must Have

- Platform SVG icons extractable as vite-svg-loader Vue components
- Single `platformColor(platform)` function referenced by all consumers
- Pinia `useAccountsStore`, `useSettingsStore`, `useChannelStatusStore`, `useLayoutStore`
- `createPinia()` installed in `main.ts` before `app.mount()`
- Composables with proper `onUnmounted` cleanup (no memory leaks)
- All existing functionality preserved (no behavioral regressions)

### Must NOT Have (Guardrails)

- NO Bun module imports in any `src/views/**` file (bun:sqlite, node:fs, etc.)
- NO `any` types introduced (use proper generics/interfaces)
- NO new composables created in Task 13 (SVG-swap-only wave)
- NO changes to `WatchedChannelsView.vue` before Task 14
- NO moving/touching `utils/layout-tree.ts`, `utils/layout-tree.test.ts`, `services/migration.ts`
- NO `pinia-plugin-persistedstate` (not requested)
- NO `useToast` extraction (not in scope)
- NO `shallowReactive` spread tricks inside Pinia actions
- NO `defineElectrobunRPC` import from `electrobun/view` — always `Electroview.defineRPC`
- NO removal of `waitForSocket()` in `main.ts`
- NO removing `badge.imageUrl` `v-html` in `ChatMessage.vue` — badge SVGs come from external API (out of scope)
- NO removing non-platform UI SVGs from `App.vue` (nav icons, update icons) — those are out of scope for this refactor

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES (bun test, `tests/` directory)
- **Automated tests**: None for this refactor (user explicitly said "no tests")
- **Agent-Executed QA**: MANDATORY for every task

### QA Policy

Every task includes agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **Type check gate**: `vue-tsc --noEmit` run via Bash after each wave
- **Grep verification**: Bash grep for forbidden patterns (inline svg, duplicate helpers)

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — run immediately, no dependencies):
├── Task 1: Extract platform SVGs + create shared platform utility [quick]
└── Task 2: Register Pinia + create 4 store skeletons (atomic commit) [quick]

Wave 2 (Composables — depends on Wave 1 completing):
├── Task 3: useMessageParsing composable [quick]
├── Task 4: usePolling composable [quick]
├── Task 5: useChatScroll composable [quick]
├── Task 6: useRpcListener composable [quick]
└── Task 7: Refactor overlay/App.vue (SVG + platform utility) [quick]

Wave 3 (Component refactor — depends on Wave 2 completing):
├── Task 8:  Refactor ChatMessage.vue (useMessageParsing + SVG) [unspecified-high]
├── Task 9:  Refactor ChatList.vue (usePolling + useChatScroll + SVG) [unspecified-high]
├── Task 10: Refactor App.vue (Pinia stores + useRpcListener) [unspecified-high]
├── Task 11: Refactor PlatformsPanel.vue (accounts Pinia store + SVG) [unspecified-high]
├── Task 12: Refactor StreamEditor.vue (usePolling + SVG) [unspecified-high]
└── Task 13: SVG-swap-only for remaining 14 components [unspecified-high]

Wave 4 (Layout migration — depends on Wave 3 completing — SEQUENTIAL):
└── Task 14: Migrate useLayoutStore to Pinia (all consumers atomically) [unspecified-high]

Wave FINAL (4 parallel reviewers — after ALL tasks):
├── F1: Plan Compliance Audit [oracle]
├── F2: Code Quality Review [unspecified-high]
├── F3: Real Manual QA [unspecified-high] + playwright skill
└── F4: Scope Fidelity Check [deep]
```

**Critical Path**: Task 1 → Task 3 → Task 8 → Task 14 → F1–F4
**Parallel Speedup**: ~65% faster than sequential
**Max Concurrent**: 5 (Wave 3 tasks)

### Dependency Matrix

| Task  | Depends On           | Blocks                                 |
| ----- | -------------------- | -------------------------------------- |
| 1     | —                    | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 |
| 2     | —                    | 10, 11, 12                             |
| 3     | 1                    | 8                                      |
| 4     | 1                    | 9, 12                                  |
| 5     | 1                    | 9                                      |
| 6     | 1                    | 10                                     |
| 7     | 1                    | —                                      |
| 8     | 3                    | —                                      |
| 9     | 4, 5                 | —                                      |
| 10    | 2, 6                 | —                                      |
| 11    | 2, 1                 | —                                      |
| 12    | 2, 4, 1              | —                                      |
| 13    | 1                    | —                                      |
| 14    | 8, 9, 10, 11, 12, 13 | F1–F4                                  |
| F1–F4 | 14                   | —                                      |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks → T1 `quick`, T2 `quick`
- **Wave 2**: 5 tasks → T3–T6 `quick`, T7 `quick`
- **Wave 3**: 6 tasks → T8–T13 `unspecified-high`
- **Wave 4**: 1 task → T14 `unspecified-high`
- **Final**: 4 tasks → F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high` + playwright, F4 `deep`

---

## TODOs

- [ ] 1. Extract platform SVGs + create shared platform utility

  **What to do**:
  - Create directory `packages/desktop/src/assets/icons/platforms/`
  - Extract the Twitch SVG icon into `src/assets/icons/platforms/twitch.svg` (source from `ChatMessage.vue` inline SVG)
  - Extract the YouTube SVG icon into `src/assets/icons/platforms/youtube.svg`
  - Extract the Kick SVG icon into `src/assets/icons/platforms/kick.svg`
  - Create `packages/desktop/src/views/shared/utils/platform.ts` as a PURE TypeScript utility (no Vue imports, no Pinia):

    ```ts
    import type { Platform } from '@twirchat/shared/types'
    import TwitchIcon from '../../../assets/icons/platforms/twitch.svg?component'
    import YouTubeIcon from '../../../assets/icons/platforms/youtube.svg?component'
    import KickIcon from '../../../assets/icons/platforms/kick.svg?component'

    export function platformColor(platform: Platform): string { ... }
    export function platformIcon(platform: Platform) { ... } // returns the SVG component
    ```

  - Verify the utility compiles (no Vue imports, no Bun imports)
  - The overlay (`src/views/overlay/App.vue`) also needs `platformColor` — this utility must work without Pinia/Vue app context

  **Must NOT do**:
  - Do NOT make this a Vue composable (`use*` naming, `ref`, `reactive`, etc.)
  - Do NOT import from `electrobun`, `bun:*`, or `../../../store/`
  - Do NOT modify any existing component yet — this task is creation-only

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: File creation + pure TS utility, no complex logic
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `vue3-typescript-best-practices`: Not needed for a pure TS extraction task

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 (all need the shared utility or SVG files)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/ChatMessage.vue` — find the inline `<svg>` blocks for platform icons to extract
  - `packages/desktop/src/views/main/components/ChatList.vue` — find `platformColor()` / `platformIconSvg()` implementations to see the reference color values
  - `packages/desktop/src/views/overlay/App.vue` — also has a `platformColor()` duplicate that needs to import from the new utility

  **API/Type References**:
  - `packages/shared/types.ts` — `Platform` type definition (`'twitch' | 'youtube' | 'kick'`)

  **External References**:
  - `packages/desktop/vite.main.config.ts` — `svgLoader({ defaultImport: 'component' })` is already configured; SVG imports with `?component` suffix should work
  - `packages/desktop/src/views/main/env.d.ts` — SVG module declarations already added

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: Platform utility exports compile without errors
    Tool: Bash
    Preconditions: Task 1 files created
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert exit code 0 and no errors mentioning platform.ts
    Expected Result: Exit code 0
    Failure Indicators: Any TypeScript error in platform.ts or env.d.ts
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: SVG files exist and are valid XML
    Tool: Bash
    Preconditions: SVG files extracted
    Steps:
      1. Run: ls packages/desktop/src/assets/icons/platforms/
      2. Assert: twitch.svg, youtube.svg, kick.svg all present
      3. Run: head -1 packages/desktop/src/assets/icons/platforms/twitch.svg
      4. Assert: first line starts with <svg
    Expected Result: All 3 SVG files exist and have valid SVG root element
    Failure Indicators: Missing files, or file content is not SVG
    Evidence: .sisyphus/evidence/task-1-svg-files.txt

  Scenario: No Bun/Vue imports in platform.ts
    Tool: Bash
    Preconditions: platform.ts created
    Steps:
      1. Run: grep -n "bun:\|electrobun\|from 'vue'" packages/desktop/src/views/shared/utils/platform.ts
      2. Assert: output is empty (exit code 1 from grep = no matches = PASS)
    Expected Result: Zero forbidden imports
    Failure Indicators: Any line matching bun:/vue/electrobun
    Evidence: .sisyphus/evidence/task-1-no-bun-imports.txt
  ```

  **Evidence to Capture**:
  - [ ] task-1-typecheck.txt — vue-tsc output
  - [ ] task-1-svg-files.txt — ls output confirming files
  - [ ] task-1-no-bun-imports.txt — grep confirming no forbidden imports

  **Commit**: YES
  - Message: `refactor(desktop): extract platform SVGs and shared platform utility`
  - Files: `src/assets/icons/platforms/*.svg`, `src/views/shared/utils/platform.ts`

- [ ] 2. Register Pinia + scaffold 4 store skeletons (atomic commit)

  **What to do**:
  - In `packages/desktop/src/views/main/main.ts`: import `createPinia` from `'pinia'`, call `app.use(createPinia())` BEFORE `app.mount('#app')`
    ```ts
    import { createPinia } from 'pinia'
    // ...after createApp(App):
    app.use(createPinia())
    app.mount('#app')
    ```
  - Create `packages/desktop/src/views/main/stores/accounts.ts` — skeleton Pinia store:
    ```ts
    import { defineStore } from 'pinia'
    import type { Account } from '@twirchat/shared/types'
    export const useAccountsStore = defineStore('accounts', () => {
      const accounts = ref<Account[]>([])
      // load/refresh/remove stubs
      return { accounts }
    })
    ```
  - Create `packages/desktop/src/views/main/stores/settings.ts` — skeleton Pinia store for `AppSettings`
  - Create `packages/desktop/src/views/main/stores/channelStatus.ts` — skeleton Pinia store for channel live/offline status map
  - The existing `packages/desktop/src/views/main/stores/layout.ts` (custom singleton) is intentionally left as-is until Task 14

  **Must NOT do**:
  - Do NOT migrate layout store here — that is Task 14
  - Do NOT add `pinia-plugin-persistedstate`
  - Do NOT fill store implementations yet — only skeletons with correct types and stub actions
  - Do NOT remove `waitForSocket()` from main.ts

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Boilerplate scaffolding, well-defined structure, no complex logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 10, 11, 12 (components that consume Pinia stores)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/main.ts:64-68` — `createApp` + `app.mount()` location; insert `app.use(createPinia())` between them
  - `packages/desktop/src/views/main/stores/layout.ts` — existing store structure to understand what pattern is currently used (will become Pinia in Task 14)

  **API/Type References**:
  - `packages/shared/types.ts` — `Account`, `AppSettings`, `Platform` types
  - `packages/desktop/src/shared/rpc.ts` — RPC request types to understand what data the stores will eventually expose

  **External References**:
  - Pinia composable store API: `defineStore('id', () => { ... })` — setup store pattern (preferred over options API)

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: Pinia registers without errors
    Tool: Bash
    Preconditions: Task 2 complete
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0
      3. Assert: no errors mentioning pinia, stores/, or main.ts
    Expected Result: TypeScript compilation clean
    Failure Indicators: Any TS error about Pinia or store types
    Evidence: .sisyphus/evidence/task-2-typecheck.txt

  Scenario: All 3 new store files created
    Tool: Bash
    Preconditions: Task 2 complete
    Steps:
      1. Run: ls packages/desktop/src/views/main/stores/
      2. Assert: accounts.ts, settings.ts, channelStatus.ts all present (layout.ts already existed)
    Expected Result: 4 files total in stores/
    Evidence: .sisyphus/evidence/task-2-stores-ls.txt

  Scenario: main.ts contains createPinia registration
    Tool: Bash
    Preconditions: Task 2 complete
    Steps:
      1. Run: grep -n "createPinia\|app.use(pinia" packages/desktop/src/views/main/main.ts
      2. Assert: at least one match containing createPinia
    Expected Result: Pinia registration present in main.ts
    Evidence: .sisyphus/evidence/task-2-pinia-registered.txt
  ```

  **Evidence to Capture**:
  - [ ] task-2-typecheck.txt
  - [ ] task-2-stores-ls.txt
  - [ ] task-2-pinia-registered.txt

  **Commit**: YES (atomic with store files — all in one commit)
  - Message: `feat(desktop): register Pinia and scaffold store skeletons`
  - Files: `src/views/main/main.ts`, `src/views/main/stores/accounts.ts`, `src/views/main/stores/settings.ts`, `src/views/main/stores/channelStatus.ts`
  - Pre-commit: `vue-tsc --noEmit`

- [ ] 3. Create `useMessageParsing` composable

  **What to do**:
  - Create `packages/desktop/src/views/main/composables/useMessageParsing.ts`
  - Extract from `ChatMessage.vue` the following logic into the composable:
    - `parseMessageParts(message: NormalizedChatMessage)` — splits message text into segments (text, emote, mention, link)
    - `linkify(text: string): string` — wraps URLs in `<a>` tags (HTML-safe)
    - `escapeHtml(text: string): string` — escapes `<>&"'` characters
    - `mentionColorCache: Map<string, string>` — per-username color, persisted in closure
    - `fetchMentionColor(username: string): Promise<string>` — RPC call to get user badge/color
  - Composable signature:
    ```ts
    export function useMessageParsing() {
      return { parseMessageParts, linkify, escapeHtml, fetchMentionColor }
    }
    ```
  - Do NOT move the copy-button state (`copied`, `copyMessage`) here — leave in component

  **Must NOT do**:
  - Do NOT put this in `src/views/shared/` — it uses RPC (main-window-only)
  - Do NOT import from `bun:*`
  - Do NOT modify ChatMessage.vue yet — that is Task 8

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Logic extraction, pure TS functions + simple reactive state
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 4, 5, 6, 7 — all Wave 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Task 1 (needs `@twirchat/shared` types which are already available; technically no hard dependency on Task 1 output but for wave ordering run after Wave 1)

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/ChatMessage.vue` — full current implementation of message parsing logic to extract
  - `packages/shared/types.ts` — `NormalizedChatMessage`, `EmoteRange` type definitions

  **API/Type References**:
  - `packages/desktop/src/views/main/main.ts:23` — `export const rpc` — import pattern for RPC in composables

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: Composable file compiles cleanly
    Tool: Bash
    Preconditions: Task 3 complete
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0, no errors in composables/useMessageParsing.ts
    Expected Result: Clean compilation
    Evidence: .sisyphus/evidence/task-3-typecheck.txt

  Scenario: No Bun or store imports in composable
    Tool: Bash
    Preconditions: Task 3 complete
    Steps:
      1. Run: grep -n "bun:\|bun:sqlite\|from.*store/" packages/desktop/src/views/main/composables/useMessageParsing.ts
      2. Assert: no output (exit 1 from grep)
    Expected Result: Zero forbidden imports
    Evidence: .sisyphus/evidence/task-3-no-bun.txt
  ```

  **Evidence to Capture**:
  - [ ] task-3-typecheck.txt
  - [ ] task-3-no-bun.txt

  **Commit**: NO (group with T4, T5, T6 in one commit)

- [ ] 4. Create `usePolling` composable

  **What to do**:
  - Create `packages/desktop/src/views/main/composables/usePolling.ts`
  - Generic polling composable with `onUnmounted` cleanup and unmounted guard:

    ```ts
    export function usePolling(fn: () => Promise<void> | void, intervalMs: number) {
      let timer: ReturnType<typeof setInterval> | null = null
      let destroyed = false

      const start = () => {
        if (timer) return
        timer = setInterval(async () => {
          if (destroyed) return
          await fn()
        }, intervalMs)
      }

      const stop = () => {
        if (timer) {
          clearInterval(timer)
          timer = null
        }
      }

      onUnmounted(() => {
        destroyed = true
        stop()
      })

      return { start, stop }
    }
    ```

  - Do NOT start the polling automatically — let the component call `start()` in `onMounted`

  **Must NOT do**:
  - Do NOT auto-start (side effects in composable body = anti-pattern)
  - Do NOT import from `bun:*`
  - Do NOT use `setInterval` without `onUnmounted` cleanup

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, generic utility composable
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2, with Tasks 3, 5, 6, 7)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 9, 12
  - **Blocked By**: None after Wave 1

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/ChatList.vue` — find the current `setInterval` polling pattern to understand what the composable replaces
  - `packages/desktop/src/views/main/components/StreamEditor.vue` — second polling usage

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: Polling composable compiles and exports correctly
    Tool: Bash
    Preconditions: Task 4 complete
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0
    Expected Result: Clean compilation
    Evidence: .sisyphus/evidence/task-4-typecheck.txt

  Scenario: onUnmounted cleanup is present
    Tool: Bash
    Preconditions: Task 4 complete
    Steps:
      1. Run: grep -n "onUnmounted" packages/desktop/src/views/main/composables/usePolling.ts
      2. Assert: at least one match
    Expected Result: Cleanup registered
    Evidence: .sisyphus/evidence/task-4-cleanup.txt
  ```

  **Evidence to Capture**:
  - [ ] task-4-typecheck.txt
  - [ ] task-4-cleanup.txt

  **Commit**: NO (group with T3, T5, T6)

- [ ] 5. Create `useChatScroll` composable

  **What to do**:
  - Create `packages/desktop/src/views/main/composables/useChatScroll.ts`
  - Encapsulates scroll-to-bottom lock logic from `ChatList.vue`:

    ```ts
    export function useChatScroll(containerRef: Ref<HTMLElement | null>) {
      const isAtBottom = ref(true)

      const onScroll = () => {
        if (!containerRef.value) return
        const el = containerRef.value
        isAtBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 50
      }

      const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
        if (!containerRef.value) return
        containerRef.value.scrollTop = containerRef.value.scrollHeight
      }

      return { isAtBottom, onScroll, scrollToBottom }
    }
    ```

  - The 50px threshold for "at bottom" detection comes from the existing `ChatList.vue` — match it exactly

  **Must NOT do**:
  - Do NOT add auto-scroll behavior in the composable body — let component decide when to call `scrollToBottom()`
  - Do NOT import from `bun:*`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Parallel Group**: Wave 2 (with Tasks 3, 4, 6, 7)
  - **Blocks**: Task 9
  - **Blocked By**: None after Wave 1

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/ChatList.vue` — find `isAtBottom`, scroll event handler, `scrollToBottom` — extract exactly this logic

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: useChatScroll compiles cleanly
    Tool: Bash
    Preconditions: Task 5 complete
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0
    Expected Result: Clean compilation
    Evidence: .sisyphus/evidence/task-5-typecheck.txt
  ```

  **Evidence to Capture**:
  - [ ] task-5-typecheck.txt

  **Commit**: NO (group with T3, T4, T6)

- [ ] 6. Create `useRpcListener` composable

  **What to do**:
  - Create `packages/desktop/src/views/main/composables/useRpcListener.ts`
  - The `rpc` object DOES have both `addMessageListener` and `removeMessageListener` — use them:

    ```ts
    import { onBeforeUnmount } from 'vue'
    import { rpc } from '../main'
    import type { TwirChatRPCSchema } from '../../shared/rpc'

    type WebviewMessages = TwirChatRPCSchema['webview']['messages']

    export function useRpcListener<K extends keyof WebviewMessages>(
      event: K,
      handler: (payload: WebviewMessages[K]) => void,
    ) {
      rpc.addMessageListener(event, handler)
      onBeforeUnmount(() => {
        rpc.removeMessageListener(event, handler)
      })
    }
    ```

  - This wraps the existing `addMessageListener`/`removeMessageListener` API in Vue lifecycle
  - Import `rpc` from `'../main'`
  - Extract `WebviewMessages` locally via `TwirChatRPCSchema['webview']['messages']` — it is NOT directly exported from rpc.ts

  **Must NOT do**:
  - Do NOT use `rpc.on[event]` — the actual API is `rpc.addMessageListener`/`rpc.removeMessageListener`
  - Do NOT import `WebviewMessages` directly (it's not exported) — use the type extraction pattern above
  - Do NOT import from `bun:*` or `electrobun/bun`
  - Do NOT modify any component yet — Task 10 will use this

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 10, Task 11
  - **Blocked By**: None after Wave 1

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/App.vue:345-362` — existing `rpc.addMessageListener` / `rpc.removeMessageListener` usage pattern to wrap
  - `packages/desktop/src/views/main/main.ts:23` — `export const rpc` (import source)

  **API/Type References**:
  - `packages/desktop/src/shared/rpc.ts:201` — `TwirChatRPCSchema` export (use `TwirChatRPCSchema['webview']['messages']` to get message payload types)
  - `packages/desktop/src/shared/rpc.ts:176` — `WebviewMessages` type definition (NOT exported — must extract via schema)

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: useRpcListener compiles cleanly
    Tool: Bash
    Preconditions: Task 6 complete
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0, no errors in useRpcListener.ts
    Expected Result: Clean compilation
    Evidence: .sisyphus/evidence/task-6-typecheck.txt

  Scenario: No Bun imports in composable
    Tool: Bash
    Preconditions: Task 6 complete
    Steps:
      1. Run: grep -n "bun:\|electrobun/bun" packages/desktop/src/views/main/composables/useRpcListener.ts
      2. Assert: no output
    Expected Result: No forbidden imports
    Evidence: .sisyphus/evidence/task-6-no-bun.txt
  ```

  **Evidence to Capture**:
  - [ ] task-6-typecheck.txt
  - [ ] task-6-no-bun.txt

  **Commit**: YES (with T3, T4, T5 — all composables in one commit)
  - Message: `feat(desktop/composables): add useMessageParsing, usePolling, useChatScroll, useRpcListener`
  - Files: `src/views/main/composables/*.ts`
  - Pre-commit: `vue-tsc --noEmit`

- [ ] 7. Refactor `overlay/App.vue` (import shared platform utility — NO SVG icons)

  **What to do**:
  - The overlay at `packages/desktop/src/views/overlay/App.vue` renders platform as a colored dot only:
    ```html
    <span class="platform-dot" :style="{ background: platformColor(dm.msg.platform) }"></span>
    ```
  - There are NO platform icon SVGs in the overlay — just a `platformColor()` local function duplicate
  - Task: ONLY replace the local `platformColor()` function with an import:
    ```ts
    import { platformColor } from '../shared/utils/platform'
    ```
  - Remove the local `platformColor()` function definition (lines 135–155 approx)
  - The `.platform-dot` rendering stays exactly as-is

  **Must NOT do**:
  - Do NOT import `TwitchIcon`, `YouTubeIcon`, or `KickIcon` — overlay has no platform icons, only a dot
  - Do NOT add Pinia to the overlay
  - Do NOT import from `electrobun/view` or `rpc`
  - Do NOT add `createPinia()` to `src/views/overlay/main.ts`
  - Do NOT touch WebSocket logic, dot rendering, animations, or any other overlay logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2, parallel with T3–T6)
  - **Blocked By**: Task 1 (needs shared platform utility)
  - **Blocks**: Nothing

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/overlay/App.vue:135` — local `platformColor` function to remove
  - `packages/desktop/src/views/shared/utils/platform.ts` (Task 1 output) — import source

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: Overlay compiles cleanly
    Tool: Bash
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0
    Expected Result: Clean compilation
    Evidence: .sisyphus/evidence/task-7-typecheck.txt

  Scenario: No duplicate platformColor in overlay
    Tool: Bash
    Steps:
      1. Run: grep -n "function platformColor\|const platformColor" packages/desktop/src/views/overlay/App.vue
      2. Assert: no output
    Expected Result: No local definition (imported from shared utility)
    Evidence: .sisyphus/evidence/task-7-no-dup.txt

  Scenario: platformColor imported from shared utility in overlay
    Tool: Bash
    Steps:
      1. Run: grep -n "from.*shared/utils/platform" packages/desktop/src/views/overlay/App.vue
      2. Assert: at least one match containing platformColor
    Expected Result: Import from shared utility present
    Evidence: .sisyphus/evidence/task-7-import.txt
  ```

  **Evidence to Capture**:
  - [ ] task-7-typecheck.txt
  - [ ] task-7-no-dup.txt
  - [ ] task-7-import.txt

  **Commit**: YES
  - Message: `refactor(overlay): import platformColor from shared platform utility`
  - Files: `src/views/overlay/App.vue`
  - Pre-commit: `vue-tsc --noEmit`

- [ ] 8. Refactor `ChatMessage.vue` (useMessageParsing + SVG icons)

  **What to do**:
  - In `packages/desktop/src/views/main/components/ChatMessage.vue`:
    - Replace local message parsing logic with `useMessageParsing()` composable
    - Import platform SVG components from `../../../assets/icons/platforms/`
    - Replace inline `<svg>` platform icons with `<TwitchIcon />` / `<YouTubeIcon />` / `<KickIcon />`
    - Import `platformColor` from `'../../shared/utils/platform'` — remove any local def
    - Keep copy-button state (`copied`, `copyMessage`) in the component
    - Keep emote tooltip interaction in the component

  **Must NOT do**:
  - Do NOT add Pinia store usage (ChatMessage has no persistent state)
  - Do NOT extract copy button logic to a composable
  - Do NOT change the rendered HTML structure or CSS class names

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Medium complexity — reading existing component carefully, extracting cleanly
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3 with Tasks 9–13)
  - **Blocked By**: Task 3 (useMessageParsing) + Task 1 (SVG files + platform utility)
  - **Blocks**: Nothing (leaf refactor)

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/ChatMessage.vue` — read entire file first
  - `packages/desktop/src/views/main/composables/useMessageParsing.ts` (Task 3) — composable to use
  - `packages/desktop/src/views/shared/utils/platform.ts` (Task 1) — platformColor import

  **API/Type References**:
  - `packages/shared/types.ts` — `NormalizedChatMessage`, `EmoteRange`

  **QA Scenarios**:

  ```
  Scenario: ChatMessage.vue compiles cleanly
    Tool: Bash
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0, no errors mentioning ChatMessage.vue
    Expected Result: Clean compilation
    Evidence: .sisyphus/evidence/task-8-typecheck.txt

  Scenario: No inline SVG platform icons in ChatMessage.vue (v-html platformIconSvg removed)
    Tool: Bash
    Steps:
      1. Run: grep -c "platformIconSvg\|v-html.*platform.*icon" packages/desktop/src/views/main/components/ChatMessage.vue
      2. Assert: output is "0"
    Expected Result: platformIconSvg() calls replaced by SVG component imports
    Evidence: .sisyphus/evidence/task-8-no-platform-svg.txt
    Note: Non-platform UI icons (copy, reply SVGs) may remain inline — ONLY platform icons must be replaced

  Scenario: No local platformColor definition
    Tool: Bash
    Steps:
      1. Run: grep -n "function platformColor\|const platformColor" packages/desktop/src/views/main/components/ChatMessage.vue
      2. Assert: no output
    Expected Result: Imported, not defined locally
    Evidence: .sisyphus/evidence/task-8-no-dup.txt
  ```

  **Evidence to Capture**:
  - [ ] task-8-typecheck.txt, task-8-no-platform-svg.txt, task-8-no-dup.txt

  **Commit**: NO (group with T9–T13)

- [ ] 9. Refactor `ChatList.vue` (usePolling + useChatScroll + SVG)

  **What to do**:
  - In `packages/desktop/src/views/main/components/ChatList.vue`:
    - Replace `setInterval` channel status polling with `usePolling(fn, interval)`; call `start()` in `onMounted`
    - Replace scroll state + handlers with `useChatScroll(containerRef)`
    - Import platform SVG components; replace inline `<svg>` elements
    - Import `platformColor` from `'../../shared/utils/platform'`; remove local def
    - Keep channel data fetching logic in the component (not yet in a store — that's channelStatus store in Task 10)

  **Must NOT do**:
  - Do NOT introduce Pinia here — channel status Pinia store is wired in Task 10 (App.vue)
  - Do NOT move channel fetching logic out of ChatList yet
  - Do NOT change template structure

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3)
  - **Blocked By**: Tasks 4 (usePolling), 5 (useChatScroll), 1 (SVGs)
  - **Blocks**: Nothing

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/ChatList.vue` — read full file; find setInterval, scroll logic, inline SVGs
  - `packages/desktop/src/views/main/composables/usePolling.ts` (Task 4)
  - `packages/desktop/src/views/main/composables/useChatScroll.ts` (Task 5)

  **QA Scenarios**:

  ```
  Scenario: ChatList.vue compiles cleanly
    Tool: Bash
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0
    Expected Result: Clean compilation
    Evidence: .sisyphus/evidence/task-9-typecheck.txt

  Scenario: No setInterval in ChatList.vue
    Tool: Bash
    Steps:
      1. Run: grep -n "setInterval" packages/desktop/src/views/main/components/ChatList.vue
      2. Assert: no output (now uses usePolling)
    Expected Result: setInterval removed from component
    Evidence: .sisyphus/evidence/task-9-no-setinterval.txt

  Scenario: No local platformColor definition in ChatList.vue
    Tool: Bash
    Steps:
      1. Run: grep -n "function platformColor\|const platformColor" packages/desktop/src/views/main/components/ChatList.vue
      2. Assert: no output (import replaces local definition)
    Expected Result: platformColor imported from shared utility, not defined locally
    Evidence: .sisyphus/evidence/task-9-no-platform-dup.txt
    Note: Non-platform UI icons (empty-state SVG etc.) may remain inline — ONLY platformColor local def must be removed
  ```

  **Evidence to Capture**:
  - [ ] task-9-typecheck.txt, task-9-no-setinterval.txt, task-9-no-platform-dup.txt

  **Commit**: NO (group with T8, T10–T13)

- [ ] 10. Refactor `App.vue` (Pinia stores + useRpcListener)

  **What to do**:
  - In `packages/desktop/src/views/main/App.vue`:
    - Import and initialize `useAccountsStore`, `useSettingsStore`, `useChannelStatusStore`
    - Move `rpc.on.*` message handlers to `useRpcListener()` calls (from Task 6)
    - Move initial data loading (accounts, settings) into store actions called in `onMounted`
    - Move global init logic (RPC listener registration, polling start) into composables/stores
    - Remove module-level reactive state that now belongs in Pinia stores
  - App.vue should become much leaner — mostly routing/layout orchestration

  **Must NOT do**:
  - Do NOT touch layout store here — Task 14
  - Do NOT remove `waitForSocket()` call in main.ts
  - Do NOT introduce any Bun imports

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3)
  - **Blocked By**: Tasks 2 (Pinia stores), 6 (useRpcListener), 1 (platform utility)
  - **Blocks**: Task 14 (layout migration depends on all Wave 3 work being done)

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/App.vue` — full file; map all `rpc.on.*` calls and reactive state
  - `packages/desktop/src/views/main/composables/useRpcListener.ts` (Task 6)
  - `packages/desktop/src/views/main/stores/accounts.ts` (Task 2 skeleton)
  - `packages/desktop/src/views/main/stores/settings.ts` (Task 2 skeleton)
  - `packages/desktop/src/views/main/stores/channelStatus.ts` (Task 2 skeleton)

  **API/Type References**:
  - `packages/desktop/src/shared/rpc.ts` — WebviewMessages type (message event names)

  **QA Scenarios**:

  ```
  Scenario: App.vue compiles cleanly
    Tool: Bash
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0
    Expected Result: Clean compilation
    Evidence: .sisyphus/evidence/task-10-typecheck.txt

  Scenario: Pinia stores imported in App.vue
    Tool: Bash
    Steps:
      1. Run: grep -n "useAccountsStore\|useSettingsStore\|useChannelStatusStore" packages/desktop/src/views/main/App.vue
      2. Assert: at least one match per store
    Expected Result: All 3 stores used in App.vue
    Evidence: .sisyphus/evidence/task-10-pinia-usage.txt
  ```

  **Evidence to Capture**:
  - [ ] task-10-typecheck.txt, task-10-pinia-usage.txt

  **Commit**: NO (group with T8, T9, T11–T13)

- [ ] 11. Refactor `PlatformsPanel.vue` (accounts Pinia store + SVG)

  **What to do**:
  - In `packages/desktop/src/views/main/components/PlatformsPanel.vue`:
    - Replace local accounts state with `useAccountsStore()` (from Task 2)
    - Move auth RPC listener logic to `useRpcListener()` (from Task 6) for auth success/failure messages
    - Replace inline `<svg>` platform icons with SVG component imports
    - Import `platformColor` from shared utility; remove local def
    - Keep toast-display logic inline (do NOT extract `useToast` — not in scope)

  **Must NOT do**:
  - Do NOT extract toast logic to a separate composable
  - Do NOT add any new composables beyond what was created in Wave 2
  - Do NOT change platform authentication RPC calls

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3)
  - **Blocked By**: Tasks 2 (accounts store), 6 (useRpcListener), 1 (SVGs)
  - **Blocks**: Nothing

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/PlatformsPanel.vue` — full file
  - `packages/desktop/src/views/main/stores/accounts.ts` (Task 2 skeleton) — store to fill out
  - `packages/desktop/src/views/main/composables/useRpcListener.ts` (Task 6)

  **QA Scenarios**:

  ```
  Scenario: PlatformsPanel.vue compiles cleanly
    Tool: Bash
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0
    Expected Result: Clean compilation
    Evidence: .sisyphus/evidence/task-11-typecheck.txt

  Scenario: accounts Pinia store is used in PlatformsPanel.vue
    Tool: Bash
    Steps:
      1. Run: grep -n "useAccountsStore" packages/desktop/src/views/main/components/PlatformsPanel.vue
      2. Assert: at least one match
    Expected Result: Pinia accounts store integrated in PlatformsPanel
    Evidence: .sisyphus/evidence/task-11-pinia-usage.txt
    Note: PlatformsPanel does not use platform icon SVGs or platformColor — only accounts store and useRpcListener are the key deliverables here
  ```

  **Evidence to Capture**:
  - [ ] task-11-typecheck.txt, task-11-pinia-usage.txt

  **Commit**: NO (group with T8–T10, T12–T13)

- [ ] 12. Refactor `StreamEditor.vue` (usePolling only)

  **What to do**:
  - In `packages/desktop/src/views/main/components/StreamEditor.vue`:
    - Replace the `setInterval` (line ~110-114) stream status polling with `usePolling(fn, interval)`; call `start()` in `onMounted`
    - `StreamEditor.vue` does NOT use `platformColor` or platform icon SVGs — no SVG work needed here
    - Keep category search debounce in the component (not generic enough for a composable)
    - Keep save flow (title/category RPC calls) in the component

  **Must NOT do**:
  - Do NOT use Pinia here (StreamEditor is self-contained per-channel state)
  - Do NOT extract save flow into a composable
  - Do NOT change the RPC calls to the backend
  - Do NOT remove existing UI icon SVGs (edit/save button icons) — they are not platform icons

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3)
  - **Blocked By**: Task 4 (usePolling)
  - **Blocks**: Nothing

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/StreamEditor.vue` — full file
  - `packages/desktop/src/views/main/composables/usePolling.ts` (Task 4)

  **QA Scenarios**:

  ```
  Scenario: StreamEditor.vue compiles cleanly
    Tool: Bash
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0
    Expected Result: Clean compilation
    Evidence: .sisyphus/evidence/task-12-typecheck.txt

  Scenario: No raw setInterval in StreamEditor.vue
    Tool: Bash
    Steps:
      1. Run: grep -n "setInterval" packages/desktop/src/views/main/components/StreamEditor.vue
      2. Assert: no output (replaced by usePolling)
    Expected Result: setInterval removed
    Evidence: .sisyphus/evidence/task-12-no-setinterval.txt
  ```

  **Evidence to Capture**:
  - [ ] task-12-typecheck.txt, task-12-no-setinterval.txt

  **Commit**: NO (group with T8–T11, T13)

- [ ] 13. Replace `platformColor`/`platformIconSvg` in 4 platform-aware components (no new composables)

  **What to do**:
  - Only these 4 components from the original "14" list actually use `platformColor` or platform-related patterns:
    - `ChatPanel.vue` — uses `platformColor` (3 occurrences)
    - `ChatInput.vue` — uses `platformColor` (3 occurrences)
    - `ChannelTabBar.vue` — uses `platformColor` (3 occurrences)
    - `EventsFeed.vue` — uses `platformColor`/platform display (4 occurrences)
  - For each of these 4 files:
    1. Import `platformColor` from `'../../shared/utils/platform'`
    2. Remove any local `platformColor` or `platformIconSvg` function/const definition
    3. If any use `platformIconSvg()` via `v-html`: import the SVG component instead (`TwitchIcon` etc.) and replace with `<TwitchIcon />`
  - The remaining 10 files from the original list (`AddChannelForm`, `AddChannelModal`, `DragOverlay`, `EmoteTooltip`, `LayoutToolbar`, `PanelNode`, `SettingsPanel`, `SplitNode`, `SplitViewToolbar`, `ui/ChatAppearancePopover`) do NOT use platformColor or platform icons — do NOT touch them

  **CRITICAL — Must NOT do**:
  - Do NOT touch the 10 non-platform components listed above
  - Do NOT add ANY new composables in this task
  - Do NOT add Pinia usage in this task
  - Do NOT touch `WatchedChannelsView.vue` — that is Task 14 ONLY
  - Do NOT remove non-platform UI SVGs (scroll, icons, buttons) — only platform icon SVGs are in scope
  - Do NOT change component logic, template structure, or CSS class names

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Only 4 files, mechanical platformColor import swap
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3, with T8–T12)
  - **Blocked By**: Task 1 (SVG files + platform utility)
  - **Blocks**: Task 14

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/ChatPanel.vue` — read before editing
  - `packages/desktop/src/views/main/components/ChatInput.vue` — read before editing
  - `packages/desktop/src/views/main/components/ChannelTabBar.vue` — read before editing
  - `packages/desktop/src/views/main/components/EventsFeed.vue` — read before editing
  - `packages/desktop/src/views/shared/utils/platform.ts` (Task 1) — import source
  - `packages/desktop/src/views/main/components/ChatMessage.vue` (after Task 8) — reference for correct import pattern

  **QA Scenarios**:

  ```
  Scenario: 4 target components compile cleanly
    Tool: Bash
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0, no errors in ChatPanel.vue, ChatInput.vue, ChannelTabBar.vue, EventsFeed.vue
    Expected Result: Clean compilation
    Evidence: .sisyphus/evidence/task-13-typecheck.txt

  Scenario: No duplicate platformColor definitions in the 4 components
    Tool: Bash
    Steps:
      1. Run: grep -rn "function platformColor\|const platformColor" packages/desktop/src/views/main/components/ChatPanel.vue packages/desktop/src/views/main/components/ChatInput.vue packages/desktop/src/views/main/components/ChannelTabBar.vue packages/desktop/src/views/main/components/EventsFeed.vue
      2. Assert: no output
    Expected Result: All import platformColor, none define it locally
    Evidence: .sisyphus/evidence/task-13-no-dup.txt

  Scenario: platformColor imported from shared utility in all 4 files
    Tool: Bash
    Steps:
      1. Run: grep -rn "from.*shared/utils/platform" packages/desktop/src/views/main/components/ChatPanel.vue packages/desktop/src/views/main/components/ChatInput.vue packages/desktop/src/views/main/components/ChannelTabBar.vue packages/desktop/src/views/main/components/EventsFeed.vue
      2. Assert: 4 matches (one per file)
    Expected Result: All 4 files import from shared utility
    Evidence: .sisyphus/evidence/task-13-imports.txt
  ```

  **Evidence to Capture**:
  - [ ] task-13-typecheck.txt, task-13-no-dup.txt, task-13-imports.txt

  **Commit**: YES (this + T8–T12 all at once)
  - Message: `refactor(desktop): migrate components to composables, Pinia, and SVG components`
  - Files: `src/views/main/components/ChatPanel.vue`, `ChatInput.vue`, `ChannelTabBar.vue`, `EventsFeed.vue` (+ T8/T9/T10/T11/T12 files)
  - Pre-commit: `vue-tsc --noEmit`

  ```

  **Evidence to Capture**:
  - [ ] task-13-typecheck.txt, task-13-no-svg.txt, task-13-no-dup.txt

  **Commit**: YES (this + T8–T12 all at once)
  - Message: `refactor(desktop): migrate components to composables, Pinia, and SVG components`
  - Files: `src/views/main/components/*.vue`, `src/views/main/components/ui/*.vue`
  - Pre-commit: `vue-tsc --noEmit`

  ```

- [ ] 14. Migrate `useLayoutStore` to Pinia (all consumers atomically)

  **What to do**:
  - FIRST: Run `lsp_find_references` on `useLayoutStore` in `stores/layout.ts` to find ALL consumers
  - Expected consumers: `WatchedChannelsView.vue`, `LayoutToolbar.vue`, `PanelNode.vue`, `SplitNode.vue`, `DragOverlay.vue` — verify the actual list
  - Rewrite `packages/desktop/src/views/main/stores/layout.ts` as a Pinia store:
    ```ts
    import { defineStore } from 'pinia'
    export const useLayoutStore = defineStore('layout', () => {
      // All existing state/computed/actions preserved exactly
      // Module-level vars (layout, currentTabId, etc.) become refs inside the function
      // debouncedSave timer becomes a local variable inside the function
      return { ... }
    })
    ```
  - Keep the exported function name `useLayoutStore` — consumers don't need updating if the signature matches
  - Verify ALL consumers work by running `vue-tsc --noEmit`
  - The layout tree mutation logic (`movePanel`, `dropPanel`, `splitPanel` etc.) must be preserved exactly — this is complex state management code, do NOT simplify or optimize it

  **Must NOT do**:
  - Do NOT use `$patch` with spread trick — use direct reactive mutation (already works with Pinia setup stores)
  - Do NOT add `pinia-plugin-persistedstate`
  - Do NOT touch `utils/layout-tree.ts` or `services/migration.ts`
  - Do NOT partially migrate — ALL consumers must work in ONE atomic commit
  - Do NOT touch `utils/layout-tree.test.ts`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex state with many mutations, must preserve exact behavior; risk of subtle reactivity regression
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO — must run AFTER all of Wave 3 completes
  - **Parallel Group**: Wave 4 (sequential)
  - **Blocked By**: Tasks 8, 9, 10, 11, 12, 13 (all Wave 3 must be done)
  - **Blocks**: F1–F4

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/stores/layout.ts` — entire current file (401 lines); understand EVERY exported function before rewriting
  - `packages/desktop/src/views/main/utils/layout-tree.ts` — layout tree helper (used by layout store)
  - `packages/desktop/src/views/main/stores/accounts.ts` (Task 2) — reference for Pinia setup store pattern

  **API/Type References**:
  - `packages/shared/types.ts` — `WatchedChannelsLayout`, `LayoutNode`, `PanelNode`, `SplitDirection`
  - `packages/desktop/src/views/main/main.ts:23` — `rpc` export (store uses it for persistence)

  **External References**:
  - Pinia setup store docs: module-level `ref`/`computed` → function-scoped, `saveTimeout` timer → local variable captured in closure

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: Layout store migration compiles cleanly
    Tool: Bash
    Steps:
      1. Run: cd packages/desktop && vue-tsc --noEmit 2>&1
      2. Assert: exit code 0, zero errors
    Expected Result: Clean compilation after Pinia migration
    Evidence: .sisyphus/evidence/task-14-typecheck.txt

  Scenario: WatchedChannelsView renders and layout persists
    Tool: Playwright
    Preconditions: App running via `cd packages/desktop && bun run dev` (starts Vite HMR on http://localhost:5173 + Electrobun). At least one watched channel tab must exist (added previously or via the + button). Navigate to http://localhost:5173 in Playwright.
    Steps:
      1. Navigate to http://localhost:5173 in Playwright
      2. Wait for selector `.tab-bar` to be visible (timeout: 15s)
      3. If there is a watched channel tab (any `.tab-wrapper .tab`), click it; if none exist, click `.tab.tab-add` (the + button), fill AddChannelForm, then click the new tab
      4. Wait for selector `.panel-node` to appear (timeout: 10s)
      5. Click button with class `.panel-add-btn` inside the first `.panel-node` (title="Split right")
      6. Assert: `.panel-node` count in DOM is ≥ 2
      7. Reload the page (playwright page.reload())
      8. Wait for selector `.panel-node` again
      9. Assert: `.panel-node` count matches the count from step 6 (layout persisted via RPC)
    Expected Result: Layout renders and persists via Pinia + RPC
    Failure Indicators: Console errors about "pinia" or "defineStore", blank screen, `.panel-node` count reset to 1 on reload
    Evidence: .sisyphus/evidence/task-14-layout-renders.png

  Scenario: Drag-drop panel reordering works
    Tool: Playwright
    Preconditions: App running (http://localhost:5173), WatchedChannelsView open with 2+ `.panel-node` elements visible
    Steps:
      1. Navigate to http://localhost:5173, click a watched channel tab in `.tab-bar`
      2. Wait for at least 2 `.panel-node` elements to appear
      3. Use Playwright dragTo: drag `.panel-node:first-child .panel-header` to `.panel-node:last-child .panel-header`
      4. Assert: the order of `.panel-node` elements changed (compare nth-child text before vs after)
      5. Assert: no browser console errors containing "pinia" or "reactive"
    Expected Result: Drag-drop works after Pinia migration
    Evidence: .sisyphus/evidence/task-14-drag-drop.png

  Scenario: stores/layout.ts uses defineStore (is now Pinia)
    Tool: Bash
    Steps:
      1. Run: grep -n "defineStore" packages/desktop/src/views/main/stores/layout.ts
      2. Assert: at least one match
    Expected Result: Pinia defineStore present
    Evidence: .sisyphus/evidence/task-14-is-pinia.txt
  ```

  **Evidence to Capture**:
  - [ ] task-14-typecheck.txt
  - [ ] task-14-layout-renders.png
  - [ ] task-14-drag-drop.png
  - [ ] task-14-is-pinia.txt

  **Commit**: YES
  - Message: `refactor(desktop): migrate layout store to Pinia`
  - Files: `src/views/main/stores/layout.ts` (and any consumer if signature changed)
  - Pre-commit: `vue-tsc --noEmit`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user.
> **Do NOT auto-proceed. Wait for user's explicit approval before marking work complete.**

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, grep). For each "Must NOT Have": grep codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run: (1) `cd packages/desktop && vue-tsc --noEmit`, (2) `cd /home/satont/Projects/twirchat && bun run lint`, (3) `cd /home/satont/Projects/twirchat && bun run format:check`. Note: `lint` and `format:check` scripts exist only at repo root, not in `packages/desktop`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log left in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
      Output: `TypeCheck [PASS/FAIL] | Lint [PASS/FAIL] | Format [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` + `playwright` skill
      Start from clean state. Start app via `cd packages/desktop && bun run dev`. Navigate to http://localhost:5173 in Playwright.

      **Scenario A — Platform icons render in main window:**
      Navigate to http://localhost:5173. Wait for `.chat-list` to appear. Assert DOM contains `<img>` or `<svg>` elements that are platform icon SVG components (NOT `v-html` raw SVG blobs). Check `ChatMessage.vue` renders platform icons as `<PlatformIcon />` component tree. Screenshot: `.sisyphus/evidence/final-qa/F3-platform-icons.png`.

      **Scenario B — Overlay shows platform color dot (no icon):**
      Navigate to http://localhost:45823 in a new Playwright tab. Assert DOM contains `.platform-dot` element with inline `background` style (the color). Assert NO `<img>` or SVG icon component is rendered for the platform. Screenshot: `.sisyphus/evidence/final-qa/F3-overlay-dot.png`.

      **Scenario C — Pinia stores initialise (deterministic Bash check):**
      Run: `grep -n "defineStore" packages/desktop/src/views/main/stores/accounts.ts packages/desktop/src/views/main/stores/settings.ts packages/desktop/src/views/main/stores/channelStatus.ts packages/desktop/src/views/main/stores/layout.ts`
      Assert: 4 matches (one per file). This verifies all 4 stores are Pinia stores without requiring OAuth. Save output: `.sisyphus/evidence/final-qa/F3-pinia-stores.txt`.

      **Scenario D — Layout drag-drop and persistence:**
      In Playwright at http://localhost:5173, click a watched channel tab (`.tab-wrapper .tab:first-child`). Drag `.panel-node:first-child .panel-header` to `.panel-node:last-child .panel-header`. Assert panels reorder. Reload page. Assert panel count unchanged. Screenshot: `.sisyphus/evidence/final-qa/F3-drag-drop.png`.

      **Scenario E — Chat scroll lock composable cleanup:**
      Open http://localhost:5173, navigate to chat tab. Scroll up in `.chat-list`. Assert new messages do NOT auto-scroll. Scroll to bottom. Assert auto-scroll resumes. Switch to another tab. Assert no console errors containing "Cannot set properties of undefined" or "removeEventListener". Screenshot: `.sisyphus/evidence/final-qa/F3-scroll-lock.png`.

      Save all screenshots to `.sisyphus/evidence/final-qa/`.
      Output: `Scenarios [5/5 pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
      For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Flag unaccounted changes.
      Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- T1: `refactor(desktop): extract platform SVGs and shared platform utility`
- T2: `feat(desktop): register Pinia and scaffold store skeletons` ← ATOMIC with store files
- T3–T6: `feat(desktop/composables): add useMessageParsing, usePolling, useChatScroll, useRpcListener`
- T7: `refactor(overlay): use shared platform utility and SVG components`
- T8–T13: `refactor(desktop): migrate components to composables, Pinia, and SVG components`
- T14: `refactor(desktop): migrate layout store to Pinia`

---

## Success Criteria

### Verification Commands

```bash
# Type check — run from packages/desktop
cd packages/desktop && vue-tsc --noEmit    # Expected: exit 0, 0 errors

# Lint and format — run from REPO ROOT (packages/desktop has no lint/format scripts)
cd /home/satont/Projects/twirchat && bun run lint          # Expected: exit 0
cd /home/satont/Projects/twirchat && bun run format:check  # Expected: exit 0

# No platformIconSvg() usage remains
grep -rn "platformIconSvg" packages/desktop/src/views/ --include="*.vue" --include="*.ts" | wc -l  # Expected: 0

# No duplicate platformColor/platformIconSvg FUNCTION DEFINITIONS (local defs banned, imports OK)
grep -rn "function platformColor\|const platformColor\|function platformIconSvg\|const platformIconSvg" packages/desktop/src/views/ --include="*.vue" --include="*.ts" | grep -v "shared/utils/platform.ts" | wc -l  # Expected: 0

# All consumers import platformColor from shared utility
grep -rn "from.*shared/utils/platform" packages/desktop/src/views/ --include="*.vue" --include="*.ts" | wc -l  # Expected: >= 9

# Pinia stores and composables exist
ls packages/desktop/src/views/main/stores/        # Expected: accounts.ts, settings.ts, channelStatus.ts, layout.ts
ls packages/desktop/src/views/main/composables/   # Expected: useMessageParsing.ts, usePolling.ts, useChatScroll.ts, useRpcListener.ts
```

### Final Checklist

- [ ] All "Must Have" deliverables present
- [ ] All "Must NOT Have" guardrails satisfied
- [ ] `vue-tsc --noEmit` (from `packages/desktop`) exits 0
- [ ] `bun run lint` (from repo root) exits 0
- [ ] Zero `platformIconSvg()` calls remain in `src/views/` (all replaced by SVG component imports)
- [ ] Zero duplicate local `platformColor`/`platformIconSvg` function definitions (imports OK)
- [ ] Non-platform UI SVGs in App.vue, StreamEditor.vue, PlatformsPanel.vue, ChatList.vue left intact (out of scope)
- [ ] `badge.imageUrl` v-html in ChatMessage.vue left intact (API-dynamic SVG, not hardcoded inline — out of scope)
- [ ] Pinia installed and all 4 stores working (accounts, settings, channelStatus, layout)
- [ ] Overlay imports `platformColor` from shared utility (colored dot — no platform icon SVGs in overlay)
