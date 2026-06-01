# Desktop Rust User History Modal Restoration

## TL;DR

> **Summary**: Restore the old desktop user-card/history modal in `packages/desktop-rust` with parity plus bounded polish. Use the existing Rust protocol/storage parity, add TDD coverage first, then wire GPUI state, async loading, chat triggers, and `/user` command support.
> **Deliverables**:
>
> - Rust GPUI user-card modal with avatar, platform identity, alias display, Twitch/Kick metadata, and paginated local message history.
> - Right-click user-card trigger from chat rows and `/user <name>` command parity.
> - TDD tests for storage/protocol identity scoping, metadata mapping, modal state, triggers, stale async results, and smoke startup.
>   **Effort**: Medium
>   **Parallel**: YES - 4 waves
>   **Critical Path**: Task 1 -> Task 2 -> Task 4 -> Task 6 -> Final Verification

## Context

### Original Request

User reported that during the desktop application rewrite to Rust, the modal with user message history was lost. The old modal showed avatar, subscription timing/details, and message history. User asked to inspect the old desktop implementation and create a plan for adding this to `desktop-rust`.

### Interview Summary

- Scope: **Parity + polish**.
- Required platform metadata support: **Kick and Twitch**.
- Test strategy: **TDD**.
- YouTube: graceful fallback only; not required for metadata parity in this plan.
- Behavior source of truth: old Vue desktop implementation.

### Metis Review (gaps addressed)

- Define exact interaction parity, identity scoping, metadata fields, pagination, async stale-result handling, and executable acceptance criteria.
- Avoid scope creep into generic profile/moderation/account refactors.
- Use old Vue behavior as UX reference but implement idiomatic Rust/GPUI state and async patterns.
- Do not introduce browser E2E tooling; use existing Rust tests, UI contract tests, and smoke run.

### Oracle Review

- Phase 1 verdict: `VERDICT: GO`.
- Directives incorporated: split into TDD slices, pin exact Rust files, make `/user` and right-click parity requirements, keep click-on-author/avatar as optional polish only if old behavior confirms it, exclude YouTube metadata beyond graceful fallback.

## Work Objectives

### Core Objective

Restore old desktop user-card/history modal behavior in `desktop-rust` without changing unrelated chat, storage, backend, or account architecture.

### Deliverables

- Tests that fail before implementation and pass after implementation for:
  - user history pagination and identity scoping,
  - metadata serialization/mapping for Twitch and Kick,
  - modal open/close/loading/error/empty states,
  - right-click trigger and `/user` command routing,
  - stale async result protection.
- Rust runtime/service path for loading local history and backend user-card metadata.
- GPUI modal UI in `src/ui/components/user_card.rs` rendered from `src/ui/shell/app.rs`.
- Chat row trigger wiring in `src/ui/chat.rs` for modern and compact rows.
- `/user <display-or-login-or-id>` composer command interception in `AppState::queue_composer_send()` or the closest existing command parsing boundary.

### Definition of Done (verifiable conditions with commands)

- `cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check` exits 0.
- `cargo check --manifest-path packages/desktop-rust/Cargo.toml` exits 0.
- `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings` exits 0.
- `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_card -- --nocapture` exits 0 and writes evidence.
- `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features visual_user_card_and_popovers_match_vue -- --nocapture` exits 0.
- `cargo run --manifest-path packages/desktop-rust/Cargo.toml -- --smoke-exit-after-first-frame` exits 0 with no panic.

### Must Have

- Old Vue parity references:
  - `packages/desktop/src/views/main/components/UserContextMenu.vue:22-47` right-click opens `UserCardDialog`.
  - `packages/desktop/src/views/main/components/UserCardDialog.vue:37-44` loads metadata when open.
  - `packages/desktop/src/views/main/components/UserCardDialog.vue:241-350` renders avatar, platform identity, alias, metadata, and history panel.
  - `packages/desktop/src/views/main/components/UserChatHistoryPanel.vue:21-29` loads initial/older pages and scrolls older history.
  - `packages/desktop/src/views/main/composables/useUserChatHistory.ts:77-141` generation-guards async history loads.
  - `packages/desktop/src/views/main/composables/useUserCardMetadata.ts:26-60` supports only Twitch/Kick and generation-guards metadata loads.
- Rust reuse targets:
  - `packages/desktop-rust/src/storage/messages.rs:36-95` existing `MessageStore::get_by_user()` pagination.
  - `packages/desktop-rust/src/protocol/rpc.rs:83-96` existing cursor/page types.
  - `packages/desktop-rust/src/protocol/rpc.rs:171-180` existing `GetUserChatHistoryParams`.
  - `packages/desktop-rust/src/protocol/rpc.rs:335-338` request variants already include history/metadata.
  - `packages/desktop-rust/src/protocol/messages.rs:392-490` canonical metadata platform/status/request/response types.
  - `packages/desktop-rust/src/runtime/config.rs:132-142` use `RuntimeConfig::backend_request()` for authenticated backend HTTP calls.
  - `packages/desktop-rust/src/runtime/app.rs:85-90` expose runtime storage/config boundaries.
  - `packages/desktop-rust/src/ui/shell/app.rs:437-568` existing top-layer modal overlay pattern.
  - `packages/desktop-rust/src/ui/shell/app.rs:612-685` top-level render composition point.
  - `packages/desktop-rust/src/ui/chat.rs:1013-1260` chat row rendering and avatar/name locations.
  - `packages/desktop-rust/src/app_state/mod.rs:1242-1271` composer send boundary for `/user` interception.

### Must NOT Have

- No generic profile service beyond this user-card modal.
- No moderation actions, bans/timeouts, account-management changes, or unrelated chat rendering refactors.
- No storage schema migration unless a failing test proves current fields cannot support parity.
- No browser Playwright/E2E setup in this pass.
- No `unwrap()`/`expect()` in production Rust paths.
- No async task dropped without storing or detaching; stale async results must be ignored.
- No silent metadata/history errors; surface empty/error/retry states in modal and log where appropriate.

## Verification Strategy

> ZERO HUMAN INTERVENTION - all verification is agent-executed.

- Test decision: **TDD** with existing Rust `cargo test` framework.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.omo/evidence/task-{N}-{slug}.json` or `.omo/evidence/task-{N}-{slug}.txt`.
- No Playwright: repository has no browser E2E config for `desktop-rust`; use UI contract tests and smoke startup.
- Final user approval in the verification wave is a workflow handoff gate, not a task acceptance criterion; all technical pass/fail evidence must be produced by agents and commands before that handoff.

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. This feature has fewer total tasks due tight file coupling; Wave 2 is the main parallel wave after contracts are established.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 (TDD contracts and fixtures)
Wave 2: Task 2 (runtime/service), Task 3 (AppState command/modal state), Task 4 (component rendering) after Task 1
Wave 3: Task 5 (chat trigger wiring) and Task 6 (async load integration) after Tasks 2-4; Task 7 (polish/error/empty states) after Task 6
Wave 4: Task 8 (full verification/evidence consolidation) after Tasks 5-7

### Dependency Matrix (full, all tasks)

- Task 1: blocks Tasks 2-8.
- Task 2: blocked by Task 1; blocks Tasks 6-8.
- Task 3: blocked by Task 1; blocks Tasks 5-8.
- Task 4: blocked by Task 1; blocks Tasks 6-8.
- Task 5: blocked by Tasks 3-4; blocks Task 8.
- Task 6: blocked by Tasks 2-4; blocks Tasks 7-8.
- Task 7: blocked by Task 6; blocks Task 8.
- Task 8: blocked by Tasks 1-7.

### Agent Dispatch Summary (wave → task count → categories)

- Wave 1 → 1 task → `unspecified-high` with `rust-best-practices`.
- Wave 2 → 3 tasks → `unspecified-high`, `quick`, `visual-engineering` with `gpui`/`rust-best-practices`.
- Wave 3 → 3 tasks → `visual-engineering`, `unspecified-high`, `visual-engineering` with `gpui`.
- Wave 4 → 1 task → `unspecified-high`.

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Harden storage/protocol history contracts for user-card parity

  **What to do**:
  1. Following TDD, first add focused tests in `packages/desktop-rust/tests/storage.rs` named with `user_card_history_*` that insert fixture messages for:
     - Twitch user `twitch_user_123`, login/display `testviewer` / `TestViewer`, channel `twitch_channel_1`.
     - Kick user `kick_user_456`, login/display `kickviewer` / `KickViewer`, channel `kick_channel_1`.
     - Same display name on Twitch and Kick to prove no cross-platform leakage.
     - At least 5 messages per target, limit 2, newest page first, cursor page older next.
  2. Add metadata/history serde contract tests for `GetUserChatHistoryParams`, `UserChatHistoryPage`, `UserCardMetadataRequest`, and `UserCardMetadataResponse` using camelCase JSON matching the TypeScript contract.
  3. Run the new tests, then implement only the minimal fixes needed in `packages/desktop-rust/src/storage/messages.rs`, `packages/desktop-rust/src/protocol/rpc.rs`, or `packages/desktop-rust/src/protocol/messages.rs` so they pass. Existing code may already satisfy most assertions; still keep tests.
  4. Do not add UI modal tests here; each UI task below writes its failing UI tests first, then implementation.
  5. Do not add new dependencies; use existing `tempfile`, `serde_json`, and patterns already present in `tests/storage.rs`.

  **Must NOT do**:
  - Do not change production behavior except minimal storage/protocol fixes required by the new tests.
  - Do not add Playwright, insta, or snapshot dependencies.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: test contracts span storage, protocol, and UI contract files.
  - Skills: `rust-best-practices` - Use Rust testing/error-handling idioms.
  - Omitted: `gpui` - This task covers storage/protocol only, not GPUI UI composition.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: Tasks 2,3,4,5,6,7,8 | Blocked By: none

  **References**:
  - Pattern: `packages/desktop-rust/tests/storage.rs:84-101` - existing `get_by_user()` storage compatibility assertion.
  - API/Type: `packages/desktop-rust/src/protocol/rpc.rs:83-96` - history cursor/page response.
  - API/Type: `packages/desktop-rust/src/protocol/rpc.rs:171-180` - history request params.
  - API/Type: `packages/desktop-rust/src/protocol/messages.rs:392-490` - Twitch/Kick metadata request/response fields.

  **Acceptance Criteria**:
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_card_history -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_card_protocol -- --nocapture` exits 0.
  - [ ] `cargo check --manifest-path packages/desktop-rust/Cargo.toml` exits 0.

  **QA Scenarios**:

  ```
  Scenario: History pagination fixture proves newest-first cursor behavior
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml user_card_history_paginates_by_user -- --nocapture
    Expected: exit 0; first page contains newest two messages for twitch_user_123 only; second page contains next older two; cursor id matches the last returned row
    Evidence: .omo/evidence/task-1-user-card-history.json

  Scenario: Same display name on Twitch/Kick does not leak messages
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml user_card_history_scopes_platform_and_author -- --nocapture
    Expected: exit 0; Twitch page excludes Kick messages even when display names match
    Evidence: .omo/evidence/task-1-user-card-history-scope.json
  ```

  **Commit**: NO | Message: `test(desktop-rust): add user card storage contracts` | Files: `packages/desktop-rust/tests/storage.rs`, `packages/desktop-rust/src/storage/messages.rs`, optional protocol test file

- [x] 2. Add Rust runtime/service path for history and Twitch/Kick metadata

  **What to do**:
  1. Add `packages/desktop-rust/src/services/user_card.rs` and export it from `packages/desktop-rust/src/services/mod.rs` if that module pattern is present.
  2. Implement pure helpers:
     - `get_user_chat_history(storage: &Storage, params: GetUserChatHistoryParams) -> StorageResult<UserChatHistoryPage>` delegating to `storage.messages().get_by_user(...)`.
     - `build_user_card_backend_request(storage: &Storage, request: UserCardMetadataRequest) -> UserCardMetadataBackendRequest` that adds `twitch_auth` only for Twitch when a connected Twitch account has token/scopes available; mirror old TypeScript behavior in `packages/desktop/src/bun/index.ts:505-538`.
     - `fetch_user_card_metadata(config: &RuntimeConfig, storage: &Storage, request: UserCardMetadataRequest) -> Result<UserCardMetadataResponse, UserCardServiceError>` using `RuntimeConfig::backend_request("/api/user-card-metadata")` and existing `reqwest` blocking client from `Cargo.toml:20-24`.
  3. Add `AppRuntime` methods in `packages/desktop-rust/src/runtime/app.rs`:
     - `load_user_chat_history(&self, params: GetUserChatHistoryParams) -> Result<UserChatHistoryPage, UserCardServiceError>`.
     - `fetch_user_card_metadata(&self, request: UserCardMetadataRequest) -> Result<UserCardMetadataResponse, UserCardServiceError>`.
  4. Error type must be explicit (`thiserror` is not available; implement `std::error::Error` + `Display` manually or use existing service/storage error style). No `unwrap()`/`expect()` in production.
  5. Do not implement direct Twitch/Kick API calls in Rust; call existing backend route to preserve old behavior and credentials.

  **Must NOT do**:
  - Do not create new protocol types that drift from `src/protocol/messages.rs`.
  - Do not fetch Twitch/Kick directly from GPUI render/update paths.
  - Do not change backend TypeScript code unless tests reveal a contract mismatch.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: runtime/service boundary with HTTP, storage, and error handling.
  - Skills: `rust-best-practices` - Avoid unwrap, model errors cleanly, limit clones.
  - Omitted: `gpui` - No UI rendering in this task.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Tasks 6,7,8 | Blocked By: Task 1

  **References**:
  - Pattern: `packages/desktop/src/bun/index.ts:496-538` - old desktop history and metadata handlers.
  - External API: `packages/backend/src/routes/user-card.ts:7-26` - backend endpoint and validation.
  - External API: `packages/backend/src/api/user-card-metadata.ts:270-385` - Kick/Twitch metadata semantics.
  - Pattern: `packages/desktop-rust/src/runtime/config.rs:132-142` - authenticated backend request URL/header builder.
  - Pattern: `packages/desktop-rust/src/runtime/app.rs:85-90` - runtime exposes storage/config.
  - API/Type: `packages/desktop-rust/src/storage/messages.rs:36-95` - local history pagination.

  **Acceptance Criteria**:
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_card_history -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_card_metadata_request_includes_twitch_auth -- --nocapture` exits 0.
  - [ ] `cargo check --manifest-path packages/desktop-rust/Cargo.toml` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Twitch metadata request includes broadcaster auth when available
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml user_card_metadata_request_includes_twitch_auth -- --nocapture
    Expected: exit 0; backend request contains twitchAuth.accessToken, twitchAuth.platformUserId, and scopes for Twitch only
    Evidence: .omo/evidence/task-2-twitch-auth.json

  Scenario: Kick metadata request never includes Twitch auth
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml user_card_metadata_request_omits_auth_for_kick -- --nocapture
    Expected: exit 0; backend request platform is kick and twitchAuth is None/null
    Evidence: .omo/evidence/task-2-kick-auth-fallback.json
  ```

  **Commit**: NO | Message: `feat(desktop-rust): add user card runtime service` | Files: `packages/desktop-rust/src/services/user_card.rs`, `packages/desktop-rust/src/services/mod.rs`, `packages/desktop-rust/src/runtime/app.rs`, tests

- [x] 3. Add AppState modal target/state and `/user` command routing

  **What to do**:
  1. In `packages/desktop-rust/src/app_state/mod.rs`, add public state structs/enums:
     - `UserCardTarget { platform, platform_user_id, channel_id, channel_slug, display_name, username, avatar_url, current_alias }`.
     - `UserCardLoadStatus<T> { Idle, Loading { generation }, Loaded(T), Error(String) }` or equivalent.
     - `UserCardModalState { open: bool, target: Option<UserCardTarget>, history, metadata, has_more, next_cursor, generation }`.
  2. Add `AppState` field `pub user_card: UserCardModalState` initialized in `Default`.
  3. Add methods:
     - `open_user_card(target)` increments generation, sets open true, clears stale history/metadata.
     - `close_user_card()` sets open false and increments generation so in-flight loads are ignored.
     - `start_user_card_load()`, `apply_user_card_history_result(generation, page)`, `apply_user_card_metadata_result(generation, result)`, `apply_user_card_error(...)`.
     - `resolve_user_card_target(query: &str) -> Option<UserCardTarget>` using current `messages`, `watched_channel_messages`, and connected account/channel context.
  4. In `queue_composer_send()` at `packages/desktop-rust/src/app_state/mod.rs:1242-1271`, intercept `/user <query>` before normal send. If resolved, call `open_user_card(target)` and return `true` so the composer clears; if unresolved, record a runtime/UI error message and return `false` or a new command result that lets the caller keep text. Use the simpler option that matches existing composer behavior and tests.
  5. Identity decision: resolve by exact author id first, then case-insensitive username, then case-insensitive display name. If multiple candidates match, choose the most recent message in the active scope; tests must cover this.

  **Must NOT do**:
  - Do not send `/user` text to chat backend.
  - Do not block UI while resolving from in-memory messages.
  - Do not persist modal state to SQLite.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: localized state/method changes once contracts exist.
  - Skills: `rust-best-practices` - Ownership/clone discipline and exhaustive state tests.
  - Omitted: `gpui` - This task is state, not rendering.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Tasks 5,6,7,8 | Blocked By: Task 1

  **References**:
  - Pattern: `packages/desktop/src/views/main/components/UserContextMenu.vue:7-16` - target fields passed into dialog.
  - Pattern: `packages/desktop-rust/src/app_state/mod.rs:56-87` - AppState field organization.
  - Pattern: `packages/desktop-rust/src/app_state/mod.rs:89-130` - default initialization.
  - Pattern: `packages/desktop-rust/src/app_state/mod.rs:1242-1271` - composer send interception point.
  - Guardrail: `packages/desktop-rust/AGENTS.md` - call `cx.notify()` after mutations via update blocks.

  **Acceptance Criteria**:
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_card_modal_state -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_command_opens_user_card -- --nocapture` exits 0.
  - [ ] `/user TestViewer` is covered by tests and never queues `DesktopToBackendMessage::SendMessage`.

  **QA Scenarios**:

  ```
  Scenario: /user opens most recent matching user card
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml user_command_opens_user_card -- --nocapture
    Expected: exit 0; AppState.user_card.open is true with twitch_user_123 target and no pending backend chat message
    Evidence: .omo/evidence/task-3-user-command.json

  Scenario: /user unknown does not send chat message
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml user_command_unknown_user_is_not_sent -- --nocapture
    Expected: exit 0; no backend send is queued and an error/feedback state is recorded
    Evidence: .omo/evidence/task-3-user-command-error.json
  ```

  **Commit**: NO | Message: `feat(desktop-rust): add user card modal state` | Files: `packages/desktop-rust/src/app_state/mod.rs`, tests

- [x] 4. Replace Rust user-card placeholder with GPUI modal component

  **What to do**:
  1. Replace `packages/desktop-rust/src/ui/components/user_card.rs:3-39` placeholder with idiomatic GPUI component/render helpers.
  2. Export the component from `packages/desktop-rust/src/ui/components/mod.rs`; if existing `pub mod user_card` is enough, add `pub use user_card::*;` only if local module conventions require it.
  3. Render modal sections matching old Vue:
     - Header: 72px avatar equivalent, fallback initials, display name, username/id subtitle, platform icon/pill, alias pill. Reference `UserCardDialog.vue:246-273` and styles `426-440`.
     - Metadata: title `Account metadata`, `Refresh`, supported/not supported/loading/error/retry states, rows for Account age, Follow age, Subscription duration, Sub age. Reference `UserCardDialog.vue:301-343`.
     - History: title `Chat logs`, subtitle `Stored local history for this user`, refresh, loading/error/empty/list/load older states. Reference `UserChatHistoryPanel.vue:34-70`.
  4. Use `img(ImageSource::from(...)).object_fit(ObjectFit::Cover).with_loading(...).with_fallback(...)` for avatars, matching GPUI image contract tested in `src/ui/tests.rs:85-99`.
  5. Provide pure formatting helpers for absolute dates, elapsed duration, subscription duration, and sub age. Mirror old semantics from `UserCardDialog.vue:64-214`.
  6. Include stable ids/text tokens in rendered output for contract tests: `user-card-modal`, `user-card-refresh-metadata`, `user-card-refresh-history`, `user-card-load-older`, `Loading metadata`, `No stored messages for this user yet.`, `Metadata is not supported for this platform yet.`

  **Must NOT do**:
  - Do not keep `history_expanded` toggle from placeholder; the modal always includes the history panel like old Vue.
  - Do not perform HTTP/storage access inside render functions.
  - Do not inline broad theme constants; use `crate::ui::theme` patterns from `chat.rs` and shell app.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: GPUI component construction and parity UI.
  - Skills: `gpui`, `rust-best-practices` - GPUI render/state separation and Rust helpers.
  - Omitted: `vue3-best-practices` - Vue is reference only; implementation is Rust/GPUI.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Tasks 5,6,7,8 | Blocked By: Task 1

  **References**:
  - Pattern: `packages/desktop/src/views/main/components/UserCardDialog.vue:241-350` - modal structure.
  - Pattern: `packages/desktop/src/views/main/components/UserCardDialog.vue:64-214` - date/duration text formatting behavior.
  - Pattern: `packages/desktop/src/views/main/components/UserChatHistoryPanel.vue:34-70` - history states/list.
  - Pattern: `packages/desktop-rust/src/ui/components/user_card.rs:3-39` - placeholder to replace.
  - Pattern: `packages/desktop-rust/src/ui/tests.rs:85-99` - GPUI remote image loading/fallback contract.
  - Pattern: `packages/desktop-rust/src/ui/shell/app.rs:450-568` - modal overlay style/composition.

  **Acceptance Criteria**:
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features visual_user_card_and_popovers_match_vue -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features gpui_images_use_loading_and_fallback_contracts -- --nocapture` exits 0.
  - [ ] `cargo check --manifest-path packages/desktop-rust/Cargo.toml` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Modal contract contains old Vue parity sections
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_user_card_and_popovers_match_vue -- --nocapture
    Expected: exit 0; user_card.rs contains/render helpers for header, metadata, history, refresh/retry/load older, and old parity labels
    Evidence: .omo/evidence/task-4-user-card-visual-contract.json

  Scenario: Missing avatar uses fallback instead of panic/blank
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml user_card_avatar_fallback_contract -- --nocapture
    Expected: exit 0; user_card.rs uses initials fallback and GPUI image loading/fallback hooks
    Evidence: .omo/evidence/task-4-avatar-fallback.json
  ```

  **Commit**: NO | Message: `feat(desktop-rust): render user card modal` | Files: `packages/desktop-rust/src/ui/components/user_card.rs`, `packages/desktop-rust/src/ui/components/mod.rs`, tests

- [x] 5. Wire chat-row right-click trigger and optional click polish

  **What to do**:
  1. Update `packages/desktop-rust/src/ui/chat.rs` so both modern and compact message rows can open a user card target through `AppState::open_user_card()`.
  2. Extend `ChatPanelProps` or `MessageRowOptions` as needed to pass `Entity<AppState>` into `message_row()`/`compact_message_row()` callbacks without global state leaks.
  3. Modern row:
     - Add right-click handler to avatar element around `chat.rs:1108-1157`.
     - Add right-click handler to author label around `chat.rs:1240-1246`.
  4. Compact row:
     - Add right-click handler to compact author custom part around `chat.rs:920-933`.
  5. Optional bounded polish: left-click may also open the modal only if it does not break text selection; if uncertain, implement right-click only and leave left-click out.
  6. Use target fields from `NormalizedChatMessage`: platform, author.id, author.display_name, author.username, author.avatar_url, channel_id, and derive `channel_slug` from current channel/account context only if already available.

  **Must NOT do**:
  - Do not make the entire message row clickable; preserve selectable message behavior.
  - Do not break hover, avatar image ids, badge ids, or compact layout tests.
  - Do not open cards for system messages.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: event wiring in GPUI chat UI.
  - Skills: `gpui` - Correct callbacks, event handling, state updates, `cx.notify()`.
  - Omitted: `rust-async-patterns` - No async in this task.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: Task 8 | Blocked By: Tasks 3,4

  **References**:
  - Pattern: `packages/desktop/src/views/main/components/UserContextMenu.vue:22-47` - old right-click trigger behavior.
  - Pattern: `packages/desktop-rust/src/ui/chat.rs:57-67` - list renders `message_row()`.
  - Pattern: `packages/desktop-rust/src/ui/chat.rs:824-1011` - compact message row.
  - Pattern: `packages/desktop-rust/src/ui/chat.rs:1013-1260` - modern message row avatar/author rendering.
  - Pattern: `packages/desktop-rust/src/ui/chat.rs:1707-1721` - local button callback pattern.

  **Acceptance Criteria**:
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_card_right_click_trigger -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features visual_chat_page_matches_vue_reference -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features compact_chat_uses_distinct_layout_without_avatar_branch -- --nocapture` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Right-click author opens modal target
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml user_card_right_click_trigger -- --nocapture
    Expected: exit 0; chat.rs contains right-click callbacks for avatar/author that call open_user_card with twitch_user_123 fields
    Evidence: .omo/evidence/task-5-right-click-trigger.json

  Scenario: System message never opens user card
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml user_card_trigger_ignores_system_messages -- --nocapture
    Expected: exit 0; system branch in message_row has no user-card trigger path
    Evidence: .omo/evidence/task-5-system-message-ignored.json
  ```

  **Commit**: NO | Message: `feat(desktop-rust): wire user card chat triggers` | Files: `packages/desktop-rust/src/ui/chat.rs`, tests

- [x] 6. Integrate async loading, refresh, pagination, and stale-result protection

  **What to do**:
  1. In `packages/desktop-rust/src/ui/shell/app.rs`, add fields to `TwirChatApp`:
     - `_user_card_history_task: Option<Task<()>>`
     - `_user_card_metadata_task: Option<Task<()>>`
     - any needed focus handle for modal close behavior.
  2. Initialize fields in `TwirChatApp::new()` near `tab_selector_open` fields at `app.rs:87-106`.
  3. Add methods:
     - `start_user_card_loads(&mut self, cx)` launches metadata and initial history loads when modal opens/target changes.
     - `refresh_user_card_metadata(&mut self, cx)`.
     - `refresh_user_card_history(&mut self, cx)`.
     - `load_older_user_card_history(&mut self, cx)` using `next_cursor`.
     - `close_user_card(&mut self, cx)`.
  4. Use `cx.background_spawn` or `cx.spawn` patterns consistent with existing runtime poll task at `app.rs:68-82`; store the returned `Task` in the new fields. Do not drop tasks silently.
  5. Each async completion must update `AppState` with generation guard so old responses are ignored, mirroring Vue `requestGeneration` in `useUserChatHistory.ts:65-141` and `useUserCardMetadata.ts:24-60`.
  6. Render modal from top-level shell after content and before toast, near `app.rs:682-685`, using `user_card` component and callbacks for close/refresh/load older.
  7. Update `observe_keystrokes()` so Escape closes user-card modal before tab selector/normal shortcuts, matching tab selector escape pattern at `app.rs:397-407`.

  **Must NOT do**:
  - Do not call blocking HTTP/storage on the render path.
  - Do not allow older async responses to overwrite a newer opened target.
  - Do not block tab selector or add-channel modal behavior.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: GPUI async lifecycle plus runtime/service integration.
  - Skills: `gpui`, `rust-async-patterns`, `rust-best-practices` - Task lifecycle, state updates, error handling.
  - Omitted: `vue3-best-practices` - Vue behavior already captured by references.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: Tasks 7,8 | Blocked By: Tasks 2,3,4

  **References**:
  - Pattern: `packages/desktop-rust/src/ui/shell/app.rs:68-82` - stored runtime poll task pattern.
  - Pattern: `packages/desktop-rust/src/ui/shell/app.rs:309-361` - keystroke interception.
  - Pattern: `packages/desktop-rust/src/ui/shell/app.rs:397-407` - Escape handling.
  - Pattern: `packages/desktop-rust/src/ui/shell/app.rs:682-685` - top-layer modal composition.
  - Pattern: `packages/desktop/src/views/main/composables/useUserChatHistory.ts:65-141` - generation guard for history.
  - Pattern: `packages/desktop/src/views/main/composables/useUserCardMetadata.ts:24-60` - generation guard for metadata.

  **Acceptance Criteria**:
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_card_async -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features modal_focus_and_escape_contract -- --nocapture` exits 0.
  - [ ] `cargo run --manifest-path packages/desktop-rust/Cargo.toml -- --smoke-exit-after-first-frame` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Stale metadata result is ignored after opening another user
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml user_card_async_ignores_stale_metadata -- --nocapture
    Expected: exit 0; generation N result does not overwrite generation N+1 target state
    Evidence: .omo/evidence/task-6-stale-metadata.json

  Scenario: Escape closes modal and cancels/invalidates loads
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml modal_focus_and_escape_contract -- --nocapture
    Expected: exit 0; Escape closes user-card modal and increments generation; tab selector Escape behavior still covered
    Evidence: .omo/evidence/task-6-escape-close.json
  ```

  **Commit**: NO | Message: `feat(desktop-rust): load user card data asynchronously` | Files: `packages/desktop-rust/src/ui/shell/app.rs`, `packages/desktop-rust/src/app_state/mod.rs`, tests

- [x] 7. Add bounded polish: empty/error states, load older, and accessible close behavior

  **What to do**:
  1. In `user_card.rs`, ensure each old Vue state has a visible Rust equivalent:
     - Unsupported platform: `Metadata is not supported for this platform yet.`
     - Metadata loading: `Loading metadata…`
     - Metadata error: error text plus `Retry`.
     - History loading: `Loading messages…`
     - History empty: `No stored messages for this user yet.`
     - History older loading: `Loading older messages…`
     - History has more: `Load older` button (use explicit button instead of scroll-trigger, because GPUI list virtualization/scroll trigger is not established for this modal yet).
  2. Close behavior:
     - `Close` button in modal footer/header.
     - Escape closes via Task 6 wiring.
     - Overlay click may close only if there is an existing safe GPUI pattern; otherwise do not implement overlay-click close.
  3. Date/duration text:
     - Account age: `Created <date>`.
     - Follow age: `Following since <date> · <elapsed>` when elapsed can be computed.
     - Subscription duration: `Currently subscribed · Tier <tier> · Gifted by <gifter> · <message>` when fields exist; otherwise old messages.
     - Sub age: `<N> month(s)`.
  4. Add tests for non-ASCII display names, missing avatar, API error, no history, and same display name on different platforms.

  **Must NOT do**:
  - Do not implement infinite scroll in this pass; use explicit `Load older` for deterministic QA.
  - Do not hide backend errors behind empty states.
  - Do not require manual visual inspection.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: final UI polish and state visibility.
  - Skills: `gpui`, `rust-best-practices` - Component states and helper tests.
  - Omitted: `rust-async-patterns` - Async wiring completed in Task 6.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: Task 8 | Blocked By: Task 6

  **References**:
  - Pattern: `packages/desktop/src/views/main/components/UserCardDialog.vue:318-343` - metadata state rows.
  - Pattern: `packages/desktop/src/views/main/components/UserChatHistoryPanel.vue:46-55` - history loading/error/empty/older states.
  - Pattern: `packages/desktop/src/views/main/components/UserCardDialog.vue:176-214` - subscription/sub age text.
  - Pattern: `packages/backend/src/api/user-card-metadata.ts:270-355` - Kick unavailable/subscribed messages.
  - Pattern: `packages/backend/src/api/user-card-metadata.ts:193-268` - Twitch subscription unavailable/current messages.

  **Acceptance Criteria**:
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_card_empty_error_states -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_card_formats_metadata_text -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_card_load_older -- --nocapture` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Metadata API error shows Retry, not empty state
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml user_card_metadata_error_shows_retry -- --nocapture
    Expected: exit 0; modal state renders supplied error text and Retry action token
    Evidence: .omo/evidence/task-7-metadata-error.json

  Scenario: Empty local history shows empty message
    Tool: Bash
    Steps: cargo test --manifest-path packages/desktop-rust/Cargo.toml user_card_empty_history_state -- --nocapture
    Expected: exit 0; modal renders No stored messages for this user yet and no Load older button
    Evidence: .omo/evidence/task-7-empty-history.json
  ```

  **Commit**: NO | Message: `feat(desktop-rust): polish user card modal states` | Files: `packages/desktop-rust/src/ui/components/user_card.rs`, `packages/desktop-rust/src/ui/shell/app.rs`, tests

- [x] 8. Run full desktop-rust verification and write evidence

  **What to do**:
  1. Run formatting/check/lint/test/smoke commands from repo root.
  2. Save command outputs or concise JSON summaries to `.omo/evidence/`:
     - `.omo/evidence/task-8-cargo-fmt.txt`
     - `.omo/evidence/task-8-cargo-check.txt`
     - `.omo/evidence/task-8-cargo-clippy.txt`
     - `.omo/evidence/task-8-cargo-test.txt`
     - `.omo/evidence/task-8-smoke.txt`
  3. If any command fails, fix only the feature-related cause and rerun the failing command before final verification.

  **Must NOT do**:
  - Do not run repository-wide Bun `fix` on source outside `desktop-rust`; this plan only mutates Rust feature files.
  - Do not mark complete if clippy warnings remain.
  - Do not skip smoke run.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: broad verification and evidence collection.
  - Skills: `rust-best-practices` - Interpret Rust errors and clippy output.
  - Omitted: `gpui` - No new UI design expected; verification only.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: Final Verification | Blocked By: Tasks 1-7

  **References**:
  - Commands: `packages/desktop-rust/README.md` verify section.
  - Commands: `packages/desktop-rust/AGENTS.md` validation section.
  - Test: `packages/desktop-rust/tests/storage.rs` - storage compatibility suite.
  - Test: `packages/desktop-rust/src/ui/tests.rs` - UI contract suite.

  **Acceptance Criteria**:
  - [ ] `cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check` exits 0.
  - [ ] `cargo check --manifest-path packages/desktop-rust/Cargo.toml` exits 0.
  - [ ] `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features` exits 0.
  - [ ] `cargo run --manifest-path packages/desktop-rust/Cargo.toml -- --smoke-exit-after-first-frame` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Full Rust verification passes
    Tool: Bash
    Steps: cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check && cargo check --manifest-path packages/desktop-rust/Cargo.toml && cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings && cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features
    Expected: all commands exit 0
    Evidence: .omo/evidence/task-8-cargo-test.txt

  Scenario: Desktop smoke start does not panic
    Tool: Bash
    Steps: cargo run --manifest-path packages/desktop-rust/Cargo.toml -- --smoke-exit-after-first-frame
    Expected: exit 0; first frame renders without panic
    Evidence: .omo/evidence/task-8-smoke.txt
  ```

  **Commit**: NO | Message: `feat(desktop-rust): restore user history modal` | Files: all changed `packages/desktop-rust/**` feature/test files

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE using agent-executed review, command output, and evidence files. Present consolidated results to user and get explicit "okay" before completing the workflow handoff.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Agent-Run Smoke/Contract QA — unspecified-high (`cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features` + `cargo run --manifest-path packages/desktop-rust/Cargo.toml -- --smoke-exit-after-first-frame`; no Playwright because none exists)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy

- Default: do not commit unless user explicitly asks.
- If committing is requested, use one atomic commit after verification: `feat(desktop-rust): restore user history modal`.
- Include only files under `packages/desktop-rust/**` unless a verified protocol mismatch requires backend/shared changes.

## Success Criteria

- User can open a user-card modal from chat rows via right-click and via `/user <name>`.
- Modal displays avatar/fallback, platform identity, alias if present, Twitch/Kick account/follow/subscription metadata, and local message history.
- History is scoped by platform + author id and does not leak across Kick/Twitch even with same display names.
- Metadata/history loading supports loading, empty, error, retry, refresh, load older, and stale-result protection.
- YouTube/unsupported platforms show graceful metadata fallback and still show local history when available.
- Full Rust verification and smoke startup pass with evidence in `.omo/evidence/`.
