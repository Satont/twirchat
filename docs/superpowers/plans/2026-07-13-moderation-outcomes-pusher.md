# Moderation Outcome Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render local and live socket-reported delete, timeout, and ban actions inline for Twitch and Kick chat messages.

**Architecture:** Native transports normalize a compact `ModerationOutcome` and publish it through one Wails event. A Vue session store resolves an outcome for each message without mutating message history. `ChatList` records successful local requests in the same store, and `ChatMessage` renders the shared status in both chat themes.

**Tech Stack:** Go, Wails v3 events, go-twitch-irc, Kick Pusher, Vue 3, TypeScript, Bun tests.

## Global Constraints

- Work in the current branch; do not create commits.
- Keep token and moderation API operations on native/backend sides.
- Use only the existing Kick Pusher `chatrooms.{id}.v2` connection; do not add EventSub.
- Treat Kick moderation frames as best-effort: invalid or unknown payloads must not alter UI state.
- Run `bun run fix`, `bun run lint`, `bun run typecheck`, Go tests, and workspace tests before handoff.

---

### Task 1: Normalize native moderation outcomes

**Files:**

- Modify: `packages/desktop/internal/contracts/models.go`
- Modify: `packages/desktop/internal/bridge/events.go`
- Modify: `packages/desktop/internal/platforms/twitch/service.go`
- Modify: `packages/desktop/internal/platforms/kick/service.go`
- Test: `packages/desktop/internal/platforms/twitch/service_test.go`
- Test: `packages/desktop/internal/platforms/kick/service_test.go`

**Interfaces:**

- Produces: `contracts.ModerationOutcome{Platform, ChannelID, Action, MessageID, TargetUserID, DurationSeconds}`.
- Produces: native Wails event `chat_moderation`.
- Consumes: Twitch `CLEARMSG` / `CLEARCHAT` and Kick Pusher deletion / user-ban frames.

- [ ] **Step 1: Write failing transport tests**

Add a Twitch fake-client callback test that expects a `delete_message` outcome
with `MessageID`, a timeout outcome with `TargetUserID` and seconds, and a ban
outcome without duration. Add Kick raw Pusher fixtures for
`App\\Events\\MessageDeletedEvent`, `App\\Events\\UserBannedEvent` with
`expires_at`, and malformed frames that expect no outcome.

- [ ] **Step 2: Run focused Go tests and confirm RED**

Run: `go test ./internal/platforms/twitch ./internal/platforms/kick`

Expected: compile or assertion failure because no moderation-outcome callback or
Pusher handling exists yet.

- [ ] **Step 3: Add the minimal native contract and publishers**

Define:

```go
type ModerationOutcome struct {
    Platform Platform `json:"platform"`
    ChannelID string `json:"channelId"`
    Action string `json:"action"`
    MessageID string `json:"messageId,omitempty"`
    TargetUserID string `json:"targetUserId,omitempty"`
    DurationSeconds int `json:"durationSeconds,omitempty"`
}
```

Add `EmitChatModeration` to the bridge publisher. Extend platform event
interfaces and adapters to emit only validated outcomes. Use `expires_at` to
derive a positive timeout duration; missing `expires_at` is a permanent ban.

- [ ] **Step 4: Run focused Go tests and confirm GREEN**

Run: `go test ./internal/platforms/twitch ./internal/platforms/kick`

Expected: all focused transport tests pass.

### Task 2: Make moderation outcome state testable in Vue

**Files:**

- Create: `packages/desktop/src/views/main/composables/useModerationOutcomes.ts`
- Modify: `packages/shared/types.ts`
- Modify: `packages/desktop/src/views/main/services/desktop-events.ts`
- Test: `packages/desktop/tests/moderation-outcomes.test.ts`

**Interfaces:**

- Produces: `createModerationOutcomeStore()` with `apply(outcome)` and
  `outcomeFor(message)`.
- Consumes: `ModerationOutcome` Wails event and ordinary
  `NormalizedChatMessage` values.

- [ ] **Step 1: Write the failing state tests**

Test that a deletion resolves only its message ID, while a timeout and ban
resolve messages from the matching platform, channel, and author. Test that a
later duplicate outcome leaves the same resolved value and that a malformed
duration is not treated as a timeout.

- [ ] **Step 2: Run the focused Bun test and confirm RED**

Run: `bun test tests/moderation-outcomes.test.ts`

Expected: failure because the store module is absent.

- [ ] **Step 3: Implement the session store and event DTO**

Expose a `ModerationOutcome` TypeScript type. Store deletions by platform and
message ID; store sanctions by platform, normalized channel, and target user.
Return display labels exactly as `(message deleted)`, `(timed out for …)`, and
`(banned)`.

- [ ] **Step 4: Run the focused Bun test and confirm GREEN**

Run: `bun test tests/moderation-outcomes.test.ts`

Expected: all outcome-state tests pass.

### Task 3: Render and apply outcomes

**Files:**

- Modify: `packages/desktop/src/views/main/App.vue`
- Modify: `packages/desktop/src/views/main/components/ChatList.vue`
- Modify: `packages/desktop/src/views/main/components/ChatMessage.vue`
- Test: `packages/desktop/tests/chat-moderation-outcome-render.test.ts`

**Interfaces:**

- Consumes: `useModerationOutcomes` and `chat_moderation` event.
- Produces: faded inline labels in compact and modern rows; rails are hidden
  once an outcome applies.

- [ ] **Step 1: Write the failing rendering test**

Assert that both template branches bind a moderation faded class and render the
outcome label, and that `ChatList` applies a successful local moderation action
to the shared store while receiving native `chat_moderation` in `App.vue`.

- [ ] **Step 2: Run the focused Bun test and confirm RED**

Run: `bun test tests/chat-moderation-outcome-render.test.ts`

Expected: failure because no outcome is passed to message rendering.

- [ ] **Step 3: Implement minimal visual integration**

Record an outcome after `moderateMessage` resolves. Subscribe once in `App.vue`
to `chat_moderation`. Pass the resolved outcome to `ChatMessage`, apply a faded
row class, show the label after message text, and suppress
`MessageModerationRail` for marked rows.

- [ ] **Step 4: Run the focused Bun test and confirm GREEN**

Run: `bun test tests/chat-moderation-outcome-render.test.ts`

Expected: the rendering and local-application test passes.

### Task 4: Format and verify the integrated feature

**Files:**

- Modify only files from Tasks 1–3 if formatting or test repair requires it.

- [ ] **Step 1: Apply project auto-fixes**

Run: `bun run fix`

Expected: formatter and safe lint fixes finish successfully.

- [ ] **Step 2: Verify all suites**

Run:

```bash
bun run test
bun run typecheck
bun run lint
bun run format:check
go test ./...
```

Expected: all commands exit zero; lint may report only pre-existing warnings
and no errors.

- [ ] **Step 3: Check the handoff diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and no commit created.

## Plan Self-Review

- Coverage: Task 1 handles both active native transports, Task 2 isolates the
  session state, Task 3 joins local and external paths in both themes, and Task
  4 validates the repository.
- Placeholder scan: no deferred implementation steps or unspecified APIs.
- Type consistency: the Go `ModerationOutcome` JSON field names match the Vue
  event DTO and `NormalizedChatMessage` lookup fields.

The user approved this Pusher-only approach and prohibited commits.
