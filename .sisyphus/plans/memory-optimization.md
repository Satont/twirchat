# Desktop App Memory Optimization

## TL;DR

> **Quick Summary**: Fix confirmed memory bugs in platform adapters and Vue renderer, add virtual scrolling to the chat list, and provide honest baseline measurements to calibrate expectations about CEF's inherent memory footprint on Linux.
>
> **Deliverables**:
>
> - Baseline private RSS measurement recorded (`.sisyphus/evidence/memory-baseline.txt`)
> - YouTube adapter: reconnect timer stacking eliminated
> - Kick adapter: orphaned WebSocket on re-connect eliminated
> - Twitch adapter: double-connect guard added to `connectChatClient()`
> - `ChatMessage.vue`: unnecessary `reactive()` on `mentionColorCache` removed + size cap (≤2000 entries)
> - `App.vue`: O(n) array/Map allocation on every incoming message eliminated
> - `ChatList.vue`: per-instance polling timer replaced with shared composable
> - `ChatList.vue`: full DOM virtualization via `virtua` VList (renders only visible rows)
> - Post-fix private RSS measurement + CEF baseline explanation documented
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves + final
> **Critical Path**: Task 1 (baseline) → Tasks 2–4 (adapters) → Tasks 5–7 (renderer) → Task 8 (virtua) → F1–F4

---

## Context

### Original Request

User sees ~400MB RSS in `htop` on Linux with 1 platform + 1 channel active, stable from startup (~1 min). Electrobun promises low memory, 400MB feels alarming.

### Interview Summary

**Key Discussions**:

- **Measurement**: `htop` RES column on Linux — includes shared library pages (CEF/Chromium Embedded Framework, libc, etc.) charged to the process but physically shared with other apps
- **Profile**: Stable at startup, not growing — rules out runaway leak; points to high baseline + fixable bugs
- **Scale**: 1 platform, 1 channel — no multi-platform amplification

**Research Findings**:

- **CEF baseline**: On Linux, the desktop app uses CEF (Chromium Embedded Framework), configured in `packages/desktop/electrobun.config.ts` (`bundleCEF: true`, `defaultRenderer: 'cef'`). CEF contributes ~150–300MB to htop RES as shared Chromium pages. These are **not reducible** without changing the rendering engine. The actual private app memory is measured via `/proc/$PID/smaps` (USS: `Private_Clean + Private_Dirty`)
- **Real bugs found**: 6 confirmed issues in adapters and Vue renderer (see tasks)
- **Misdiagnosis corrected**: `mentionColorCache` in `ChatMessage.vue` is already module-scoped (not per-instance); the real problems are unnecessary `reactive()` wrapper overhead and unbounded Map growth

### Metis Review

**Identified Gaps (addressed)**:

- Bug #1 diagnosis was wrong — `mentionColorCache` IS module-scoped; corrected framing in Task 5
- `TwitchAdapter.badgeRefreshInterval` is already handled by `clearTimers()` — removed from plan
- Task 0 (baseline measurement) was missing — added as mandatory first task
- `watchedMessages` Map clone in `App.vue` was missed — added to Task 6
- `virtua` reverse vs. template `reverse()` conflict — resolved: use `virtua`'s `reverse` prop, remove template `.reverse()`
- Unbounded `mentionColorCache` growth (not just `reactive()` overhead) — addressed in Task 5

---

## Work Objectives

### Core Objective

Fix confirmed memory bugs and excessive allocations. Provide a measured before/after comparison. Calibrate user expectations about CEF's (Chromium Embedded Framework) inherent shared-memory footprint on Linux.

### Concrete Deliverables

- `.sisyphus/evidence/memory-baseline.txt` — pre-fix private RSS
- `.sisyphus/evidence/memory-after.txt` — post-fix private RSS
- `packages/desktop/src/platforms/youtube/adapter.ts` — reconnect timer fix
- `packages/desktop/src/platforms/kick/adapter.ts` — WebSocket teardown fix
- `packages/desktop/src/platforms/twitch/adapter.ts` — double-connect guard
- `packages/desktop/src/views/main/components/ChatMessage.vue` — cache optimization
- `packages/desktop/src/views/main/App.vue` — buffer allocation optimization
- `packages/desktop/src/views/main/composables/useChannelStatuses.ts` — new shared polling composable
- `packages/desktop/src/views/main/components/ChatList.vue` — virtua integration + polling composable usage

### Definition of Done

- [ ] `bun run check` passes (typecheck + lint + format)
- [ ] `bun test tests/` passes (all existing tests green)
- [ ] USS (private RSS) measured before and after — delta documented
- [ ] Chat renders correctly: badges, emotes, mentions, auto-scroll
- [ ] All QA scenarios in tasks pass with captured evidence

### Must Have

- Baseline private RSS measured BEFORE any code changes
- All 6 confirmed bugs fixed
- `virtua` used for virtual scrolling (specifically, not `vue-virtual-scroller` or `@tanstack/virtual`)
- Auto-scroll behavior preserved after virtua integration
- Final measurement documents CEF shared-page explanation

### Must NOT Have (Guardrails)

- DO NOT migrate `messages` or `watchedMessages` to Pinia — in-place mutation is sufficient
- DO NOT add virtual scrolling to watched-channels view — only `ChatList.vue`
- DO NOT add `@vue/test-utils` or a component test harness
- DO NOT introduce LRU cache library — simple `.size > 2000 → .clear()` is sufficient
- DO NOT fix `TwitchAdapter.badgeRefreshInterval` — already correctly implemented via `clearTimers()`
- DO NOT refactor `base-adapter.ts` or the watched-channels manager architecture
- DO NOT use `vue-virtual-scroller` — has known issues with variable heights and bottom-anchored scroll
- DO NOT add new lint exceptions or `@ts-ignore` anywhere

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES (`bun test tests/`)
- **Automated tests**: None new (existing tests must stay green)
- **Framework**: `bun test`
- **Rationale**: These are bug fixes and perf optimizations; existing tests verify correctness. No component DOM test harness exists.

### QA Policy

Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/`.

- **Measurement tasks**: Bash — `/proc/$PID/smaps` + `grep VmRSS /proc/$PID/status`
- **Adapter fixes**: Bash (bun script) — instantiate adapter, trigger reconnect paths, verify single active connection
- **Vue renderer fixes**: Playwright — open app, send messages, verify DOM node counts + scroll behavior
- **Virtua integration**: Playwright — verify visible node count < 30, verify auto-scroll behavior

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 0 (Sequential — must complete before any code changes):
└── Task 1: Measure baseline private RSS [quick]

Wave 1 (After Task 1 — all parallel, independent files):
├── Task 2: Fix YouTube adapter reconnect timer stacking [quick]
├── Task 3: Fix Kick adapter WebSocket teardown on re-connect [quick]
└── Task 4: Fix Twitch adapter double-connect guard [quick]

Wave 2 (After Wave 1 — all parallel, independent concerns):
├── Task 5: ChatMessage.vue — remove reactive(), add cache size cap [quick]
├── Task 6: App.vue — eliminate O(n) array/Map allocations [quick]
└── Task 7: ChatList.vue — shared polling composable [unspecified-high]

Wave 3 (After Wave 2 — ChatList virtua integration):
└── Task 8: ChatList.vue — integrate virtua VList, remove template reverse() [unspecified-high]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── F1: Plan compliance audit [oracle]
├── F2: Code quality review [unspecified-high]
├── F3: Real manual QA [unspecified-high + playwright skill]
└── F4: Post-fix measurement + CEF baseline documentation [quick]
→ Present consolidated results → Get explicit user okay
```

### Dependency Matrix

| Task  | Depends On | Blocks                                      |
| ----- | ---------- | ------------------------------------------- |
| 1     | —          | 2, 3, 4 (code changes start after baseline) |
| 2     | 1          | F1–F4                                       |
| 3     | 1          | F1–F4                                       |
| 4     | 1          | F1–F4                                       |
| 5     | 1          | 8                                           |
| 6     | 1          | 8                                           |
| 7     | 1          | 8                                           |
| 8     | 5, 6, 7    | F1–F4                                       |
| F1–F4 | 2, 3, 4, 8 | —                                           |

### Agent Dispatch Summary

- **Wave 0**: Task 1 → `quick`
- **Wave 1**: Task 2 → `quick`, Task 3 → `quick`, Task 4 → `quick`
- **Wave 2**: Task 5 → `quick`, Task 6 → `quick`, Task 7 → `unspecified-high`
- **Wave 3**: Task 8 → `unspecified-high`
- **FINAL**: F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high` + `playwright` skill, F4 → `quick`

---

## TODOs

- [ ] 1. Measure baseline private RSS before any code changes

  **What to do**:
  - Start the desktop app with BOTH Vite and Electrobun running in parallel:
    ```bash
    bun run --cwd packages/desktop dev
    ```
    This runs `bun run --parallel hmr start` which spawns Vite (port 5173) AND `bun src/bun/index.ts` (which sets `process.title = 'TwirChat'`) simultaneously. Wait for both to be ready (~15 seconds).
  - Take **two measurements** to cover both idle and loaded states:
    1. **Idle measurement** (after app starts, before any messages): wait 30 seconds
    2. **Loaded measurement** (after injecting 150 messages via seed script): run `bun packages/desktop/tests/fixtures/seed-chat.ts` then wait 30 more seconds
  - IMPORTANT: The seed script (`tests/fixtures/seed-chat.ts`) does NOT exist yet in this task — this task only creates the **idle** baseline. The full 2-part measurement is finalized in F4. For this task, capture the **idle** baseline only.
  - Run the measurement commands below and save output to `.sisyphus/evidence/memory-baseline.txt`

  **Must NOT do**:
  - Do NOT modify any source files in this task
  - Do NOT start any code changes before this task is complete and baseline is recorded
  - Do NOT use `bun run --cwd packages/desktop start` — this runs `electrobun dev` without Vite, which leaves the main window blank

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single bash script execution, zero code changes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 0 — must complete before any code changes
  - **Blocks**: All tasks 2–8 (code changes must not start until baseline is captured)
  - **Blocked By**: None (can start immediately)

  **References**:
  - `packages/desktop/src/bun/index.ts` — sets `process.title = 'TwirChat'`; spawned as part of `dev` script
  - `packages/desktop/package.json` — `"dev": "bun run --parallel hmr start"`, `"hmr:main": "vite --config vite.main.config.ts --port 5173"`, `"start": "bun src/bun/index.ts"`

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Record baseline idle private RSS
    Tool: Bash
    Preconditions: App started via 'bun run --cwd packages/desktop dev', both Vite and bun process running, 30+ seconds elapsed
    Steps:
      1. PID=$(pgrep TwirChat)
         # Fallback if empty: PID=$(pgrep -f "src/bun/index.ts" | tr '\n' ' ' | awk '{print $1}')
      2. echo "=== Date: $(date) ===" > .sisyphus/evidence/memory-baseline.txt
      3. echo "=== htop RES (VmRSS) ===" >> .sisyphus/evidence/memory-baseline.txt
      4. grep VmRSS /proc/$PID/status >> .sisyphus/evidence/memory-baseline.txt
      5. echo "=== Idle Private RSS (USS = Private_Clean + Private_Dirty) ===" >> .sisyphus/evidence/memory-baseline.txt
      6. awk '/Private_Clean|Private_Dirty/{sum+=$2} END{print "USS:", sum/1024, "MB"}' /proc/$PID/smaps >> .sisyphus/evidence/memory-baseline.txt
      7. cat .sisyphus/evidence/memory-baseline.txt
    Expected Result: File has VmRSS line (e.g. "VmRSS: 400000 kB") and USS line (e.g. "USS: 95 MB")
    Failure Indicators: PID not found (app not running), smaps unreadable
    Evidence: .sisyphus/evidence/memory-baseline.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/memory-baseline.txt` — must contain VmRSS and USS values (idle baseline)

  **Commit**: NO — no code changes in this task

- [ ] 2. Fix YouTube adapter reconnect timer stacking

  **What to do**:
  - File: `packages/desktop/src/platforms/youtube/adapter.ts`
  - In `scheduleReconnect()`: add `if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null }` BEFORE the line `this.reconnectTimeout = setTimeout(...)`
  - This ensures that if `scheduleReconnect()` is called multiple times in quick succession (both `error` and `end` events firing, or rapid failures), only ONE timer is pending at a time
  - Run `bun run fix` from the **monorepo root** (`/home/satont/Projects/twirchat`) after the change

  **Must NOT do**:
  - Do NOT refactor the broader reconnect logic or `tryConnect()` method
  - Do NOT change reconnect delay math or `reconnectAttempts` logic
  - Do NOT touch any other methods in the file

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file, 2-line surgical fix
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 3 and 4)
  - **Blocks**: F1–F4
  - **Blocked By**: Task 1 (baseline must be recorded first)

  **References**:

  **Pattern References**:
  - `packages/desktop/src/platforms/youtube/adapter.ts` — look for `scheduleReconnect()` method; find the `this.reconnectTimeout = setTimeout(...)` line and add the clearTimeout guard immediately before it
  - Look for `this.reconnectTimeout` field — it's already typed (likely `ReturnType<typeof setTimeout> | null`)

  **Acceptance Criteria**:
  - [ ] `bun run check` passes (from monorepo root) and `bun run --cwd packages/desktop typecheck` passes

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: scheduleReconnect called twice does not stack timers
    Tool: Bash (bun eval)
    Preconditions: YouTube adapter class importable
    Steps:
      1. In packages/desktop: bun -e "
           const { YouTubeAdapter } = await import('./src/platforms/youtube/adapter.ts');
           const a = new YouTubeAdapter();
           a['shouldReconnect'] = true;
           a['scheduleReconnect']();
           const t1 = a['reconnectTimeout'];
           a['scheduleReconnect']();
           const t2 = a['reconnectTimeout'];
           console.log('timers differ:', t1 !== t2);
           console.log('t1 cleared:', t1 !== null);
           clearTimeout(t2);
         "
      2. Assert output: 'timers differ: true' (new timer replaced old)
    Expected Result: Only 1 timeout pending; old one cleared before new one set
    Failure Indicators: Two active timers, or timeout references are identical
    Evidence: .sisyphus/evidence/task-2-youtube-timer.txt

  Scenario: Rapid reconnect failures don't stack
    Tool: Bash
    Preconditions: Code change applied
    Steps:
      1. grep -n "clearTimeout\|reconnectTimeout" packages/desktop/src/platforms/youtube/adapter.ts
      2. Assert: clearTimeout line appears BEFORE the setTimeout line in scheduleReconnect()
    Expected Result: clearTimeout guard present in scheduleReconnect()
    Failure Indicators: No clearTimeout call in scheduleReconnect
    Evidence: .sisyphus/evidence/task-2-youtube-grep.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-2-youtube-grep.txt`

  **Commit**: YES
  - Message: `fix(youtube-adapter): clear reconnectTimeout before scheduling new one`
  - Files: `packages/desktop/src/platforms/youtube/adapter.ts`
  - Pre-commit: `bun run fix` (monorepo root) + `bun run --cwd packages/desktop typecheck`

- [ ] 3. Fix Kick adapter orphaned WebSocket on re-connect

  **What to do**:
  - File: `packages/desktop/src/platforms/kick/adapter.ts`
  - In `connectPusher()`: at the very beginning of the method body, BEFORE creating a new `WebSocket`, add:
    ```typescript
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    ```
  - This ensures calling `connect()` a second time (for a different channel or after an error) does not orphan the old Pusher WebSocket
  - Run `bun run fix` from the **monorepo root** after the change

  **Must NOT do**:
  - Do NOT touch the reconnect logic (`shouldReconnect`, `connectPusher` retry path)
  - Do NOT change event handlers or Pusher protocol logic
  - Do NOT touch any other methods

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file, 3-line surgical fix
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2 and 4)
  - **Blocks**: F1–F4
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `packages/desktop/src/platforms/kick/adapter.ts` — find `connectPusher()` method; find where `new WebSocket(wsUrl)` is called; add teardown immediately before it
  - `packages/desktop/src/platforms/youtube/adapter.ts` — check the `disconnect()` method for the teardown pattern to mirror

  **Acceptance Criteria**:
  - [ ] `bun run check` passes (monorepo root) and `bun run --cwd packages/desktop typecheck` passes

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: connectPusher tears down old WS before creating new one
    Tool: Bash
    Preconditions: Code change applied
    Steps:
      1. grep -n "this.ws.close\|this.ws = null\|new WebSocket" packages/desktop/src/platforms/kick/adapter.ts
      2. Assert: ws.close() and ws = null appear BEFORE new WebSocket() in connectPusher()
    Expected Result: teardown guard present before new WebSocket
    Failure Indicators: new WebSocket() appears before ws.close()
    Evidence: .sisyphus/evidence/task-3-kick-grep.txt

  Scenario: re-connect does not orphan old socket
    Tool: Bash (bun eval)
    Preconditions: KickAdapter importable
    Steps:
      1. bun -e "
           const { KickAdapter } = await import('./src/platforms/kick/adapter.ts');
           const a = new KickAdapter();
           // Manually set a fake closed WS to simulate prior connect
           const fakeWs = { close: () => console.log('old WS closed'), readyState: 1 };
           a['ws'] = fakeWs;
           // Verify teardown is invoked when connectPusher starts
           // (can't easily test without network, just verify the guard code path)
           console.log('ws before:', a['ws'] !== null);
         "
    Expected Result: Teardown code present; verified via grep
    Evidence: .sisyphus/evidence/task-3-kick-eval.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-3-kick-grep.txt`

  **Commit**: YES
  - Message: `fix(kick-adapter): close existing WebSocket before creating new connection`
  - Files: `packages/desktop/src/platforms/kick/adapter.ts`
  - Pre-commit: `bun run fix` (monorepo root) + `bun run --cwd packages/desktop typecheck`

- [ ] 4. Fix Twitch adapter double-connect guard in connectChatClient()

  **What to do**:
  - File: `packages/desktop/src/platforms/twitch/adapter.ts`
  - In `connectChatClient()` (or at the start of `connect()` before `connectChatClient()` is called): add a guard to quit and clear any existing `chatClient` before creating a new one:
    ```typescript
    if (this.chatClient) {
      try {
        await this.chatClient.quit()
      } catch {
        // ignore errors from already-closed client
      }
      this.chatClient = null
    }
    ```
  - Place this BEFORE `this.chatClient = new ChatClient({...})` inside `connectChatClient()`
  - This prevents two simultaneous Twurple `ChatClient` IRC connections when `connectChatClient()` is called while one is already active (possible in reconnect paths or if `connect()` called twice)
  - Run `bun run fix` from the **monorepo root** after the change

  **Must NOT do**:
  - Do NOT touch `clearTimers()` or `badgeRefreshInterval` — already correctly handled
  - Do NOT refactor event handler setup (`setupEventHandlers`)
  - Do NOT change `disconnect()` logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file, surgical fix, established pattern
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2 and 3)
  - **Blocks**: F1–F4
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `packages/desktop/src/platforms/twitch/adapter.ts` — find `connectChatClient()` and locate `this.chatClient = new ChatClient({...})`; insert the quit guard before it
  - Check the return type of `chatClient.quit()` — it may return a Promise; use `await`
  - `packages/desktop/src/platforms/kick/adapter.ts` (after Task 3) — similar teardown pattern

  **API References**:
  - Twurple `ChatClient.quit()` — gracefully closes the IRC connection. Returns Promise<void>. Safe to call even if client is in error state (wrap in try/catch).

  **Acceptance Criteria**:
  - [ ] `bun run check` passes (monorepo root) and `bun run --cwd packages/desktop typecheck` passes

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: connectChatClient guard prevents double-connect
    Tool: Bash
    Preconditions: Code change applied
    Steps:
      1. grep -n "chatClient.quit\|this.chatClient = null\|new ChatClient" packages/desktop/src/platforms/twitch/adapter.ts
      2. Assert: quit() and null assignment appear BEFORE new ChatClient() in connectChatClient()
    Expected Result: Guard present before new ChatClient instantiation
    Failure Indicators: new ChatClient() appears before quit guard
    Evidence: .sisyphus/evidence/task-4-twitch-grep.txt

  Scenario: Graceful handling when chatClient.quit() throws
    Tool: Bash
    Preconditions: Code change applied
    Steps:
      1. Verify try/catch wraps the quit() call:
         grep -A5 "chatClient.quit" packages/desktop/src/platforms/twitch/adapter.ts
      2. Assert: catch block is present (empty catch or logs are acceptable)
    Expected Result: try { await quit() } catch { } pattern visible
    Evidence: .sisyphus/evidence/task-4-twitch-trycatch.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-4-twitch-grep.txt`

  **Commit**: YES
  - Message: `fix(twitch-adapter): guard connectChatClient against double-connect`
  - Files: `packages/desktop/src/platforms/twitch/adapter.ts`
  - Pre-commit: `bun run fix` (monorepo root) + `bun run --cwd packages/desktop typecheck`

- [ ] 5. ChatMessage.vue — remove reactive() from mentionColorCache, add 2000-entry size cap

  **What to do**:
  - File: `packages/desktop/src/views/main/components/ChatMessage.vue`
  - Find the module-level declaration (at the top of `<script setup>`, outside any function/component):
    ```typescript
    const mentionColorCache = reactive(new Map<string, string | null>())
    ```
  - Change it to:
    ```typescript
    const mentionColorCache = new Map<string, string | null>()
    ```
  - In `fetchMentionColor()` (or wherever new entries are added to the cache), add a size guard BEFORE the `mentionColorCache.set(...)` call:
    ```typescript
    if (mentionColorCache.size > 2000) {
      mentionColorCache.clear()
    }
    ```
  - CRITICAL: After removing `reactive()`, verify that any template or computed that reads from `mentionColorCache` still re-renders correctly. If a computed property reads `mentionColorCache.get(key)` directly, it will no longer be reactive. In that case: the data for rendering mentions should come from the message props (which ARE reactive), not the cache directly. The cache is a lookup store; the rendered output should re-derive from message text when the component re-renders due to prop changes. If the template uses `mentionColorCache` in a `v-for` or interpolation, you must use a different approach (e.g., a `ref<Map>` that is replaced on cache update, or keep `reactive()` if removing it breaks rendering).
  - Run `bun run fix` from the **monorepo root** (`/home/satont/Projects/twirchat`) after the change

  **Must NOT do**:
  - Do NOT introduce an LRU cache library
  - Do NOT change the cache key format or lookup logic
  - Do NOT touch mention regex or `highlightMentions` logic beyond what's needed

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file, small change with one gotcha to verify
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6 and 7)
  - **Blocks**: Task 8 (virtua integration)
  - **Blocked By**: Task 1 (baseline first)

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/ChatMessage.vue` — find `mentionColorCache` declaration at module scope; find `fetchMentionColor` function; find all `.get(key)` usages in template or computed to assess reactivity impact

  **Acceptance Criteria**:
  - [ ] `bun run check` passes (monorepo root) and `bun run --cwd packages/desktop typecheck` passes
  - [ ] Mentions in chat messages still highlight with correct colors after the change

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: mentionColorCache no longer wrapped in reactive()
    Tool: Bash
    Preconditions: Code change applied
    Steps:
      1. grep -n "reactive.*mentionColorCache\|mentionColorCache.*reactive" packages/desktop/src/views/main/components/ChatMessage.vue
      2. Assert: no output (reactive() wrapper removed)
    Expected Result: mentionColorCache is a plain Map, not reactive
    Failure Indicators: grep finds a reactive() wrapper still present
    Evidence: .sisyphus/evidence/task-5-cache-grep.txt

  Scenario: Size cap exists in fetchMentionColor
    Tool: Bash
    Preconditions: Code change applied
    Steps:
      1. grep -n "mentionColorCache.size\|mentionColorCache.clear" packages/desktop/src/views/main/components/ChatMessage.vue
      2. Assert: both .size and .clear() present in same vicinity
    Expected Result: Size guard found
    Failure Indicators: No size guard present
    Evidence: .sisyphus/evidence/task-5-cap-grep.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-5-cache-grep.txt`
  - [ ] `.sisyphus/evidence/task-5-cap-grep.txt`

  **Commit**: YES
  - Message: `perf(chat-message): remove reactive() from mentionColorCache, add 2000-entry cap`
  - Files: `packages/desktop/src/views/main/components/ChatMessage.vue`
  - Pre-commit: `bun run fix` (monorepo root) + `bun run --cwd packages/desktop typecheck`

- [ ] 6. App.vue — eliminate O(n) array/Map allocations on every incoming message

  **What to do**:
  - File: `packages/desktop/src/views/main/App.vue`

  **Change 1 — `messages` buffer** (find the line):

  ```typescript
  messages.value = [msg, ...messages.value].slice(0, 500)
  ```

  Replace with in-place mutation (Vue 3 Proxy tracks array mutations):

  ```typescript
  messages.value.unshift(msg)
  if (messages.value.length > 500) messages.value.length = 500
  ```

  Note: messages are stored newest-first (prepended), so `unshift` is correct.

  **Change 2 — `events` buffer** (find similarly):

  ```typescript
  events.value = [ev, ...events.value].slice(0, 200)
  ```

  Replace with:

  ```typescript
  events.value.unshift(ev)
  if (events.value.length > 200) events.value.length = 200
  ```

  **Change 3 — `watchedMessages` Map** (find):

  ```typescript
  watchedMessages.value = new Map(watchedMessages.value).set(
    channelId,
    [message, ...prev].slice(0, 200),
  )
  ```

  Replace with (mutate the existing Map, then trigger reactivity explicitly):

  ```typescript
  const prev = watchedMessages.value.get(channelId) ?? []
  prev.unshift(message)
  if (prev.length > 200) prev.length = 200
  watchedMessages.value.set(channelId, prev)
  triggerRef(watchedMessages)
  ```

  Import `triggerRef` from `'vue'` if not already imported.
  - Run `bun run fix` from the **monorepo root** (`/home/satont/Projects/twirchat`) after all 3 changes

  **Must NOT do**:
  - Do NOT migrate `messages`, `events`, or `watchedMessages` to Pinia
  - Do NOT change the 500/200 message caps
  - Do NOT change the data shape of `NormalizedChatMessage` or `NormalizedEvent`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Three small in-place refactors in one file, clear pattern
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5 and 7)
  - **Blocks**: Task 8
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/App.vue` — search for `[msg, ...messages.value]`, `[ev, ...events.value]`, and `new Map(watchedMessages.value)` to find the exact change sites

  **API References**:
  - Vue 3 `triggerRef()` — forces reactive effect re-run for a `shallowRef` or when manually mutating a `ref`'s internal object. Import from `'vue'`.
  - Vue 3 array mutation tracking — `Array.prototype.unshift()`, `length` assignment are tracked by Vue's Proxy-based reactivity without needing array replacement.

  **Acceptance Criteria**:
  - [ ] `bun run check` passes (monorepo root) and `bun run --cwd packages/desktop typecheck` passes
  - [ ] Messages still appear in chat after the change
  - [ ] Messages cap still enforced at 500

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: No spread allocation in message handlers
    Tool: Bash
    Preconditions: Code change applied
    Steps:
      1. grep -n "\[msg,.*messages.value\]\|\[ev,.*events.value\]\|new Map(watchedMessages" packages/desktop/src/views/main/App.vue
      2. Assert: no output (old patterns removed)
    Expected Result: All 3 spread/clone patterns replaced
    Failure Indicators: Any of the 3 old patterns still present
    Evidence: .sisyphus/evidence/task-6-spread-grep.txt

  Scenario: triggerRef present for watchedMessages mutation
    Tool: Bash
    Steps:
      1. grep -n "triggerRef" packages/desktop/src/views/main/App.vue
      2. Assert: triggerRef(watchedMessages) present near the set() call
    Expected Result: triggerRef call found
    Evidence: .sisyphus/evidence/task-6-triggerref-grep.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-6-spread-grep.txt`
  - [ ] `.sisyphus/evidence/task-6-triggerref-grep.txt`

  **Commit**: YES
  - Message: `perf(app): eliminate O(n) spread allocation on every incoming message`
  - Files: `packages/desktop/src/views/main/App.vue`
  - Pre-commit: `bun run fix` (monorepo root) + `bun run --cwd packages/desktop typecheck`

- [ ] 7. ChatList.vue — extract channel-status polling to shared module-level composable

  **What to do**:
  - Create new file: `packages/desktop/src/views/main/composables/useChannelStatuses.ts`
  - This composable must be a **module-level singleton** — the polling interval and state are shared across all `ChatList` instances (e.g. split pane layout). Multiple calls to `useChannelStatuses()` return the same state, not new instances.

  Structure:

  ```typescript
  // Module-level singleton state (outside function, initialized once)
  import { ref, type Ref } from 'vue'

  // Define types to match what ChatList currently uses
  // (check ChatList.vue for the shape of channelStatuses)

  const channelStatuses = ref</* same type as ChatList's local channelStatuses */>([])
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let refCount = 0

  async function fetchChannelStatuses() {
    // move the exact fetch logic from ChatList.vue here
    // keep the same API call and response handling
  }

  export function useChannelStatuses() {
    refCount++

    if (!pollTimer) {
      void fetchChannelStatuses()
      pollTimer = setInterval(() => void fetchChannelStatuses(), 10_000)
    }

    // Cleanup: stop polling when all consumers unmounted
    onUnmounted(() => {
      refCount--
      if (refCount === 0 && pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    })

    return { channelStatuses }
  }
  ```

  - In `ChatList.vue`:
    - Remove the local `pollTimer`, `channelStatuses` ref, and the `onMounted`/`onUnmounted` polling setup
    - Import and call `useChannelStatuses()` to get `channelStatuses`
    - Everything else in ChatList.vue stays the same — `channelStatuses` is used the same way as before

  - Run `bun run fix` from the **monorepo root** (`/home/satont/Projects/twirchat`) after changes

  **Must NOT do**:
  - Do NOT use Pinia for this — module singleton is simpler and sufficient
  - Do NOT change the channel status fetch URL or response parsing
  - Do NOT touch any other composables or ChatList functionality beyond the polling extraction

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: New file creation + refactor across 2 files; need to correctly match existing types and API
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5 and 6)
  - **Blocks**: Task 8
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/ChatList.vue` — find the full `pollTimer`, `channelStatuses`, `fetchChannelStatuses`, `onMounted`, `onUnmounted` polling block to extract verbatim
  - `packages/desktop/src/views/main/composables/` — check if this directory already exists; if not, create it

  **API References**:
  - Vue 3 `onUnmounted()` — lifecycle hook, must be called inside `setup()` context (i.e. inside `useChannelStatuses()` function body, not at module level)

  **Acceptance Criteria**:
  - [ ] `packages/desktop/src/views/main/composables/useChannelStatuses.ts` exists
  - [ ] `ChatList.vue` no longer has a local `pollTimer` or `fetchChannelStatuses`
  - [ ] `bun run check` passes (monorepo root) and `bun run --cwd packages/desktop typecheck` passes

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Only 1 polling interval active with 2 ChatList instances
    Tool: Bash
    Preconditions: Code change applied
    Steps:
      1. grep -n "pollTimer\|setInterval\|fetchChannelStatuses" packages/desktop/src/views/main/components/ChatList.vue
      2. Assert: no output (polling code removed from ChatList)
    Expected Result: ChatList has no local polling
    Failure Indicators: pollTimer or setInterval found in ChatList.vue
    Evidence: .sisyphus/evidence/task-7-chatlist-grep.txt

  Scenario: Shared composable file exists and exports useChannelStatuses
    Tool: Bash
    Steps:
      1. cat packages/desktop/src/views/main/composables/useChannelStatuses.ts
      2. Assert: exports useChannelStatuses function
      3. Assert: module-level refCount or interval variable present (singleton guard)
    Expected Result: Composable file with singleton pattern
    Evidence: .sisyphus/evidence/task-7-composable.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-7-chatlist-grep.txt`
  - [ ] `.sisyphus/evidence/task-7-composable.txt`

  **Commit**: YES
  - Message: `refactor(chat-list): extract channel-status polling to shared composable`
  - Files: `packages/desktop/src/views/main/composables/useChannelStatuses.ts`, `packages/desktop/src/views/main/components/ChatList.vue`
  - Pre-commit: `bun run fix` (monorepo root) + `bun run --cwd packages/desktop typecheck`

- [ ] 8. ChatList.vue — integrate virtua VList for DOM virtualization

  **What to do**:

  **Step 1: Install virtua**

  ```bash
  cd packages/desktop && bun add virtua
  ```

  **Step 2: Replace the v-for render block in ChatList.vue**

  Find the current render block:

  ```vue
  <ChatMessage v-for="msg in [...activeMessages].reverse()" :key="msg.id" :message="msg" />
  ```

  (It may be wrapped in a container div/ul)

  Replace with virtua's `VList` component:

  ```vue
  <script setup lang="ts">
  import { VList } from 'virtua/vue'
  // ... other imports
  </script>

  <template>
    <!-- Replace the messages container with: -->
    <VList :data="activeMessages" :reverse="true" class="messages">
      <template #default="{ item }">
        <ChatMessage :key="item.id" :message="item" />
      </template>
    </VList>
  </template>
  ```

  **CRITICAL — resolve the reverse conflict**:
  - The old template does `[...activeMessages].reverse()` — oldest-last = newest-first array, rendered top-to-bottom = oldest at top, newest at bottom ✗... actually wait: `.reverse()` on the array makes newest-first in the v-for, but with no CSS inversion, that means newest messages appear at the TOP. Check if `ChatList.vue` has CSS like `flex-direction: column-reverse` or similar that makes it bottom-anchored.
  - Read the actual ChatList.vue CSS to understand the current rendering direction.
  - If the container uses `flex-direction: column-reverse`: items in DOM order are rendered bottom-up by CSS. The `.reverse()` in the template may be redundant or serving a specific purpose. Verify before removing.
  - The safest approach: pass `activeMessages` (in natural oldest-first order) to `VList` with `reverse={true}`. VList's `reverse` prop renders bottom-anchored, newest at bottom, auto-scrolls to bottom. This matches a typical chat UI.
  - Remove `[...activeMessages].reverse()` — pass `activeMessages` directly.
  - Adjust the container CSS: if the old container had `flex-direction: column-reverse` or `transform: scaleY(-1)` tricks, remove them — virtua handles this internally via the `reverse` prop.

  **Step 3: Verify scroll behavior**
  - virtua with `reverse={true}` auto-anchors scroll to the bottom when new items are added (newest messages appear at bottom, user can scroll up)
  - If the current ChatList has explicit `scrollTop` manipulation for auto-scroll, it may need to be removed or adapted — virtua handles auto-scroll automatically when `reverse={true}`

  **Step 4: Run `bun run fix` from monorepo root** + `bun run --cwd packages/desktop typecheck`

  **Step 5: Create a Playwright-testable test harness for virtua verification**

  `packages/desktop/src/views/main/main.ts` blocks Vue mounting until Electrobun's `bunSocket` is open, which never happens in a plain browser (Playwright). To allow Playwright-based verification of VList rendering without modifying production code:

  Create `packages/desktop/src/views/main/test-harness.html` and `packages/desktop/src/views/main/test-harness.ts` — a self-contained minimal Vue page that mounts ChatList directly with 200 seed messages, served by the Vite dev server on a separate URL. This does NOT require Electrobun RPC and does NOT need `waitForSocket`.

  ```html
  <!-- packages/desktop/src/views/main/test-harness.html -->
  <!doctype html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <title>Test Harness</title>
    </head>
    <body style="margin:0;height:100vh;display:flex;flex-direction:column">
      <div id="harness" style="flex:1;overflow:hidden"></div>
      <script type="module" src="./test-harness.ts"></script>
    </body>
  </html>
  ```

  ```typescript
  // packages/desktop/src/views/main/test-harness.ts
  import { createApp, ref } from 'vue'
  import { defineComponent, h } from 'vue'
  import ChatList from './components/ChatList.vue'
  import type { NormalizedChatMessage } from '../../../shared/types'

  // Import types from shared — read packages/shared/types.ts for exact field names
  // Generate 200 fake messages matching the real NormalizedChatMessage shape exactly
  const messages = ref<NormalizedChatMessage[]>(
    Array.from({ length: 200 }, (_, i) => ({
      id: `test-${i}`,
      platform: 'twitch' as const,
      channel: 'test',
      channelId: 'c1',
      username: `user${i}`,
      displayName: `User ${i}`,
      text: `Test message ${i}`,
      timestamp: Date.now() - i * 1000,
      badges: [],
      emotes: [],
      color: '#ff6b6b',
      // Add any other required fields from NormalizedChatMessage
    })),
  )

  const HarnessApp = defineComponent({
    setup() {
      return () =>
        h('div', { style: 'height:100vh;overflow:hidden' }, [
          h(ChatList, {
            messages: messages.value,
            accounts: [],
            statuses: [],
          }),
        ])
    },
  })

  createApp(HarnessApp).mount('#harness')
  ```

  The Vite dev server (`bun run --cwd packages/desktop dev`) automatically serves `.html` files at their path. This file will be available at `http://localhost:5173/test-harness.html`.

  **IMPORTANT**: Read `packages/shared/types.ts` and `ChatList.vue`'s props interface before writing test-harness.ts to get exact field names and prop names. Match them exactly or the page will have TypeScript errors.

  **Must NOT do**:
  - Do NOT use `vue-virtual-scroller` — use only `virtua`
  - Do NOT apply virtua to the watched-channels view or EventsFeed
  - Do NOT add `height` or `width` CSS constraints that break the existing layout — virtua works with the container's existing dimensions
  - Do NOT change the `NormalizedChatMessage` type or `ChatMessage.vue` component interface

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Significant UI change; scroll anchor behavior must be verified; library integration requires understanding of existing CSS layout
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 — sequential after Wave 2 (depends on clean ChatList from Task 7)
  - **Blocks**: F1–F4
  - **Blocked By**: Tasks 5, 6, 7

  **References**:

  **Pattern References**:
  - `packages/desktop/src/views/main/components/ChatList.vue` — read in full before changes: find the messages container, CSS classes, existing scroll logic, and the full v-for block
  - Check for `scrollTop`, `scrollHeight`, `scroll`, or `onScroll` usage in ChatList.vue — understand current auto-scroll mechanism before replacing

  **External References**:
  - virtua Vue 3 docs: https://github.com/inokawa/virtua — see `VList` API, `reverse` prop, `data` prop, slot syntax
  - `VList` reverse prop: renders items bottom-anchored; when `data` array grows, new items appear at bottom; scroll position anchored to bottom unless user scrolled up

  **Acceptance Criteria**:
  - [ ] `bun add virtua` completed, `virtua` in `packages/desktop/package.json` dependencies
  - [ ] `bun run check` passes (monorepo root) and `bun run --cwd packages/desktop typecheck` passes
  - [ ] No `[...activeMessages].reverse()` in ChatList.vue template

  **Message Injection for QA** (create once, reuse in F3):

  The renderer (`App.vue`) is populated via Electrobun RPC `chat_message` events dispatched from the Bun main process — NOT from the backend WebSocket. To inject messages in a test scenario without requiring real platform credentials:

  **Step A: Add a NEW dev-only `Bun.serve()` HTTP server in `packages/desktop/src/bun/index.ts`**

  `bun/index.ts` does NOT have any existing `Bun.serve()` call — it uses only Electrobun APIs (`BrowserWindow`, `defineElectrobunRPC`). You must CREATE a brand-new `Bun.serve()` block, gated by a dev env check, on port **45824** (chosen to avoid conflict with overlay server port 45823):

  ```typescript
  // DEV-ONLY: HTTP endpoint for test message injection
  // This Bun.serve() is NEW — there is no existing HTTP server in bun/index.ts
  if (process.env.NODE_ENV !== 'production') {
    Bun.serve({
      port: 45824,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/dev/inject-chat' && req.method === 'POST') {
          const body = (await req.json()) as NormalizedChatMessage
          sendToView.chat_message(body)
          return new Response('ok')
        }
        return new Response('not found', { status: 404 })
      },
    })
  }
  ```

  Read `packages/desktop/src/bun/index.ts` to find:
  - The exact variable name for the WebviewSender cast (search for `as unknown as WebviewSender`) — use that variable name in place of `sendToView`
  - The import path for `NormalizedChatMessage` (likely from `@twirchat/shared` or `../../../shared/types`)
  - Add this block AFTER the `BrowserWindow` and RPC setup (so `sendToView` is already defined)

  **Step B: Create `packages/desktop/tests/fixtures/seed-chat.ts`**

  This script sends 150 fake messages via the test endpoint:

  ```typescript
  // packages/desktop/tests/fixtures/seed-chat.ts
  import type { NormalizedChatMessage } from '../../../shared/types.ts'

  // Find the HTTP server port from packages/desktop/src/bun/index.ts
  const BUN_HTTP_PORT = /* read from bun/index.ts */ 3001

  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 30))
    const msg: NormalizedChatMessage = {
      id: `test-${i}-${Date.now()}`,
      platform: 'twitch',
      channel: 'testchannel',
      channelId: 'test-channel-id',
      username: `user${i}`,
      displayName: `User ${i}`,
      text: `Test message ${i} — @otheruser hello there`,
      timestamp: Date.now(),
      badges: [],
      emotes: [],
      color: `#${((i * 12345) % 0xffffff).toString(16).padStart(6, '0')}`,
    }
    await fetch(`http://localhost:${BUN_HTTP_PORT}/dev/inject-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    })
  }
  console.log('Injected 150 messages')
  ```

  **IMPORTANT**: Read `packages/desktop/src/bun/index.ts` first to find: (a) the exact HTTP server port, (b) the exact variable name for `sendToView`, (c) the exact `NormalizedChatMessage` field names from `packages/shared/types.ts`. Match all exactly.

  **Note on dev endpoint removal**: The `/dev/inject-chat` route is guarded by `process.env.NODE_ENV !== 'production'`. In production builds, `electrobun build` strips dev code. This does NOT affect the production binary.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: virtua package installed and imported correctly
    Tool: Bash
    Preconditions: Code change applied
    Steps:
      1. grep '"virtua"' packages/desktop/package.json
      2. grep "from 'virtua/vue'" packages/desktop/src/views/main/components/ChatList.vue
      3. grep "VList" packages/desktop/src/views/main/components/ChatList.vue
      4. Assert: all 3 greps return results
    Expected Result: Package present in dependencies AND imported from 'virtua/vue' AND VList used in template
    Failure Indicators: Any grep returns empty
    Evidence: .sisyphus/evidence/task-8-virtua-import.txt (redirect grep output here)

  Scenario: Template no longer clones and reverses the array
    Tool: Bash
    Steps:
      1. grep -n "\.reverse()" packages/desktop/src/views/main/components/ChatList.vue
      2. Assert: no output
      3. grep -n "\.\.\." packages/desktop/src/views/main/components/ChatList.vue
         # Verify no spread of activeMessages in the v-for context
      4. Assert: no spread of activeMessages in the v-for template
    Expected Result: Spread+reverse pattern removed from template
    Failure Indicators: .reverse() still present anywhere in the template
    Evidence: .sisyphus/evidence/task-8-no-reverse.txt

  Scenario: VList uses reverse prop for bottom-anchor scroll
    Tool: Bash
    Steps:
      1. grep -n ":reverse\|reverse=" packages/desktop/src/views/main/components/ChatList.vue
      2. Assert: VList has :reverse="true" or reverse prop present
      3. grep -n "scrollTop\|scrollHeight\|onScroll\|scroll(" packages/desktop/src/views/main/components/ChatList.vue
      4. Assert: no manual scroll manipulation (virtua handles it via reverse prop)
    Expected Result: VList has reverse prop; no manual scroll hacks present
    Failure Indicators: No reverse prop on VList, OR manual scrollTop manipulation still present
    Evidence: .sisyphus/evidence/task-8-reverse-prop.txt

  Scenario: Dev test endpoint present in bun/index.ts
    Tool: Bash
    Steps:
      1. grep -n "inject-chat\|inject_chat" packages/desktop/src/bun/index.ts
      2. Assert: endpoint definition found
      3. grep -n "NODE_ENV.*production\|production.*NODE_ENV" packages/desktop/src/bun/index.ts
      4. Assert: env guard present near the endpoint
      5. grep -n "45824" packages/desktop/src/bun/index.ts
      6. Assert: port 45824 present (this is the dev HTTP server port)
    Expected Result: Dev endpoint on port 45824 exists and is guarded by env check
    Failure Indicators: No endpoint found, no env guard, or wrong port
    Evidence: .sisyphus/evidence/task-8-dev-endpoint.txt

  Scenario: Dev endpoint responds to HTTP POST (smoke test)
    Tool: Bash
    Preconditions:
      Start the app: bun run --cwd packages/desktop dev
      Wait 20 seconds for bun/index.ts to start (Bun.serve on port 45824 must be running)
    Steps:
      1. curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:45824/dev/inject-chat \
           -H "Content-Type: application/json" \
           -d '{"id":"test-1","platform":"twitch","channel":"test","channelId":"c1","username":"u1","displayName":"U1","text":"hello","timestamp":0,"badges":[],"emotes":[],"color":"#ff0000"}'
         # Field names are illustrative — read packages/shared/types.ts for exact fields
      2. Assert: response HTTP status is 200
    Expected Result: Dev endpoint returns 200 (message dispatched to renderer via sendToView)
    Failure Indicators: Connection refused (server not running), 404, or non-200 status
    Evidence: .sisyphus/evidence/task-8-endpoint-smoke.txt (save curl output with -v flag)

  Scenario: Seed script exits 0 and logs completion
    Tool: Bash
    Preconditions: App already running (from previous scenario)
    Steps:
      1. bun packages/desktop/tests/fixtures/seed-chat.ts
      2. Assert: exit code 0
      3. Assert: output contains "Injected 150 messages"
    Expected Result: Seed script sends 150 messages successfully
    Failure Indicators: Non-zero exit code, connection error, or missing output
    Evidence: .sisyphus/evidence/task-8-seed-output.txt (redirect stdout here)

  Scenario: VList renders only visible rows (virtualization working)
    Tool: Playwright
    Preconditions:
      1. Vite dev server running: bun run --cwd packages/desktop dev
      2. Wait 15 seconds for Vite to be ready
    Steps:
      1. page.goto('http://localhost:5173/test-harness.html')
         (This is the standalone harness without waitForSocket — mounts immediately)
      2. await page.waitForSelector('[data-testid="chat-list"], .chat-list, [class*="vlist"]', { timeout: 10000 })
         # VList renders with a container element; adjust selector after reading ChatList.vue
      3. const visibleCount = await page.evaluate(() =>
           document.querySelectorAll('[class*="message"], [class*="chat-message"]').length
         )
      4. Assert: visibleCount > 0 AND visibleCount < 50
         (virtua renders only viewport-visible rows; 200 items seeded, only ~10-30 visible)
      5. await page.screenshot({ path: '.sisyphus/evidence/task-8-virtua-render.png' })
    Expected Result: DOM contains fewer than 50 message nodes (virtualization active); page screenshot saved
    Failure Indicators: visibleCount >= 150 (no virtualization), or page blank/error
    Evidence: .sisyphus/evidence/task-8-virtua-render.png + .sisyphus/evidence/task-8-dom-count.txt

  Scenario: Auto-scroll to bottom on new messages (bottom-anchor behavior)
    Tool: Playwright
    Preconditions: test-harness.html loaded (from previous scenario)
    Steps:
      1. const initialScrollHeight = await page.evaluate(() =>
           document.querySelector('[class*="vlist"], [data-testid="chat-list"]')?.scrollHeight ?? 0
         )
      2. const isAtBottom = await page.evaluate(() => {
           const el = document.querySelector('[class*="vlist"], [data-testid="chat-list"]')
           if (!el) return false
           return Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 10
         })
      3. Assert: isAtBottom is true (VList with reverse=true starts at bottom)
    Expected Result: Scroll position is at the bottom after initial render
    Failure Indicators: isAtBottom is false (scroll not anchored to bottom)
    Evidence: .sisyphus/evidence/task-8-scroll-position.txt (save evaluate results)
  ```

  **IMPORTANT**: Read `packages/desktop/src/bun/index.ts` and `packages/shared/types.ts` to get the exact variable name for the WebviewSender cast and exact `NormalizedChatMessage` field names before writing this fixture. Match all exactly.

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-8-virtua-import.txt`
  - [ ] `.sisyphus/evidence/task-8-no-reverse.txt`
  - [ ] `.sisyphus/evidence/task-8-reverse-prop.txt`
  - [ ] `.sisyphus/evidence/task-8-dev-endpoint.txt`
  - [ ] `.sisyphus/evidence/task-8-endpoint-smoke.txt`
  - [ ] `.sisyphus/evidence/task-8-seed-output.txt`
  - [ ] `.sisyphus/evidence/task-8-virtua-render.png`
  - [ ] `.sisyphus/evidence/task-8-dom-count.txt`
  - [ ] `.sisyphus/evidence/task-8-scroll-position.txt`

  **Commit**: YES
  - Message: `feat(chat-list): add virtua VList for DOM virtualization`
  - Files: `packages/desktop/src/views/main/components/ChatList.vue`, `packages/desktop/src/bun/index.ts` (dev endpoint), `packages/desktop/package.json`, `bun.lock`, `packages/desktop/tests/fixtures/seed-chat.ts`, `packages/desktop/src/views/main/test-harness.html`, `packages/desktop/src/views/main/test-harness.ts`
  - Pre-commit: `bun run fix` (monorepo root) + `bun run --cwd packages/desktop typecheck`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Read this plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Verify evidence files exist: `.sisyphus/evidence/memory-baseline.txt` and `.sisyphus/evidence/memory-after.txt`. Check deliverables list.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run `bun run check` from monorepo root (typecheck + lint + format across all packages). Also run `bun run --cwd packages/desktop typecheck` specifically for vue-tsc. Run `bun test tests/` from `packages/desktop`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod code, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic variable names.
      Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
      Use the dev HTTP endpoint and `seed-chat.ts` fixture from Task 8 for message injection: 1. Start app: `bun run --cwd packages/desktop dev` (starts Vite + bun/index.ts in parallel) 2. Wait 20 seconds for both processes to be ready 3. Run seed: `bun packages/desktop/tests/fixtures/seed-chat.ts` 4. Assert: seed exits 0 with "Injected 150 messages" 5. Verify dev endpoint responds: `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:45824/dev/inject-chat -H "Content-Type: application/json" -d '{"id":"f3-test",...}'` → Assert 200

      Verify all code-based QA scenarios from Tasks 5–8 via grep:
      - grep for no .reverse() in ChatList
      - grep for `from 'virtua/vue'` in ChatList (virtua import)
      - grep for VList `:reverse` prop in ChatList (bottom-anchor scroll)
      - grep for no `reactive(new Map` in ChatMessage
      - grep for triggerRef in App.vue
      - grep for no local pollTimer in ChatList

      Capture all evidence to `.sisyphus/evidence/final-qa/`.
      Output: `Code Verification [N/N pass] | Endpoint smoke [PASS/FAIL] | Seed injection [PASS/FAIL] | VERDICT`

- [ ] F4. **Post-fix Measurement + CEF Baseline Documentation** — `quick`
      **Two-phase measurement** to cover both idle and loaded workload:

      **Phase 1 — Idle measurement** (same conditions as Task 1 baseline):
      1. Start app: `bun run --cwd packages/desktop dev` (starts Vite + bun/index.ts — same command as Task 1)
      2. Wait 30 seconds for stable idle state
      3. Get PID: `PID=$(pgrep TwirChat)` (fallback: `PID=$(pgrep -f "src/bun/index.ts" | tr '\n' ' ' | awk '{print $1}')`)
      4. Run:

  ```bash
  echo "=== Post-fix Idle ===" > .sisyphus/evidence/memory-after.txt
  echo "=== Date: $(date) ===" >> .sisyphus/evidence/memory-after.txt
  grep VmRSS /proc/$PID/status >> .sisyphus/evidence/memory-after.txt
  awk '/Private_Clean|Private_Dirty/{sum+=$2} END{print "Idle USS:", sum/1024, "MB"}' /proc/$PID/smaps >> .sisyphus/evidence/memory-after.txt
  ```

      **Phase 2 — Loaded measurement** (after seeding 150 messages to exercise renderer + adapters):
      1. Run seed: `bun packages/desktop/tests/fixtures/seed-chat.ts`
      2. Wait 30 seconds for messages to settle
      3. Get updated PID if needed: `PID=$(pgrep TwirChat)`
      4. Run:

  ```bash
  echo "=== Post-fix Loaded (150 messages) ===" >> .sisyphus/evidence/memory-after.txt
  grep VmRSS /proc/$PID/status >> .sisyphus/evidence/memory-after.txt
  awk '/Private_Clean|Private_Dirty/{sum+=$2} END{print "Loaded USS:", sum/1024, "MB"}' /proc/$PID/smaps >> .sisyphus/evidence/memory-after.txt
  ```

      Compare idle baseline from `.sisyphus/evidence/memory-baseline.txt` with idle and loaded values here. Report delta.
      Append to `.sisyphus/evidence/memory-after.txt`:
      "Note: htop RES includes shared CEF (Chromium Embedded Framework) pages (~150–300MB on Linux) that are charged to the process but physically shared with the OS. The actual app-private memory is the USS figure above. These shared pages cannot be reduced without changing the rendering engine. CEF is configured in packages/desktop/electrobun.config.ts (bundleCEF: true, defaultRenderer: 'cef')."
      Output: `Baseline Idle USS: X MB → Post-fix Idle USS: Y MB → Post-fix Loaded USS: Z MB | VERDICT`

---

## Commit Strategy

```
commit 1: (baseline measurement — no code, evidence file only)
commit 2: fix(youtube-adapter): clear reconnectTimeout before scheduling new one
commit 3: fix(kick-adapter): close existing WebSocket before creating new connection
commit 4: fix(twitch-adapter): guard connectChatClient against double-connect
commit 5: perf(chat-message): remove reactive() from mentionColorCache, add 2000-entry cap
commit 6: perf(app): eliminate O(n) spread allocation on every incoming message
commit 7: refactor(chat-list): extract channel-status polling to shared composable
commit 8: feat(chat-list): add virtua VList for DOM virtualization
```

Each commit boundary: `bun run fix` (monorepo root) + `bun run --cwd packages/desktop typecheck` passes + `bun test tests/` passes, app runnable.

---

## Success Criteria

### Verification Commands

```bash
# From monorepo root:
bun run check                                    # Expected: no errors
bun run --cwd packages/desktop typecheck         # Expected: vue-tsc no errors
bun test --cwd packages/desktop tests/           # Expected: all tests pass

# Start app correctly (Vite + bun process in parallel):
bun run --cwd packages/desktop dev

# Memory — idle (same as baseline, after 30s):
PID=$(pgrep TwirChat)
awk '/Private_Clean|Private_Dirty/{sum+=$2} END{print sum/1024, "MB USS idle"}' /proc/$PID/smaps

# Memory — loaded (after running seed-chat.ts + 30s):
bun packages/desktop/tests/fixtures/seed-chat.ts
sleep 30
PID=$(pgrep TwirChat)
awk '/Private_Clean|Private_Dirty/{sum+=$2} END{print sum/1024, "MB USS loaded"}' /proc/$PID/smaps
# Expected: loaded USS measurably close to or lower than baseline USS

# Virtua integration check:
grep "from 'virtua/vue'" packages/desktop/src/views/main/components/ChatList.vue
grep "VList" packages/desktop/src/views/main/components/ChatList.vue
# Expected: both return results

# Dev endpoint smoke test (app must be running):
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:45824/dev/inject-chat \
  -H "Content-Type: application/json" -d '{"id":"check-1","platform":"twitch","channel":"t","channelId":"c","username":"u","displayName":"U","text":"hi","timestamp":0,"badges":[],"emotes":[],"color":"#fff"}'
# Expected: 200
```

### Final Checklist

- [ ] All "Must Have" items implemented
- [ ] All "Must NOT Have" guardrails respected
- [ ] `bun run check` passes (monorepo root)
- [ ] `bun run --cwd packages/desktop typecheck` passes (vue-tsc)
- [ ] `bun test tests/` passes from `packages/desktop`
- [ ] Baseline and post-fix USS measurements recorded
- [ ] CEF shared-page explanation documented
