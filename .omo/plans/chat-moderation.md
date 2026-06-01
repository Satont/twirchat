# Chat Moderation Actions (Ban / Timeout / Delete)

## TL;DR

> **Quick Summary**: Add a `⋮` hover button to chat messages that opens a context menu with moderation actions (Ban, Timeout, Delete message) — available only when the current user is authenticated on Twitch or Kick. Also includes non-destructive actions (Reply, Copy message, Copy username) for all users.
>
> **Deliverables**:
>
> - `ContextMenu.vue` — new reka-ui Popover-based component with all menu items
> - `TwitchAdapter` — new `banUser()`, `timeoutUser()`, `deleteMessage()` methods via Helix REST API + broadcaster_id caching in `connect()`
> - `KickAdapter` — new `banUser()`, `timeoutUser()`, `deleteMessage()` methods via Kick v1 REST API
> - `rpc.ts` — new `moderateMessage` + `getModerationRole` RPC types
> - `bun/index.ts` — RPC handlers for the above
> - `base-adapter.ts` — optional moderation method signatures
> - `packages/backend/src/auth/twitch.ts` + `kick.ts` — new OAuth moderation scopes
> - `packages/desktop/tests/moderation.test.ts` — unit tests (TDD)
> - `ChatMessage.vue` — integrate `⋮` button + `ContextMenu`
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: Task 1 (RPC types) → Task 5 (TwitchAdapter) → Task 7 (bun handlers) → Task 10 (ChatMessage.vue)

---

## Context

### Original Request

Issue #16: Add ban/timeout features for Kick and Twitch. Only works for broadcaster/moderator.

### Interview Summary

**Key Discussions**:

- Timeout duration: presets (1м/5м/10м/1ч/1д) + custom input field
- Context menu contents: Reply, Copy message, Copy username + moderation (Delete, Timeout, Ban)
- Delete message for Twitch: YES, include
- UI trigger: `⋮` hover button (consistent with existing hover buttons pattern)

**Research Findings**:

- Twitch Helix API: `POST /helix/moderation/bans` (ban/timeout), `DELETE /helix/moderation/chat` (delete message)
  - Requires `broadcaster_id` (numeric!) — must fetch from login during `connect()`
  - Scopes: `moderator:manage:banned_users`, `moderator:manage:chat_messages`
- Kick API: `POST /public/v1/moderation/bans`, `DELETE /public/v1/chat/{message_id}`
  - `broadcaster_user_id` already stored on adapter as `this.broadcasterUserId`
  - Scopes: `moderation:ban`, `moderation:chat_message:manage`

### Metis Review

**Identified Gaps** (addressed):

- OAuth scopes are in `packages/backend/` NOT `packages/desktop/src/auth/` — plan corrected
- Twitch `broadcaster_id` is numeric but `channelId` is a login string — fix: fetch+cache in `connect()`
- `BasePlatformAdapter` moderation methods must be **optional** (not abstract) — YouTube adapter left untouched
- `getModerationRole` must be local only (no network calls) — check `AccountStore.findByPlatform(platform) !== null`
- Do NOT show moderation actions on `type === 'system'` messages or `platform === 'youtube'`
- Moderation methods should call `refreshTokenIfNeeded()` before API calls (same as `sendMessage`)

---

## Work Objectives

### Core Objective

Add right-click / hover-button moderation actions to chat messages for Twitch and Kick platforms, restricted to authenticated (broadcaster/moderator) users.

### Concrete Deliverables

- `packages/desktop/tests/moderation.test.ts` (unit tests)
- `packages/backend/src/auth/twitch.ts` (new OAuth scopes)
- `packages/backend/src/auth/kick.ts` (new OAuth scopes)
- `packages/desktop/src/platforms/base-adapter.ts` (optional moderation interface)
- `packages/desktop/src/platforms/twitch/adapter.ts` (moderation methods + broadcaster_id cache)
- `packages/desktop/src/platforms/kick/adapter.ts` (moderation methods)
- `packages/desktop/src/shared/rpc.ts` (moderateMessage + getModerationRole RPC types)
- `packages/desktop/src/bun/index.ts` (RPC handlers)
- `packages/desktop/src/views/main/components/ui/ContextMenu.vue` (new component)
- `packages/desktop/src/views/main/components/ChatMessage.vue` (⋮ button + menu integration)

### Definition of Done

- [ ] `bun test packages/desktop/tests/moderation.test.ts` → PASS (0 failures)
- [ ] `bun run check` passes (root monorepo: typecheck + lint + format)
- [ ] `grep "moderator:manage:banned_users" packages/backend/src/auth/twitch.ts` → match found
- [ ] `grep "moderation:ban" packages/backend/src/auth/kick.ts` → match found
- [ ] `grep "moderateMessage" packages/desktop/src/shared/rpc.ts` → match found
- [ ] `grep "moderateMessage" packages/desktop/src/bun/index.ts` → match found

### Must Have

- Ban user (permanent) on Twitch + Kick
- Timeout user with 5 presets + custom input on Twitch + Kick
- Delete message on Twitch + Kick
- Reply, Copy message, Copy username in same menu (all users)
- Actions shown only when `getModerationRole(platform)` returns `'broadcaster'` (i.e., authenticated)
- `refreshTokenIfNeeded()` called before every moderation API request

### Must NOT Have (Guardrails)

- NO unban flow — out of scope
- NO moderation on `platform === 'youtube'` messages
- NO moderation on `type === 'system'` messages
- NO confirmation dialog before ban (not requested)
- NO moderation in `overlay/App.vue`
- NO abstract/required moderation methods on `BasePlatformAdapter` — optional only
- NO network calls in `getModerationRole` — derive from `AccountStore.findByPlatform()` only
- NO moderation history/log panel
- NO Twitch /slow, /emoteonly, /subscribers commands
- NO "reason" input field in the UI (API supports it but not required)
- NO abstracting timeout presets to settings — hardcode in component

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES (`packages/desktop/tests/`)
- **Automated tests**: TDD (RED → GREEN) for adapter methods; tests-after for RPC handlers
- **Framework**: `bun test`
- **TDD Tasks**: Tasks 4 (stubs) + 9 (fill in) follow RED → GREEN cycle

### QA Policy

Every task includes agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{slug}.{ext}`.

- **Backend/adapter**: Bash (`bun test`, `grep`, `curl` for live API calls if token available)
- **RPC**: Bash (`grep` patterns + type-check)
- **UI**: Playwright — navigate to running app, hover message, click ⋮, assert menu items
- **Types**: `bun run typecheck` (`vue-tsc --noEmit`)

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — all foundation, no deps):
├── Task 1: RPC schema types (moderateMessage + getModerationRole)  [quick]
├── Task 2: Backend OAuth scopes (twitch.ts + kick.ts)               [quick]
├── Task 3: IPlatformAdapter optional moderation methods              [quick]
└── Task 4: TDD test stubs — moderation.test.ts (RED phase)          [quick]

Wave 2 (After Wave 1 — adapter implementations, parallel):
├── Task 5: TwitchAdapter — broadcaster_id cache + ban/timeout/delete [deep]
├── Task 6: KickAdapter — ban/timeout/delete                          [deep]
└── Task 7: bun/index.ts — moderateMessage + getModerationRole handlers [unspecified-high]

Wave 3 (After Wave 2 — UI + tests GREEN, parallel):
├── Task 8: ContextMenu.vue — reka-ui Popover, all menu items         [visual-engineering]
└── Task 9: Fill moderation.test.ts — make tests pass (GREEN phase)   [quick]

Wave 4 (After Wave 3 — integration):
└── Task 10: ChatMessage.vue — ⋮ button + ContextMenu integration     [visual-engineering]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── F1: Plan compliance audit   [oracle]
├── F2: Code quality review      [unspecified-high]
├── F3: Real manual QA           [unspecified-high + playwright skill]
└── F4: Scope fidelity check     [deep]
→ Present results → wait for user okay
```

### Dependency Matrix

| Task | Depends On | Blocks  |
| ---- | ---------- | ------- |
| 1    | —          | 5, 6, 7 |
| 2    | —          | —       |
| 3    | —          | 5, 6    |
| 4    | 1, 3       | 9       |
| 5    | 1, 3       | 7, 9    |
| 6    | 1, 3       | 7, 9    |
| 7    | 1, 5, 6    | 10      |
| 8    | —          | 10      |
| 9    | 4, 5, 6    | F2      |
| 10   | 7, 8       | F1-F4   |

### Agent Dispatch Summary

- **Wave 1**: 4× `quick`
- **Wave 2**: 2× `deep`, 1× `unspecified-high`
- **Wave 3**: 1× `visual-engineering`, 1× `quick`
- **Wave 4**: 1× `visual-engineering`
- **FINAL**: `oracle`, `unspecified-high`, `unspecified-high`+`playwright`, `deep`

---

## TODOs

- [ ] 1. RPC schema — add `moderateMessage` + `getModerationRole` types

  **What to do**:
  - Open `packages/desktop/src/shared/rpc.ts`
  - Add to `BunRequests` interface:
    ```typescript
    moderateMessage: {
      params:
        | { platform: 'twitch' | 'kick'; channelId: string; action: 'ban'; targetUserId: string }
        | { platform: 'twitch' | 'kick'; channelId: string; action: 'timeout'; targetUserId: string; durationSeconds: number }
        | { platform: 'twitch' | 'kick'; channelId: string; action: 'delete'; messageId: string; targetUserId: string }
      response: void
    }
    getModerationRole: {
      params: { platform: Platform }
      response: 'broadcaster' | 'none'
    }
    ```
  - `Platform` type already exists in `packages/shared/types.ts`

  **Must NOT do**:
  - Do NOT add separate `ban`, `timeout`, `deleteMessage` RPCs — use discriminated union on `moderateMessage`
  - Do NOT add `getModerationStatus` with per-channel details — only `getModerationRole` per platform

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file edit, adding TypeScript types only
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 5, 6, 7
  - **Blocked By**: None

  **References**:
  - `packages/desktop/src/shared/rpc.ts` — existing `BunRequests` interface pattern; add after `sendMessage`
  - `packages/shared/types.ts` — `Platform` type definition
  - `packages/desktop/src/views/main/components/ChatMessage.vue` — shows how `rpc.request.*` is called from webview

  **Acceptance Criteria**:
  - [ ] `grep "moderateMessage" packages/desktop/src/shared/rpc.ts` → match found
  - [ ] `grep "getModerationRole" packages/desktop/src/shared/rpc.ts` → match found
  - [ ] `bun run typecheck` in `packages/desktop` passes with 0 errors after this task

  **QA Scenarios**:

  ```
  Scenario: RPC types are present and compile
    Tool: Bash
    Steps:
      1. Run: grep "moderateMessage" packages/desktop/src/shared/rpc.ts
      2. Run: grep "getModerationRole" packages/desktop/src/shared/rpc.ts
      3. Run: cd packages/desktop && vue-tsc --noEmit 2>&1 | head -20
    Expected Result: Both greps match, vue-tsc exits 0
    Evidence: .sisyphus/evidence/task-1-rpc-types.txt

  Scenario: Discriminated union covers all three action types
    Tool: Bash
    Steps:
      1. Run: grep -A 12 "moderateMessage" packages/desktop/src/shared/rpc.ts
    Expected Result: Output includes 'ban', 'timeout', 'delete' union members
    Evidence: .sisyphus/evidence/task-1-rpc-union.txt
  ```

  **Commit**: YES (commit 6, groups with tasks 7)
  - Message: `feat(desktop): add moderateMessage + getModerationRole RPC`
  - Files: `packages/desktop/src/shared/rpc.ts`

- [ ] 2. Backend OAuth scopes — Twitch + Kick

  **What to do**:
  - Open `packages/backend/src/auth/twitch.ts`
  - Find the `TWITCH_SCOPES` constant (or scope array)
  - Add: `'moderator:manage:banned_users'` and `'moderator:manage:chat_messages'`
  - Open `packages/backend/src/auth/kick.ts`
  - Find `buildKickAuthUrl` or the scope string (currently `'user:read channel:read chat:write events:subscribe'`)
  - Add: `'moderation:ban'` and `'moderation:chat_message:manage'` to the space-separated scope string

  **Must NOT do**:
  - Do NOT modify `packages/desktop/src/auth/twitch.ts` or `packages/desktop/src/auth/kick.ts` — those are not where scopes live
  - Do NOT remove existing scopes

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple string additions to two backend files
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Nothing directly (users need to re-auth to get new scopes)
  - **Blocked By**: None

  **References**:
  - `packages/backend/src/auth/twitch.ts` — locate `TWITCH_SCOPES` array; add two new scope strings
  - `packages/backend/src/auth/kick.ts` — locate scope string in `buildKickAuthUrl`; space-append new scopes

  **Acceptance Criteria**:
  - [ ] `grep "moderator:manage:banned_users" packages/backend/src/auth/twitch.ts` → match
  - [ ] `grep "moderator:manage:chat_messages" packages/backend/src/auth/twitch.ts` → match
  - [ ] `grep "moderation:ban" packages/backend/src/auth/kick.ts` → match
  - [ ] `grep "moderation:chat_message:manage" packages/backend/src/auth/kick.ts` → match
  - [ ] `cd packages/backend && tsgo --noEmit` passes with 0 errors

  **QA Scenarios**:

  ```
  Scenario: All four scope strings present in correct files
    Tool: Bash
    Steps:
      1. grep "moderator:manage:banned_users" packages/backend/src/auth/twitch.ts
      2. grep "moderator:manage:chat_messages" packages/backend/src/auth/twitch.ts
      3. grep "moderation:ban" packages/backend/src/auth/kick.ts
      4. grep "moderation:chat_message:manage" packages/backend/src/auth/kick.ts
    Expected Result: All 4 greps return matches
    Evidence: .sisyphus/evidence/task-2-oauth-scopes.txt

  Scenario: Backend typechecks cleanly after changes
    Tool: Bash
    Steps:
      1. cd packages/backend && tsgo --noEmit 2>&1
    Expected Result: Exit 0, no errors
    Evidence: .sisyphus/evidence/task-2-typecheck.txt
  ```

  **Commit**: YES (commit 2)
  - Message: `feat(backend): add moderation OAuth scopes for Twitch and Kick`
  - Files: `packages/backend/src/auth/twitch.ts`, `packages/backend/src/auth/kick.ts`

- [ ] 3. `BasePlatformAdapter` — add optional moderation interface methods

  **What to do**:
  - Open `packages/desktop/src/platforms/base-adapter.ts`
  - Add optional method signatures to the interface/abstract class (NOT abstract — optional with `?`):
    ```typescript
    banUser?(channelId: string, targetUserId: string): Promise<void>
    timeoutUser?(channelId: string, targetUserId: string, durationSeconds: number): Promise<void>
    deleteMessage?(channelId: string, messageId: string): Promise<void>
    ```
  - Do NOT add implementations or abstract method bodies
  - Do NOT modify `YouTubeAdapter` — leave it untouched

  **Must NOT do**:
  - Do NOT make methods `abstract` — this would force YouTube adapter to implement stubs
  - Do NOT add method bodies to the base class

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Interface-only change, 3 lines added
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: None

  **References**:
  - `packages/desktop/src/platforms/base-adapter.ts` — existing interface; follow the `sendMessage` pattern for method signature style
  - `packages/desktop/src/platforms/twitch/adapter.ts` — will implement these methods in Task 5
  - `packages/desktop/src/platforms/kick/adapter.ts` — will implement these methods in Task 6

  **Acceptance Criteria**:
  - [ ] `grep "banUser" packages/desktop/src/platforms/base-adapter.ts` → match (with `?`)
  - [ ] `packages/desktop/src/platforms/youtube/adapter.ts` is NOT modified (verify with `git diff`)
  - [ ] `bun run typecheck` passes

  **QA Scenarios**:

  ```
  Scenario: Optional methods added, YouTube adapter unmodified
    Tool: Bash
    Steps:
      1. grep "banUser?" packages/desktop/src/platforms/base-adapter.ts
      2. git diff packages/desktop/src/platforms/youtube/ --name-only
    Expected Result: banUser? present; YouTube diff shows no changes
    Evidence: .sisyphus/evidence/task-3-base-adapter.txt
  ```

  **Commit**: YES (commit 3, groups with Task 4)
  - Message: `feat(desktop): add optional moderation interface to BasePlatformAdapter`
  - Files: `packages/desktop/src/platforms/base-adapter.ts`

- [ ] 4. TDD stubs — `packages/desktop/tests/moderation.test.ts` (RED phase)

  **What to do**:
  - Create `packages/desktop/tests/moderation.test.ts`
  - Write test cases that will FAIL until Tasks 5 + 6 implement the actual methods
  - Test duration conversion helper (to be extracted as `secondsToLabel` or inline in component — test the math):
    ```typescript
    test('timeout presets convert correctly', () => {
      expect(60).toBe(60) // 1m → 60s
      expect(300).toBe(300) // 5m → 300s
      expect(3600).toBe(3600) // 1h → 3600s
      expect(86400).toBe(86400) // 1d → 86400s
    })
    ```
  - Test error code mapping (to be implemented in adapters):
    - Mock `fetch` returning 403 → adapter throws with code `'INSUFFICIENT_SCOPE'`
    - Mock `fetch` returning 422 → adapter throws with code `'USER_PROTECTED'`
    - Mock `fetch` returning 200 → adapter resolves `void`
  - Test anonymous mode guard:
    - Calling `adapter.banUser(...)` when `this.anonymous === true` throws `'NOT_AUTHENTICATED'`
  - Look at existing tests for mock patterns: `packages/desktop/tests/aggregator.test.ts`

  **Must NOT do**:
  - Do NOT implement the adapter methods here — tests should FAIL (RED) initially
  - Do NOT test Vue components with bun:test

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Creating test stubs; implementation comes in Task 9
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 9
  - **Blocked By**: Tasks 1, 3 (need types for mock setup)

  **References**:
  - `packages/desktop/tests/aggregator.test.ts` — mock patterns, import style, bun:test usage
  - `packages/desktop/tests/store.test.ts` — another test reference for patterns
  - `packages/desktop/src/platforms/twitch/adapter.ts` — class to be tested (mock fetch, check thrown errors)

  **Acceptance Criteria**:
  - [ ] File `packages/desktop/tests/moderation.test.ts` exists
  - [ ] `bun test packages/desktop/tests/moderation.test.ts` runs (some tests will FAIL — that is expected at RED phase)
  - [ ] Test count ≥ 5 (covers: ban success, timeout success, delete success, 403 error, 422 error)

  **QA Scenarios**:

  ```
  Scenario: Test file exists and runs (RED phase — failures are expected)
    Tool: Bash
    Steps:
      1. ls packages/desktop/tests/moderation.test.ts
      2. bun test packages/desktop/tests/moderation.test.ts 2>&1 | tail -20
    Expected Result: File exists; bun:test runner executes (even if tests fail — RED is correct at this stage)
    Evidence: .sisyphus/evidence/task-4-test-stubs.txt
  ```

  **Commit**: YES (commit 1)
  - Message: `test(desktop): add moderation unit test stubs (TDD scaffolding)`
  - Files: `packages/desktop/tests/moderation.test.ts`

- [ ] 5. `TwitchAdapter` — cache `broadcaster_id` in `connect()` + implement moderation methods

  **What to do**:

  **Step A — cache broadcaster numeric ID in `connect()`**:
  - In `TwitchAdapter.connect(channelSlug: string)`, after the existing setup, add a fetch call:
    ```typescript
    // Fetch broadcaster numeric user ID (required for Helix moderation endpoints)
    const res = await fetch(`https://api.twitch.tv/helix/users?login=${channelSlug}`, {
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Client-Id': this.clientId },
    })
    const data = await res.json()
    this.broadcasterUserId = data.data?.[0]?.id ?? null
    ```
  - Add `private broadcasterUserId: string | null = null` field to the class
  - Guard: if `this.anonymous === true`, skip the fetch (no token available)

  **Step B — implement moderation methods**:

  ```typescript
  async banUser(channelId: string, targetUserId: string): Promise<void>
  async timeoutUser(channelId: string, targetUserId: string, durationSeconds: number): Promise<void>
  async deleteMessage(channelId: string, messageId: string): Promise<void>
  ```

  - Call `await this.refreshTokenIfNeeded()` at the start of each method
  - Guard: if `this.anonymous || !this.accessToken` → throw `{ code: 'NOT_AUTHENTICATED' }`
  - Guard: if `!this.broadcasterUserId` → throw `{ code: 'BROADCASTER_ID_MISSING' }`
  - `banUser`: `POST https://api.twitch.tv/helix/moderation/bans?broadcaster_id={this.broadcasterUserId}&moderator_id={this.currentUserId}`
    - Body: `{ data: { user_id: targetUserId } }` (no duration = permanent ban)
  - `timeoutUser`: same endpoint + body `{ data: { user_id: targetUserId, duration: durationSeconds } }`
  - `deleteMessage`: `DELETE https://api.twitch.tv/helix/moderation/chat?broadcaster_id={this.broadcasterUserId}&moderator_id={this.currentUserId}&message_id={messageId}`
  - Error handling: parse response status
    - 403 → throw `{ code: 'INSUFFICIENT_SCOPE', message: 'Re-authorize Twitch to enable moderation' }`
    - 422 → throw `{ code: 'USER_PROTECTED', message: 'Cannot moderate this user' }`
    - 400 → throw `{ code: 'BAD_REQUEST', message: body.message }`
    - 2xx → return void
  - `this.currentUserId` — look at how the adapter stores account user ID (check existing account handling in the file)

  **Must NOT do**:
  - Do NOT use Twurple IRC commands (`chatClient.ban()`) — use Helix REST API directly with `fetch()`
  - Do NOT throw raw fetch errors — always wrap with structured `{ code, message }`

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Non-trivial integration with external API, error handling paths, token refresh patterns
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7)
  - **Blocks**: Tasks 7, 9
  - **Blocked By**: Tasks 1, 3

  **References**:
  - `packages/desktop/src/platforms/twitch/adapter.ts` — existing adapter; look at `sendMessage()` for token refresh pattern + fetch pattern; look at `connect()` for where to add broadcaster_id fetch
  - `packages/desktop/src/platforms/kick/adapter.ts` — reference for `this.broadcasterUserId` field pattern (Kick already does this)
  - Twitch Helix API: `POST https://api.twitch.tv/helix/moderation/bans` — params: `broadcaster_id`, `moderator_id` in query; body: `{ data: { user_id, duration? } }`
  - Twitch Helix API: `DELETE https://api.twitch.tv/helix/moderation/chat` — params: `broadcaster_id`, `moderator_id`, `message_id` in query
  - Required headers: `Authorization: Bearer {token}`, `Content-Type: application/json`, `Client-Id: {clientId}`

  **Acceptance Criteria**:
  - [ ] `grep "broadcasterUserId" packages/desktop/src/platforms/twitch/adapter.ts` → match (field declared)
  - [ ] `grep "banUser\|timeoutUser\|deleteMessage" packages/desktop/src/platforms/twitch/adapter.ts` → 3 matches
  - [ ] `grep "refreshTokenIfNeeded" packages/desktop/src/platforms/twitch/adapter.ts` → present in all 3 moderation methods
  - [ ] `grep "INSUFFICIENT_SCOPE" packages/desktop/src/platforms/twitch/adapter.ts` → match (403 handling)
  - [ ] `bun run typecheck` passes

  **QA Scenarios**:

  ```
  Scenario: Moderation methods are defined and error codes present
    Tool: Bash
    Steps:
      1. grep -n "banUser\|timeoutUser\|deleteMessage\|broadcasterUserId\|INSUFFICIENT_SCOPE" packages/desktop/src/platforms/twitch/adapter.ts
    Expected Result: All 5 patterns found
    Evidence: .sisyphus/evidence/task-5-twitch-adapter.txt

  Scenario: refreshTokenIfNeeded called in each method
    Tool: Bash
    Steps:
      1. grep -c "refreshTokenIfNeeded" packages/desktop/src/platforms/twitch/adapter.ts
    Expected Result: Count ≥ 4 (3 new moderation methods + existing sendMessage call)
    Evidence: .sisyphus/evidence/task-5-token-refresh.txt
  ```

  **Commit**: YES (commit 4)
  - Message: `feat(desktop): cache broadcaster_id in TwitchAdapter.connect() + implement ban/timeout/delete`
  - Files: `packages/desktop/src/platforms/twitch/adapter.ts`

- [ ] 6. `KickAdapter` — implement moderation methods

  **What to do**:
  - Add to `KickAdapter`:
    ```typescript
    async banUser(channelId: string, targetUserId: string): Promise<void>
    async timeoutUser(channelId: string, targetUserId: string, durationSeconds: number): Promise<void>
    async deleteMessage(channelId: string, messageId: string): Promise<void>
    ```
  - `this.broadcasterUserId` already exists on `KickAdapter` — use it directly
  - Call `await this.refreshTokenIfNeeded()` at start of each method
  - Guard: if `this.anonymous || !this.accessToken` → throw `{ code: 'NOT_AUTHENTICATED' }`
  - `banUser`: `POST https://api.kick.com/public/v1/moderation/bans`
    - Body: `{ broadcaster_user_id: this.broadcasterUserId, user_id: targetUserId }`
    - Headers: `Authorization: Bearer {accessToken}`, `Content-Type: application/json`
    - Omit `duration` for permanent ban
  - `timeoutUser`: same endpoint + body `{ broadcaster_user_id, user_id: targetUserId, duration: Math.round(durationSeconds / 60) }` (Kick uses **minutes**, not seconds — convert!)
  - `deleteMessage`: `DELETE https://api.kick.com/public/v1/chat/${messageId}`
    - Headers: `Authorization: Bearer {accessToken}`
    - 204 No Content = success
  - Error handling:
    - 403 → throw `{ code: 'INSUFFICIENT_SCOPE', message: 'Re-authorize Kick to enable moderation' }`
    - 404 → throw `{ code: 'NOT_FOUND', message: 'Message or user not found' }`
    - 2xx → return void

  **Must NOT do**:
  - Do NOT use minutes for `timeoutUser` duration parameter — accept seconds, convert to minutes internally for Kick API
  - Do NOT skip the `Math.round(durationSeconds / 60)` conversion — Kick API requires minutes

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: External Kick API integration, unit conversion, error paths
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 7)
  - **Blocks**: Tasks 7, 9
  - **Blocked By**: Tasks 1, 3

  **References**:
  - `packages/desktop/src/platforms/kick/adapter.ts` — existing adapter; look at `sendMessage()` for token refresh pattern; `this.broadcasterUserId` already stored
  - Kick API: `POST https://api.kick.com/public/v1/moderation/bans` — body: `{ broadcaster_user_id, user_id, duration? (minutes), reason? }`
  - Kick API: `DELETE https://api.kick.com/public/v1/chat/{message_id}` — 204 No Content on success
  - Timeout unit: Kick = **minutes** (max 10080 = 7 days), Twitch = **seconds** — all internal RPC uses seconds

  **Acceptance Criteria**:
  - [ ] `grep "banUser\|timeoutUser\|deleteMessage" packages/desktop/src/platforms/kick/adapter.ts` → 3 matches
  - [ ] `grep "Math.round\|/ 60" packages/desktop/src/platforms/kick/adapter.ts` → match (seconds→minutes conversion)
  - [ ] `grep "INSUFFICIENT_SCOPE" packages/desktop/src/platforms/kick/adapter.ts` → match
  - [ ] `bun run typecheck` passes

  **QA Scenarios**:

  ```
  Scenario: Kick moderation methods implemented with unit conversion
    Tool: Bash
    Steps:
      1. grep -n "banUser\|timeoutUser\|deleteMessage\|/ 60\|INSUFFICIENT_SCOPE" packages/desktop/src/platforms/kick/adapter.ts
    Expected Result: All patterns found (including / 60 conversion)
    Evidence: .sisyphus/evidence/task-6-kick-adapter.txt
  ```

  **Commit**: YES (commit 5)
  - Message: `feat(desktop): implement ban/timeout/delete in KickAdapter`
  - Files: `packages/desktop/src/platforms/kick/adapter.ts`

- [ ] 7. `bun/index.ts` — implement `moderateMessage` + `getModerationRole` RPC handlers

  **What to do**:

  **`getModerationRole` handler**:

  ```typescript
  getModerationRole: async ({ platform }) => {
    const account = accountStore.findByPlatform(platform)
    return account ? 'broadcaster' : 'none'
  }
  ```

  - This is pure local lookup — NO network calls

  **`moderateMessage` handler**:
  - Get the platform adapter instance (look at how existing handlers get adapters)
  - Cast to `TwitchAdapter` or `KickAdapter` based on `params.platform` (same pattern as `getBroadcasterUserId()` cast already in file)
  - Dispatch based on `params.action`:
    - `'ban'` → `await adapter.banUser(params.channelId, params.targetUserId)`
    - `'timeout'` → `await adapter.timeoutUser(params.channelId, params.targetUserId, params.durationSeconds)`
    - `'delete'` → `await adapter.deleteMessage(params.channelId, params.messageId)`
  - Wrap in try/catch; re-throw structured errors so the webview receives them
  - Guard: if `params.platform === 'youtube'` → throw `{ code: 'UNSUPPORTED_PLATFORM' }`

  **Must NOT do**:
  - Do NOT call moderation methods directly on `BasePlatformAdapter` — cast to the specific adapter type
  - Do NOT make network calls in `getModerationRole` — it's purely local

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Glue code requiring understanding of both RPC system and adapter architecture
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6)
  - **Blocks**: Task 10
  - **Blocked By**: Tasks 1, 5, 6

  **References**:
  - `packages/desktop/src/bun/index.ts` — existing RPC handler registration; look at `getBroadcasterUserId` cast pattern (search for `as import('../platforms/kick/adapter')`) for how to cast adapters
  - `packages/desktop/src/shared/rpc.ts` — new types added in Task 1
  - `packages/desktop/src/store/account-store.ts` — `findByPlatform(platform)` usage pattern
  - `packages/desktop/src/platforms/twitch/adapter.ts` — `TwitchAdapter` class (Task 5)
  - `packages/desktop/src/platforms/kick/adapter.ts` — `KickAdapter` class (Task 6)

  **Acceptance Criteria**:
  - [ ] `grep "moderateMessage" packages/desktop/src/bun/index.ts` → match (handler registered)
  - [ ] `grep "getModerationRole" packages/desktop/src/bun/index.ts` → match
  - [ ] `grep "UNSUPPORTED_PLATFORM" packages/desktop/src/bun/index.ts` → match (youtube guard)
  - [ ] `bun run typecheck` passes

  **QA Scenarios**:

  ```
  Scenario: Both RPC handlers registered in bun/index.ts
    Tool: Bash
    Steps:
      1. grep -n "moderateMessage\|getModerationRole\|UNSUPPORTED_PLATFORM" packages/desktop/src/bun/index.ts
    Expected Result: All 3 patterns found
    Evidence: .sisyphus/evidence/task-7-rpc-handlers.txt
  ```

  **Commit**: YES (commit 6, groups with Task 1)
  - Message: `feat(desktop): add moderateMessage + getModerationRole RPC`
  - Files: `packages/desktop/src/shared/rpc.ts`, `packages/desktop/src/bun/index.ts`

- [ ] 8. `ContextMenu.vue` — new context menu component

  **What to do**:
  - Create `packages/desktop/src/views/main/components/ui/ContextMenu.vue`
  - Props:
    ```typescript
    props: {
      message: NormalizedChatMessage // to access author, text, id, platform
      isModerator: boolean // controls visibility of moderation section
    }
    emits: ['reply', 'close']
    ```
  - Use `reka-ui PopoverRoot/PopoverTrigger/PopoverContent` exactly as in `ChatAppearancePopover.vue`
  - Trigger: `<slot name="trigger" />` (so ChatMessage.vue can pass the ⋮ button as the trigger)
  - Menu structure:
    ```
    [Reply]
    [Copy message]
    [Copy username]
    ───────────── (separator, only when isModerator && platform !== 'youtube')
    [Delete message]   (only when isModerator)
    [Timeout ▶]       (only when isModerator — opens nested section with presets)
      · 1m  · 5m  · 10m  · 1h  · 1d
      · [custom input field — number in seconds, 1–1209600, submit on Enter/button]
    [Ban]              (only when isModerator)
    ```
  - Non-moderation actions (Reply, Copy message, Copy username) use emit/navigator.clipboard — NO RPC needed
  - Moderation actions call `rpc.request.moderateMessage({...})` and handle errors:
    - On `INSUFFICIENT_SCOPE` error → show inline error text "Re-authorize {platform} to enable moderation"
    - On `USER_PROTECTED` error → show "Cannot moderate this user"
    - On success → close popover
  - Timeout custom input: `<input type="number" min="1" max="1209600" />` with a "Timeout" confirm button
  - Style: match existing dropdown styles (reference `PanelNode.vue` for `.panel-menu-dropdown` CSS patterns)
  - Close on action: call `rpc.request.moderateMessage(...)` then set popover `open = false`

  **Must NOT do**:
  - Do NOT use the native `<contextmenu>` HTML API
  - Do NOT add moderation items when `message.platform === 'youtube'` or `message.type === 'system'`
  - Do NOT add a separate `TimeoutOptions.vue` component if inline suffices — keep it in this component
  - Do NOT add a "reason" input field

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Vue 3 SFC component with reka-ui primitives, layout, conditional rendering, CSS
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Covers reka-ui Popover patterns, component design, and Vue 3 SFC conventions for TwirChat

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 9)
  - **Blocks**: Task 10
  - **Blocked By**: Task 7 (needs RPC types to call `rpc.request.moderateMessage`)

  **References**:
  - `packages/desktop/src/views/main/components/ui/ChatAppearancePopover.vue` — EXACT reka-ui Popover pattern to follow (`PopoverRoot`, `PopoverTrigger`, `PopoverContent`, `PopoverArrow`)
  - `packages/desktop/src/views/main/components/PanelNode.vue` — dropdown CSS style reference (`.panel-menu-dropdown`, `menu-overlay` pattern)
  - `packages/desktop/src/views/main/components/ChatMessage.vue` — how `rpc.request.*` is called from webview; how `copyMessage` uses `navigator.clipboard`; how `emit('reply', message)` works
  - `packages/desktop/src/shared/rpc.ts` (after Task 1) — `moderateMessage` and `getModerationRole` RPC signatures
  - `packages/shared/types.ts` — `NormalizedChatMessage` type for props

  **Acceptance Criteria**:
  - [ ] File `packages/desktop/src/views/main/components/ui/ContextMenu.vue` exists
  - [ ] `grep "moderateMessage\|PopoverRoot\|isModerator" packages/desktop/src/views/main/components/ui/ContextMenu.vue` → 3 matches
  - [ ] `grep "youtube\|system" packages/desktop/src/views/main/components/ui/ContextMenu.vue` → moderation section guarded
  - [ ] `bun run typecheck` passes

  **QA Scenarios**:

  ```
  Scenario: ContextMenu.vue exists with correct structure
    Tool: Bash
    Steps:
      1. ls packages/desktop/src/views/main/components/ui/ContextMenu.vue
      2. grep -c "PopoverRoot\|isModerator\|moderateMessage\|Copy message\|Copy username\|Reply\|Ban\|Timeout\|Delete" packages/desktop/src/views/main/components/ui/ContextMenu.vue
    Expected Result: File exists; all 9 patterns found
    Evidence: .sisyphus/evidence/task-8-context-menu-structure.txt

  Scenario: Menu does not show moderation for YouTube/system
    Tool: Bash
    Steps:
      1. grep -A 2 "youtube\|system" packages/desktop/src/views/main/components/ui/ContextMenu.vue
    Expected Result: moderation section is conditionally blocked for youtube/system
    Evidence: .sisyphus/evidence/task-8-platform-guard.txt
  ```

  **Commit**: YES (commit 7)
  - Message: `feat(desktop): add ContextMenu.vue with moderation actions`
  - Files: `packages/desktop/src/views/main/components/ui/ContextMenu.vue`

- [ ] 9. Fill `moderation.test.ts` — make tests pass (GREEN phase)

  **What to do**:
  - Open `packages/desktop/tests/moderation.test.ts` (created in Task 4)
  - Import `TwitchAdapter` and `KickAdapter` (now implemented in Tasks 5 + 6)
  - Mock `fetch` using `spyOn(global, 'fetch')` or Bun's mock patterns
  - Fill in test implementations to make all RED tests pass:

  **Tests to implement**:
  1. `TwitchAdapter.banUser()` — mock fetch returns `{status: 200, ok: true}` → resolves void
  2. `TwitchAdapter.timeoutUser(channelId, userId, 300)` — mock POST with `duration: 300` in body → resolves void
  3. `TwitchAdapter.deleteMessage()` — mock DELETE to `/helix/moderation/chat` → resolves void
  4. `TwitchAdapter` 403 error — mock returns `{status: 403}` → rejects with `{ code: 'INSUFFICIENT_SCOPE' }`
  5. `TwitchAdapter` anonymous guard — adapter in anonymous mode → rejects with `{ code: 'NOT_AUTHENTICATED' }`
  6. `KickAdapter.banUser()` — mock POST → resolves void
  7. `KickAdapter.timeoutUser(channelId, userId, 3600)` — verify fetch called with `duration: 60` (3600s → 60min)
  8. `KickAdapter.deleteMessage(channelId, 'msg-123')` — verify DELETE to `.../chat/msg-123`
  - Look at existing test patterns in `packages/desktop/tests/aggregator.test.ts`

  **Must NOT do**:
  - Do NOT test Vue components with bun:test
  - Do NOT make real HTTP calls — mock all `fetch` calls

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Filling in pre-stubbed tests with mock implementations
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 8)
  - **Blocks**: F2
  - **Blocked By**: Tasks 4, 5, 6

  **References**:
  - `packages/desktop/tests/moderation.test.ts` — stubs from Task 4 (modify in-place)
  - `packages/desktop/tests/aggregator.test.ts` — bun:test mock and spy patterns
  - `packages/desktop/src/platforms/twitch/adapter.ts` (Task 5) — class under test
  - `packages/desktop/src/platforms/kick/adapter.ts` (Task 6) — class under test

  **Acceptance Criteria**:
  - [ ] `bun test packages/desktop/tests/moderation.test.ts` → PASS (0 failures, ≥ 8 tests)
  - [ ] Tests cover: Twitch ban, Twitch timeout, Twitch delete, Twitch 403, Twitch anonymous guard, Kick ban, Kick timeout (with minutes conversion), Kick delete

  **QA Scenarios**:

  ```
  Scenario: All moderation tests pass (GREEN phase)
    Tool: Bash
    Steps:
      1. bun test packages/desktop/tests/moderation.test.ts --reporter=verbose 2>&1
    Expected Result: All tests PASS, 0 failures, ≥ 8 tests
    Evidence: .sisyphus/evidence/task-9-tests-green.txt
  ```

  **Commit**: YES (commit 9)
  - Message: `test(desktop): implement moderation tests (GREEN phase)`
  - Files: `packages/desktop/tests/moderation.test.ts`

- [ ] 10. `ChatMessage.vue` — integrate `⋮` button + `ContextMenu`

  **What to do**:
  - Open `packages/desktop/src/views/main/components/ChatMessage.vue`
  - Add a module-level cache: `const moderationRoleCache = new Map<string, 'broadcaster' | 'none'>()`
  - Add composable setup:
    ```typescript
    const isModerator = ref(false)
    onMounted(async () => {
      if (props.message.platform === 'youtube' || props.message.type === 'system') return
      const cached = moderationRoleCache.get(props.message.platform)
      if (cached !== undefined) {
        isModerator.value = cached === 'broadcaster'
        return
      }
      const role = await rpc.request.getModerationRole({ platform: props.message.platform })
      moderationRoleCache.set(props.message.platform, role)
      isModerator.value = role === 'broadcaster'
    })
    ```
  - Add `ContextMenu` import: `import ContextMenu from './ui/ContextMenu.vue'`
  - In the hover button area (where `copy-btn` and `reply-btn` are rendered), add:
    ```html
    <ContextMenu :message="message" :isModerator="isModerator" @reply="onReply">
      <template #trigger>
        <button class="action-btn dots-btn" title="More actions">⋮</button>
      </template>
    </ContextMenu>
    ```
  - Add CSS for `.dots-btn` consistent with existing `.copy-btn` / `.reply-btn` styles
  - Existing `copy-btn` and `reply-btn` functionality stays unchanged (do NOT remove them)
  - Do NOT add `@contextmenu` handler to the message root div

  **Must NOT do**:
  - Do NOT remove existing hover copy/reply buttons
  - Do NOT add `@contextmenu.prevent` to the message root — use the `⋮` button trigger
  - Do NOT show `⋮` button on `type === 'system'` messages
  - Do NOT call `getModerationRole` on every render — cache in module-level `Map`

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Vue 3 SFC integration, refs, conditional rendering, CSS positioning
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Vue 3 component composition patterns, onMounted, ref, import conventions

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (sequential — final integration)
  - **Blocks**: F1, F2, F3, F4
  - **Blocked By**: Tasks 7, 8

  **References**:
  - `packages/desktop/src/views/main/components/ChatMessage.vue` — existing hover buttons section (`.copy-btn`, `.reply-btn`); existing `onMounted`/`rpc.request` usage pattern; `showCopyButton` pattern for hover state
  - `packages/desktop/src/views/main/components/ui/ContextMenu.vue` (Task 8) — component to import
  - `packages/desktop/src/shared/rpc.ts` (Task 1) — `getModerationRole` RPC signature
  - `packages/shared/types.ts` — `NormalizedChatMessage.platform` and `.type` fields

  **Acceptance Criteria**:
  - [ ] `grep "ContextMenu\|isModerator\|getModerationRole" packages/desktop/src/views/main/components/ChatMessage.vue` → 3 matches
  - [ ] `grep "dots-btn\|⋮" packages/desktop/src/views/main/components/ChatMessage.vue` → match
  - [ ] `grep "moderationRoleCache" packages/desktop/src/views/main/components/ChatMessage.vue` → match (caching present)
  - [ ] `bun run typecheck` passes (vue-tsc)

  **QA Scenarios**:

  ```
  Scenario: ⋮ button appears on hover for Twitch/Kick messages
    Tool: Playwright (playwright skill)
    Preconditions: App running in dev mode (bun run dev:hmr), Twitch chat connected with messages
    Steps:
      1. Navigate to http://localhost:5173
      2. Hover over a Twitch message in the chat list
      3. Assert: element with class ".dots-btn" or text "⋮" is visible
      4. Click the ⋮ button
      5. Assert: PopoverContent with text "Copy message" is visible
      6. Assert: "Ban" text is visible if isModerator (or not visible if not authenticated)
    Expected Result: ⋮ appears on hover, menu opens on click with correct items
    Evidence: .sisyphus/evidence/task-10-hover-menu.png

  Scenario: No ⋮ button on system messages
    Tool: Playwright
    Preconditions: Chat has system messages visible
    Steps:
      1. Find a system message (type="system") in the DOM
      2. Hover over it
      3. Assert: NO element with class ".dots-btn" is present
    Expected Result: System messages have no ⋮ button
    Evidence: .sisyphus/evidence/task-10-no-system-menu.png

  Scenario: Copy message copies text to clipboard
    Tool: Playwright
    Preconditions: App running, chat has messages
    Steps:
      1. Hover a message, click ⋮
      2. Click "Copy message" in the menu
      3. Evaluate: navigator.clipboard.readText() in browser context
    Expected Result: Clipboard contains the message text
    Evidence: .sisyphus/evidence/task-10-copy-clipboard.txt
  ```

  **Commit**: YES (commit 8)
  - Message: `feat(desktop): integrate ContextMenu into ChatMessage.vue`
  - Files: `packages/desktop/src/views/main/components/ChatMessage.vue`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Read plan end-to-end. Verify: (1) `moderator:manage:banned_users` in `packages/backend/src/auth/twitch.ts`, (2) `moderation:ban` in `packages/backend/src/auth/kick.ts`, (3) `moderateMessage` RPC registered in both `rpc.ts` and `bun/index.ts`, (4) `ContextMenu.vue` exists, (5) `ChatMessage.vue` renders `⋮` button on hover, (6) `bun test tests/moderation.test.ts` passes, (7) NO moderation on `type=system` messages, (8) NO abstract moderation on `BasePlatformAdapter`. Search codebase with grep/read for each item.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run `bun run check` from monorepo root. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod code, `refreshTokenIfNeeded()` missing before API calls, adapter moderation methods declared as `abstract` (forbidden). Check AI slop: excessive comments, over-abstraction.
      Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Types [PASS/FAIL] | Tests [N pass/N fail] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (load `playwright` skill)
      Start app in dev mode. Use Playwright to: (1) hover over a Twitch message → assert `⋮` button appears, (2) click `⋮` → assert menu opens with Reply/Copy message/Copy username + moderation section, (3) click `Copy message` → assert clipboard contains message text (evaluate `navigator.clipboard.readText()`), (4) hover over a YouTube message → assert NO moderation section in menu, (5) hover over a system message → assert NO `⋮` button. Save screenshots to `.sisyphus/evidence/`.
      Output: `Scenarios [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
      For each task: diff `git log --oneline`, read actual changed files vs task spec. Verify: no unban UI added, no confirmation dialogs, no overlay changes, no moderation on YouTube/system messages. Check `YouTubeAdapter` was NOT modified. Flag any unaccounted changes.
      Output: `Tasks [N/N compliant] | Unaccounted changes [CLEAN/N] | VERDICT`

---

## Commit Strategy

```
commit 1: test(desktop): add moderation unit test stubs (TDD scaffolding)
commit 2: feat(backend): add moderation OAuth scopes for Twitch and Kick
commit 3: feat(desktop): add optional moderation interface to BasePlatformAdapter
commit 4: feat(desktop): cache broadcaster_id in TwitchAdapter.connect() + implement ban/timeout/delete
commit 5: feat(desktop): implement ban/timeout/delete in KickAdapter
commit 6: feat(desktop): add moderateMessage + getModerationRole RPC
commit 7: feat(desktop): add ContextMenu.vue with moderation actions
commit 8: feat(desktop): integrate ContextMenu into ChatMessage.vue
commit 9: test(desktop): implement moderation tests (GREEN phase)
```

---

## Success Criteria

### Verification Commands

```bash
# OAuth scopes present
grep "moderator:manage:banned_users" packages/backend/src/auth/twitch.ts
grep "moderation:ban" packages/backend/src/auth/kick.ts

# RPC registered
grep "moderateMessage" packages/desktop/src/shared/rpc.ts
grep "moderateMessage" packages/desktop/src/bun/index.ts

# Tests pass
bun test packages/desktop/tests/moderation.test.ts

# Full check
bun run check
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] `bun test` passes
- [ ] `bun run check` passes (typecheck + lint + format)
