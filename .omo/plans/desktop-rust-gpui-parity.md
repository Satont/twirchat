# Desktop Rust GPUI Parity Migration

## TL;DR

> **Summary**: Replace TwirChat's Electrobun + Vue desktop runtime with a full native Rust + GPUI desktop in `packages/desktop-rust`, preserving one-to-one functionality and exact UI parity from `packages/desktop`. Keep the OBS overlay as a Vue/browser-served sublayer, but move its runtime communication to Rust WebSocket services and add delivery/build integration.
> **Deliverables**:
>
> - Rust-native desktop runtime: storage, OAuth, platform adapters, backend WS, overlay WS, watched channels, chat aggregation/history, settings/hotkeys.
> - GPUI main window matching Vue UI: shell, chat, events, platforms, settings, watched split layouts, dialogs, popovers, autocomplete, emote picker, user card/history.
> - Vue overlay sublayer served/delivered by Rust with existing OBS URL/query behavior preserved.
> - Fixture, protocol, storage, visual, performance, and agent QA evidence.
> - Automatic conventional commits after every accepted implementation slice.
>   **Effort**: XL
>   **Parallel**: YES - 7 waves
>   **Critical Path**: Task 1 → Task 2 → Task 3/4/5 → Task 6/7/8/9 → UI/runtime parity tasks → Task 24 → Task 25 → Final Verification

## Context

### Original Request

- Existing desktop app: `packages/desktop/` Electrobun + Vue.
- Prototype replacement: `packages/desktop-rust/` Rust + GPUI.
- Create a plan to port everything one-to-one: hidden pages, popups, behaviors, settings, and exact UI.
- Use CSS variables/style sources from Vue and translate layout/styling to GPUI.
- Include `gpui`, `rust-best-practices`, and `rust-async-patterns` skills.
- Work must happen on branch `feat/refactor-desktop-gpui`; do not use a worktree.
- Performance matters, but never over feature parity.
- Automatically commit every accepted implementation phase/slice so progress is not lost.

### Interview Summary

- Runtime decision: full native Rust desktop services; no temporary Bun desktop sidecar.
- Architecture decision: `packages/desktop-rust` has no internal webview or Electrobun-style RPC boundary. GPUI UI and desktop runtime live in one native process; shared/RPC contracts remain only for backend/overlay/external boundaries or parity/reference checks.
- Overlay decision: OBS overlay remains Vue/browser-served, but Rust owns the WebSocket/backend delivery layer and build packaging path.
- Test decision: tests-after; every task includes implementation plus verification/QA.
- Packaging/updater: actual packaging/updater parity happens after core parity stabilization, but update-toast UI/state behavior remains in scope.
- Commit decision: every green, independently verifiable slice gets an automatic conventional commit.

### Metis Review (gaps addressed)

- Added a parity-contract freeze before implementation.
- Added commit guardrails: commit only after format/lint/type/test/QA pass; include task/wave ID in commit message.
- Added explicit storage/token compatibility, overlay ownership, startup/shutdown lifecycle, visual parity, and platform capability gates.
- Distinguished in-scope update-toast behavior from deferred installer/updater pipeline.
- Required agent-executable acceptance criteria and evidence files; no user manual QA.

## Work Objectives

### Core Objective

Ship `packages/desktop-rust` as a functionally equivalent Rust + GPUI replacement for the current desktop application while keeping `packages/desktop` as the canonical behavioral and visual reference until parity is proven.

### Deliverables

- `feat/refactor-desktop-gpui` branch created without worktree.
- Machine-readable parity matrix covering Vue components, stores, RPC, settings, hotkeys, platform features, overlay protocol, and failure states.
- Rust architecture split for GPUI UI, app state, async services, storage, protocol, platform adapters, overlay bridge, and tests.
- Rust equivalents for `packages/shared/types.ts`, `packages/shared/protocol.ts`, and `packages/desktop/src/shared/rpc.ts` contracts, kept only where they model external boundaries or parity/reference data — not as an internal GPUI runtime transport.
- SQLite/schema/token compatibility for current desktop data.
- Rust async service bus with cancellable lifecycle and safe GPUI context updates.
- Rust backend WebSocket bridge and overlay WebSocket server.
- Native Rust Twitch, YouTube, and Kick adapter capabilities matching current desktop; YouTube remains non-polling.
- GPUI UI parity for shell, chat, events, platforms, settings, watched layouts, dialogs, popovers, autocomplete, emote picker, user card/history, stream editor, and update toast.
- Vue overlay served as sublayer with Rust WS communication and convenient build/delivery.
- Fixture replay, screenshot parity, performance, and final review evidence.
- Conventional commits after every accepted task.

### Definition of Done (verifiable conditions with commands)

- Branch check: `git branch --show-current` outputs `feat/refactor-desktop-gpui`.
- Rust formatting: `cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check` exits 0.
- Rust linting: `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings` exits 0.
- Rust tests: `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features` exits 0.
- Desktop Vue reference still checks: `bun run --cwd packages/desktop typecheck` exits 0.
- Overlay build/delivery check: `bun run --cwd packages/desktop build:views` exits 0 and Rust overlay server serves `http://localhost:45823/` from built overlay assets.
- Parity matrix validator: `cargo run --manifest-path packages/desktop-rust/Cargo.toml --bin parity-check -- packages/desktop-rust/parity/desktop-parity-matrix.json` exits 0.
- Visual parity suite: `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_parity -- --nocapture` writes screenshots/diffs under `.sisyphus/evidence/visual/` and exits 0.
- Fixture replay: `cargo test --manifest-path packages/desktop-rust/Cargo.toml fixture_replay -- --nocapture` writes `.sisyphus/evidence/fixture-replay.json` and exits 0.
- Performance burst test: `cargo test --manifest-path packages/desktop-rust/Cargo.toml chat_burst_performance -- --nocapture` writes `.sisyphus/evidence/performance/chat-burst.json` with no dropped messages and no UI-thread blocking assertion failures.
- Git state: `git status --short` has no uncommitted implementation changes after every committed task.

### Must Have

- Vue desktop behavior in `packages/desktop` is canonical until Rust parity is proven.
- No UX redesign, no renamed pages, no removed behavior.
- All hidden states are covered: empty, loading, error, hover, focused, selected, modal, popover, autocomplete, drag/drop, split panes, reconnect, auth failure.
- GPUI state updates happen through GPUI-safe contexts/entities; async services never mutate UI state off-context.
- Every service has graceful startup, reconnect/backoff where relevant, cancellation, and shutdown.
- Existing user data is protected; tests use copied fixture DBs, never a live user DB.
- YouTube chat remains non-polling.
- OBS overlay URL compatibility remains: `http://localhost:45823/?bg=transparent&fontSize=14&...`.
- Every accepted slice is committed automatically.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- MUST NOT use a git worktree.
- MUST NOT introduce a temporary Bun desktop sidecar for runtime services.
- MUST NOT keep or introduce an internal webview/RPC runtime layer inside `packages/desktop-rust`; no Electrobun-style `BunRequests`/`WebviewMessages` transport for the native GPUI app.
- MUST NOT commit secrets, `.env`, real tokens, live user DBs, or credentials.
- MUST NOT commit failing lint/type/test states unless the user explicitly asks for a WIP checkpoint.
- MUST NOT replace the Vue overlay with GPUI; OBS consumes a browser source.
- MUST NOT sacrifice feature parity for performance shortcuts.
- MUST NOT rely on human visual confirmation; use screenshot/perceptual diff evidence.
- MUST NOT use `unwrap()`/`expect()` in production Rust paths; tests may use them when the failure message is explicit.
- MUST NOT drop GPUI `Task`s/subscriptions silently; store or detach with logging.

## Verification Strategy

> ZERO HUMAN INTERVENTION - all verification is agent-executed.

- Test decision: tests-after. Each implementation task adds or updates tests after the slice is implemented.
- Rust framework: `cargo test`, `cargo clippy`, fixture tests, snapshot/screenshot harness added under `packages/desktop-rust/tests/` and/or crate test modules.
- Vue overlay framework: existing `bun run --cwd packages/desktop build:views` and targeted overlay smoke scripts added by tasks.
- QA policy: Every task has happy-path and failure/edge scenarios with evidence.
- Evidence root: `.sisyphus/evidence/task-{N}-{slug}.{ext}`.
- Commit policy: each task runs its verification gate before `git add` and `git commit`.

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 branch/baseline; Task 2 parity freeze; Task 3 architecture split; Task 4 contract/types; Task 5 storage compatibility.
Wave 2: Task 6 async lifecycle; Task 7 backend WS; Task 8 overlay bridge/build; Task 9 auth/platform foundation; Task 10 chat/emote/event domain.
Wave 3: Task 11 Twitch adapter; Task 12 YouTube adapter; Task 13 Kick adapter; Task 14 watched-channel runtime manager; Task 15 update/external-open/config parity.
Wave 4: Task 16 GPUI token/component foundation; Task 17 main shell/nav/update toast; Task 18 chat list/composer; Task 19 user card/context/history; Task 20 watched layouts.
Wave 5: Task 21 platforms/stream editor; Task 22 settings/hotkeys/overlay controls; Task 23 events page; Task 24 visual/fixture/performance hardening.
Wave 6: Task 25 packaging/updater stabilization plan execution after core parity is green.
Wave 7: Final Verification Wave F1-F4.

### Dependency Matrix (full, all tasks)

- Task 1 blocks every task.
- Task 2 blocks Tasks 3-25.
- Task 3 blocks Tasks 6-25.
- Task 4 blocks Tasks 6-15 and all UI tasks consuming typed domain data.
- Task 5 blocks Tasks 9, 14, 21, 22.
- Task 6 blocks Tasks 7-15.
- Task 7 blocks Tasks 10, 14, 23.
- Task 8 blocks Task 22 and overlay QA in Task 24.
- Task 9 blocks Tasks 11-13 and Task 21.
- Task 10 blocks Tasks 18, 19, 23, 24.
- Tasks 11-13 block real provider smoke gates in Task 24.
- Task 14 blocks Task 20.
- Task 15 blocks Task 17 and Task 25.
- Task 16 blocks Tasks 17-23.
- Task 17 blocks all GPUI page tasks.
- Task 18 blocks Tasks 19 and 24 chat visual parity.
- Task 20 blocks Task 24 watched-layout parity.
- Tasks 21-23 block Task 24 page parity.
- Task 24 blocks Task 25 and Final Verification.
- Task 25 blocks Final Verification only for post-stabilization packaging/updater acceptance.

### Agent Dispatch Summary (wave → task count → categories)

- Wave 1 → 5 tasks → deep, quick, ultrabrain.
- Wave 2 → 5 tasks → deep, ultrabrain.
- Wave 3 → 5 tasks → deep, ultrabrain.
- Wave 4 → 5 tasks → visual-engineering, deep.
- Wave 5 → 4 tasks → visual-engineering, deep, unspecified-high.
- Wave 6 → 1 task → deep.
- Wave 7 → 4 final review tasks → oracle, unspecified-high, unspecified-high, deep.

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Create Branch And Baseline Safety Gate

  **What to do**: Check current git state, create or switch to `feat/refactor-desktop-gpui` without using worktrees, record baseline command outputs, and verify existing desktop and Rust prototype commands before changes. Add a baseline evidence note under `.sisyphus/evidence/task-1-branch-baseline.md` only if the evidence directory policy allows generated evidence; otherwise store command output in the agent transcript and keep repo changes limited to implementation files.
  **Must NOT do**: Do not use `git worktree`; do not commit unrelated existing changes; do not touch `.env`, real DBs, secrets, or user-local artifacts.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: branch setup and baseline verification are mechanical but safety-critical.
  - Skills: [] - No domain skill needed.
  - Omitted: [`gpui`, `rust-best-practices`, `rust-async-patterns`] - No code design work in this task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [2-25] | Blocked By: []

  **References**:
  - Command source: project requirement from user - branch must be `feat/refactor-desktop-gpui`, no worktree.
  - Current Rust commands: `packages/desktop-rust/README.md` - documented `cargo run`, `cargo fmt`, `cargo check`, `cargo test` commands.
  - Current desktop commands: `packages/desktop/package.json` - `build:views`, `typecheck`, `test` scripts.

  **Acceptance Criteria**:
  - [ ] `git branch --show-current` outputs exactly `feat/refactor-desktop-gpui`.
  - [ ] `git status --short` has no unrelated staged files before implementation starts.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features` exits 0 or records the exact pre-existing failure in `.sisyphus/evidence/task-1-rust-baseline.md`.
  - [ ] `bun run --cwd packages/desktop typecheck` exits 0 or records the exact pre-existing failure in `.sisyphus/evidence/task-1-vue-baseline.md`.

  **QA Scenarios**:

  ```
  Scenario: Branch is correct and no worktree is used
    Tool: Bash
    Steps: Run `git branch --show-current`; run `git worktree list`; run `git status --short`.
    Expected: Current branch is `feat/refactor-desktop-gpui`; worktree list shows only the normal repository root; no unrelated files are staged.
    Evidence: .sisyphus/evidence/task-1-branch-baseline.md

  Scenario: Existing command failures are captured, not hidden
    Tool: Bash
    Steps: Run Rust and Vue baseline commands listed in Acceptance Criteria.
    Expected: Commands pass, or failures are recorded verbatim and classified as pre-existing baseline failures before any implementation edits.
    Evidence: .sisyphus/evidence/task-1-baseline-failures.md
  ```

  **Commit**: YES | Message: `chore(gpui): task-1 establish migration branch baseline` | Files: [`.sisyphus/evidence/task-1-*.md` if evidence is tracked; otherwise no commit if no repo files changed]

- [ ] 2. Freeze Parity Contract Matrix

  **What to do**: Create a machine-readable parity matrix at `packages/desktop-rust/parity/desktop-parity-matrix.json` plus a validator binary `packages/desktop-rust/src/bin/parity-check.rs`. The matrix must enumerate every Vue component, store, composable, RPC request/message, settings key, hotkey, platform capability, overlay query parameter/event, modal/popover, and failure state discovered from `packages/desktop`. Treat each row as required unless marked `deferred_packaging_updater` for installer/updater pipeline only.
  **Must NOT do**: Do not mark a behavior out of scope because it is hidden from screenshots; do not use vague row names like `misc UI`; do not omit failure states.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: requires exhaustive inventory and schema design.
  - Skills: [`gpui`, `rust-best-practices`] - GPUI parity rows and Rust validator quality.
  - Omitted: [`rust-async-patterns`] - No async implementation yet.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [3-25] | Blocked By: [1]

  **References**:
  - Pattern: `packages/desktop/src/views/main/App.vue:37-805` - root shell, page routing, modals, update toast.
  - Pattern: `packages/desktop/src/views/main/components/ChatList.vue:1-559` - chat surface.
  - Pattern: `packages/desktop/src/views/main/components/ChatInput.vue:1-724` - composer/autocomplete/emote picker.
  - Pattern: `packages/desktop/src/views/main/components/PlatformsPanel.vue:1-841` - auth/platform/stream editor flows.
  - Pattern: `packages/desktop/src/views/main/components/SettingsPanel.vue:1-811` - settings/hotkeys/overlay controls.
  - Pattern: `packages/desktop/src/shared/rpc.ts:63-260` - UI/backend contract.
  - Pattern: `packages/desktop/src/bun/index.ts:136-1179` - desktop runtime integration.
  - Pattern: `packages/desktop/src/overlay-server.ts:64-240` - overlay server behavior.
  - Current gap: `packages/desktop-rust/src/ui/shell/app.rs`, `src/ui/*.rs`, and `src/app_state/mock_data.rs` - prototype shell exists, but parity inventory still needs to drive the authoritative surface list.

  **Acceptance Criteria**:
  - [ ] `packages/desktop-rust/parity/desktop-parity-matrix.json` exists and validates with `cargo run --manifest-path packages/desktop-rust/Cargo.toml --bin parity-check -- packages/desktop-rust/parity/desktop-parity-matrix.json`.
  - [ ] Matrix contains rows for `App.vue`, `ChatList.vue`, `ChatInput.vue`, `ChatMessage.vue`, `UserCardDialog.vue`, `EventsFeed.vue`, `PlatformsPanel.vue`, `SettingsPanel.vue`, `WatchedChannelsView.vue`, `SplitNode.vue`, `PanelNode.vue`, `ChannelTabBar.vue`, `AddChannelModal.vue`, `TabSelectorModal.vue`, `AutocompletePopup.vue`, `ChatAppearancePopover.vue`, `Tooltip.vue`, `EmotePicker.vue`, `overlay/App.vue`.
  - [ ] Matrix contains all RPC request/message names from `packages/desktop/src/shared/rpc.ts` with Rust owner module decisions.
  - [ ] Matrix contains explicit `in_scope`, `deferred_packaging_updater`, or `removed_with_reason` status for every row; `removed_with_reason` count is 0 unless backed by an explicit user requirement.

  **QA Scenarios**:

  ```
  Scenario: Matrix covers visible and hidden UI surfaces
    Tool: Bash
    Steps: Run `cargo run --manifest-path packages/desktop-rust/Cargo.toml --bin parity-check -- packages/desktop-rust/parity/desktop-parity-matrix.json`.
    Expected: Validator prints `parity matrix ok` and exits 0; report includes nonzero counts for components, stores, RPC, overlay, settings, hotkeys, platform capabilities, modals/popovers, and failure states.
    Evidence: .sisyphus/evidence/task-2-parity-matrix.json

  Scenario: Missing required row fails validation
    Tool: Bash
    Steps: Run validator against `packages/desktop-rust/parity/fixtures/missing-chat-input.json` created by this task.
    Expected: Validator exits nonzero and names `ChatInput.vue` as missing.
    Evidence: .sisyphus/evidence/task-2-parity-matrix-error.txt
  ```

  **Commit**: YES | Message: `chore(gpui): task-2 freeze desktop parity contract` | Files: [`packages/desktop-rust/parity/`, `packages/desktop-rust/src/bin/parity-check.rs`, `packages/desktop-rust/Cargo.toml`, `.sisyphus/evidence/task-2-*`]

- [ ] 3. Split Rust GPUI Prototype Into Production Architecture

  **What to do**: Refactor `packages/desktop-rust` from a monolithic visual shell into explicit modules: `ui`, `ui/components`, `ui/theme`, `app_state`, `services`, `protocol`, `storage`, `platforms`, `overlay`, `chat`, `settings`, `hotkeys`, and `tests/support`. Use GPUI `Entity<AppState>` for UI-owned state, service handles for IO, and typed events between services and UI. Preserve the current visual shell while moving code.
  **Must NOT do**: Do not implement feature parity yet; do not create speculative reusable framework beyond parity needs; do not drop current prototype visuals.

  **Recommended Agent Profile**:
  - Category: `ultrabrain` - Reason: foundational architecture affects every later task.
  - Skills: [`gpui`, `rust-best-practices`, `rust-async-patterns`] - GPUI ownership, idiomatic Rust modules, async boundaries.
  - Omitted: [] - All three skills are relevant.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [6-25] | Blocked By: [1, 2]

  **References**:
  - Current shell entry: `packages/desktop-rust/src/ui/shell/app.rs:1-42` - GPUI shell entry and entity ownership boundary.
  - Current state: `packages/desktop-rust/src/app_state/mod.rs:1-133` - `AppState` entity/update paths.
  - Current models: `packages/desktop-rust/src/models.rs:1-86` - move to domain modules.
  - GPUI skill: `gpui` rules `core-entity-operations`, `state-notify`, `anti-drop-task`.
  - Rust skill: `rust-best-practices` error handling and module boundaries.

  **Acceptance Criteria**:
  - [ ] `packages/desktop-rust/src/app.rs` remains a thin re-export/entry point while rendering logic lives under `src/ui/`.
  - [ ] `AppState` is a GPUI entity or entity-owned model with documented update paths and `cx.notify()` usage after state mutation.
  - [ ] `cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check` exits 0.
  - [ ] `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Refactored prototype still launches
    Tool: Bash
    Steps: Run `cargo run --manifest-path packages/desktop-rust/Cargo.toml -- --smoke-exit-after-first-frame`.
    Expected: Process logs `gpui first frame rendered` and exits 0 without panic.
    Evidence: .sisyphus/evidence/task-3-gpui-smoke.log

  Scenario: State update notifies UI
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml app_state_section_change_notifies_ui -- --nocapture`.
    Expected: Test observes a render notification after changing active section from Chat to Settings.
    Evidence: .sisyphus/evidence/task-3-state-notify.txt
  ```

  **Commit**: YES | Message: `refactor(gpui): task-3 split prototype architecture` | Files: [`packages/desktop-rust/src/`, `packages/desktop-rust/Cargo.toml`, `.sisyphus/evidence/task-3-*`]

- [ ] 4. Port Shared Types, RPC Contracts, And Fixture Codecs To Rust

  **What to do**: Implement Rust equivalents for shared desktop/domain contracts from `packages/shared/types.ts`, `packages/shared/protocol.ts`, and `packages/desktop/src/shared/rpc.ts`. Add serde codecs and JSON fixtures proving TypeScript-compatible shapes for accounts, settings, normalized chat messages/events, backend messages, desktop messages, RPC request/response payloads, watched layout data, stream status, and overlay payloads.
  **Must NOT do**: Do not hand-wave mismatches as `serde_json::Value` except inside test fixture diff tooling; do not rename fields unless serde aliases preserve compatibility.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: contract accuracy blocks all runtime and UI work.
  - Skills: [`rust-best-practices`] - Strong types, serde error handling, test design.
  - Omitted: [`gpui`, `rust-async-patterns`] - No UI/async behavior in this task.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [6-15, 18-24] | Blocked By: [1, 2]

  **References**:
  - API/Type: `packages/shared/types.ts:28` - normalized domain types.
  - API/Type: `packages/shared/protocol.ts:31` - backend/desktop protocol.
  - API/Type: `packages/desktop/src/shared/rpc.ts:63-260` - desktop UI RPC requests/messages.
  - Test Pattern: `packages/desktop-rust/src/models.rs:1-86` - replace placeholder models with typed domain models.

  **Acceptance Criteria**:
  - [ ] Rust contract modules exist under `packages/desktop-rust/src/protocol/` with serde derives and explicit error types.
  - [ ] Fixture files exist under `packages/desktop-rust/fixtures/protocol/` for every protocol family listed in the parity matrix.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml protocol_fixtures_round_trip -- --nocapture` exits 0 and writes `.sisyphus/evidence/task-4-protocol-fixtures.json`.
  - [ ] `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Known TypeScript-shaped message decodes in Rust
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml protocol_fixtures_round_trip -- --nocapture`.
    Expected: All fixture JSON files decode, re-encode, and structurally match expected snapshots.
    Evidence: .sisyphus/evidence/task-4-protocol-fixtures.json

  Scenario: Unknown protocol variant fails safely
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml protocol_unknown_variant_reports_error -- --nocapture`.
    Expected: Test returns typed protocol error containing the unknown variant name; no panic.
    Evidence: .sisyphus/evidence/task-4-protocol-error.txt
  ```

  **Commit**: YES | Message: `feat(protocol): task-4 port desktop contracts to rust` | Files: [`packages/desktop-rust/src/protocol/`, `packages/desktop-rust/fixtures/protocol/`, `packages/desktop-rust/Cargo.toml`, `.sisyphus/evidence/task-4-*`]

- [ ] 5. Implement SQLite Schema And Token Compatibility

  **What to do**: Port desktop storage to Rust: DB open/migrate, client secret, accounts, settings, aliases, watched channels, watched layout v2, chat history, and token encode/decode compatibility. Add tests using copied fixture DBs under `packages/desktop-rust/fixtures/db/`; never use a live user DB. Rust must read existing desktop DBs and either preserve token compatibility or force re-auth only through an explicit, tested migration state.
  **Must NOT do**: Do not mutate real `~/.twirchat` data in tests; do not silently discard unreadable tokens; do not delete accounts/settings on schema mismatch.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: user data safety and migration compatibility.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Error hierarchy, sync/async boundaries for DB work.
  - Omitted: [`gpui`] - No UI implementation except errors/events.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [9, 14, 21, 22] | Blocked By: [1, 2, 4]

  **References**:
  - Pattern: `packages/desktop/src/store/db.ts` - SQLite connection pattern.
  - Pattern: `packages/desktop/src/store/account-store.ts` - account persistence.
  - Pattern: `packages/desktop/src/store/settings-store.ts` - settings persistence.
  - Pattern: `packages/desktop/src/store/client-secret.ts:9` - persistent backend client secret.
  - Pattern: `packages/desktop/src/store/crypto.ts:64` - hostname-derived token encoding compatibility risk.
  - Pattern: `packages/desktop/src/store/watched-channels-layout-store.ts:5` - v2 tab layout, max 8 panels.

  **Acceptance Criteria**:
  - [ ] Rust storage modules exist under `packages/desktop-rust/src/storage/` with typed errors and migration tests.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml storage_reads_vue_fixture_db -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml storage_corrupt_db_recovers_safely -- --nocapture` exits 0.
  - [ ] Fixture DB tests assert accounts, settings, aliases, watched channels, layouts, chat history, client secret, and token states.

  **QA Scenarios**:

  ```
  Scenario: Existing desktop DB opens without data loss
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml storage_reads_vue_fixture_db -- --nocapture`.
    Expected: Test reports exact counts for accounts/settings/layouts/aliases/history and confirms fixture DB hash unchanged after read.
    Evidence: .sisyphus/evidence/task-5-storage-compat.json

  Scenario: Corrupt token produces reauth-required state
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml storage_corrupt_token_requires_reauth -- --nocapture`.
    Expected: Test returns `TokenState::ReauthRequired` with account preserved; no panic and no account deletion.
    Evidence: .sisyphus/evidence/task-5-token-error.json
  ```

  **Commit**: YES | Message: `feat(storage): task-5 preserve desktop data compatibility` | Files: [`packages/desktop-rust/src/storage/`, `packages/desktop-rust/fixtures/db/`, `packages/desktop-rust/Cargo.toml`, `.sisyphus/evidence/task-5-*`]

- [ ] 6. Build Async Service Bus And Lifecycle Runtime

  **What to do**: Add a Rust async runtime/service layer that owns startup, shutdown, cancellation, event ordering, reconnect policies, and safe UI delivery. Define typed commands/events between GPUI and services: auth, backend WS, platform adapters, watched channels, overlay, storage, chat, settings, update state. Store GPUI tasks/subscriptions correctly and route UI mutations through GPUI context/entity updates.
  **Must NOT do**: Do not mutate GPUI state from background threads; do not drop tasks silently; do not use unbounded spawning for live chat streams.

  **Recommended Agent Profile**:
  - Category: `ultrabrain` - Reason: concurrency architecture blocks runtime correctness.
  - Skills: [`gpui`, `rust-best-practices`, `rust-async-patterns`] - Entity updates, task lifecycle, cancellation/error handling.
  - Omitted: [] - All relevant.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [7-15] | Blocked By: [3, 4]

  **References**:
  - Pattern: `packages/desktop/src/backend-connection.ts:21-188` - reconnecting backend WS bridge behavior.
  - Pattern: `packages/desktop/src/bun/index.ts:271-359` - service initialization and adapter registration.
  - GPUI skill: `async-task-lifecycle`, `async-weak-entity`, `state-notify`, `anti-drop-task`.
  - Rust async skill: cancellation token, channels, `JoinSet`, backpressure.

  **Acceptance Criteria**:
  - [ ] `packages/desktop-rust/src/services/` contains typed `ServiceCommand`, `ServiceEvent`, lifecycle supervisor, cancellation token, and bounded channels.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml service_lifecycle_start_stop -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml service_bus_preserves_event_order -- --nocapture` exits 0.
  - [ ] Clippy has no `let_underscore_future`, no silent `Result` discard, and no production `unwrap()`.

  **QA Scenarios**:

  ```
  Scenario: Services start and stop cleanly
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml service_lifecycle_start_stop -- --nocapture`.
    Expected: Supervisor starts storage/backend/overlay/platform placeholders, cancels them, and reports `all services stopped`.
    Evidence: .sisyphus/evidence/task-6-lifecycle.json

  Scenario: Backpressure rejects overflow safely
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml service_bus_backpressure_reports_error -- --nocapture`.
    Expected: Bounded channel overflow returns a typed backpressure error and no events are reordered.
    Evidence: .sisyphus/evidence/task-6-backpressure.json
  ```

  **Commit**: YES | Message: `feat(runtime): task-6 add async service lifecycle` | Files: [`packages/desktop-rust/src/services/`, `packages/desktop-rust/Cargo.toml`, `.sisyphus/evidence/task-6-*`]

- [ ] 7. Implement Rust Backend WebSocket Bridge

  **What to do**: Replace Electrobun desktop's backend WS bridge with Rust code that authenticates using the persisted client secret, connects/reconnects to backend service, decodes all `BackendToDesktopMessage` variants, sends all `DesktopToBackendMessage` variants, and emits typed service events to GPUI/runtime. Include reconnect backoff, authentication failure, malformed message, and backend unavailable behavior.
  **Must NOT do**: Do not block the GPUI thread; do not ignore unknown backend messages; do not hardcode credentials.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: network protocol and auth bridge correctness.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Async WS handling and typed errors.
  - Omitted: [`gpui`] - Only service events cross UI boundary.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [10, 14, 23] | Blocked By: [4, 5, 6]

  **References**:
  - Pattern: `packages/desktop/src/backend-connection.ts:21-188` - current backend WS auth bridge.
  - API/Type: `packages/shared/protocol.ts:31` - backend/desktop message protocol.
  - Pattern: `packages/desktop/src/store/client-secret.ts:9` - client secret persistence.

  **Acceptance Criteria**:
  - [ ] Backend WS module exists under `packages/desktop-rust/src/services/backend_ws.rs`.
  - [ ] Mock backend tests cover connect, auth header/secret, message decode, outgoing commands, reconnect, malformed payload, and auth rejection.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml backend_ws_handles_all_protocol_variants -- --nocapture` exits 0.
  - [ ] Evidence includes handled variant counts equal to protocol fixture counts.

  **QA Scenarios**:

  ```
  Scenario: Mock backend sends all known messages
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml backend_ws_handles_all_protocol_variants -- --nocapture`.
    Expected: Every fixture under `packages/desktop-rust/fixtures/protocol/backend-to-desktop/` produces a typed service event and zero panics.
    Evidence: .sisyphus/evidence/task-7-backend-variants.json

  Scenario: Backend disconnect reconnects with bounded backoff
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml backend_ws_reconnects_after_disconnect -- --nocapture`.
    Expected: Test observes disconnect, backoff schedule, reconnect, and resubscription events in order.
    Evidence: .sisyphus/evidence/task-7-backend-reconnect.json
  ```

  **Commit**: YES | Message: `feat(runtime): task-7 port backend websocket bridge` | Files: [`packages/desktop-rust/src/services/backend_ws.rs`, `packages/desktop-rust/fixtures/protocol/`, `packages/desktop-rust/Cargo.toml`, `.sisyphus/evidence/task-7-*`]

- [ ] 8. Keep Vue Overlay Sublayer And Serve It From Rust

  **What to do**: Preserve the Vue overlay browser app in `packages/desktop/src/views/overlay`, but make Rust own the overlay HTTP/WebSocket server. Add Rust static serving for built overlay assets, query parameter compatibility, overlay WS payloads, broadcast from Rust chat events, reconnect behavior, and build/delivery script integration so `packages/desktop` overlay build output is copied or referenced by `packages/desktop-rust` deterministically.
  **Must NOT do**: Do not rewrite overlay in GPUI; do not break OBS browser-source URL; do not introduce HTTP polling.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: cross-stack build/runtime integration.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Rust HTTP/WS service and error handling.
  - Omitted: [`gpui`] - Overlay is browser-rendered, not GPUI.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [22, 24] | Blocked By: [4, 6, 10]

  **References**:
  - Pattern: `packages/desktop/src/overlay-server.ts:64-240` - current Bun overlay server.
  - Pattern: `packages/desktop/src/views/overlay/App.vue:202-311` - overlay transitions and query-driven display.
  - Config: `packages/desktop/vite.overlay.config.ts` - overlay build output.
  - Constant: `packages/shared/constants.ts` - `OVERLAY_SERVER_PORT=45823`.

  **Acceptance Criteria**:
  - [ ] Rust overlay server serves `http://localhost:45823/` and `/assets/*` from built Vue overlay output.
  - [ ] Overlay WS accepts browser clients and broadcasts normalized chat/event payloads from Rust service bus.
  - [ ] `bun run --cwd packages/desktop build:views` produces overlay assets consumed by Rust without manual copying steps beyond scripted task command.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml overlay_server_serves_vue_assets -- --nocapture` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Overlay browser asset route works
    Tool: Bash
    Steps: Run `bun run --cwd packages/desktop build:views`; run `cargo test --manifest-path packages/desktop-rust/Cargo.toml overlay_server_serves_vue_assets -- --nocapture`.
    Expected: Test receives HTTP 200 for `/`, HTTP 200 for one built `/assets/*` file, and correct `text/html`/asset content types.
    Evidence: .sisyphus/evidence/task-8-overlay-assets.json

  Scenario: Overlay WS reconnects after Rust server restart
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml overlay_ws_reconnect_contract -- --nocapture`.
    Expected: Mock overlay client connects, receives message, disconnects on restart, reconnects, and receives next message without loss after reconnect.
    Evidence: .sisyphus/evidence/task-8-overlay-reconnect.json
  ```

  **Commit**: YES | Message: `feat(overlay): task-8 serve vue overlay from rust` | Files: [`packages/desktop-rust/src/overlay/`, `packages/desktop-rust/Cargo.toml`, `packages/desktop/package.json`, `packages/desktop/src/views/overlay/`, `.sisyphus/evidence/task-8-*`]

- [ ] 9. Implement Auth And Platform Adapter Foundation

  **What to do**: Port OAuth/PKCE start/callback/logout foundations and define platform adapter traits for Twitch, YouTube, and Kick. Implement local callback server behavior, external browser open abstraction, account storage updates, adapter lifecycle, reconnect commands, and user-facing error events. Use this foundation for platform-specific tasks.
  **Must NOT do**: Do not implement provider-specific chat behavior here; do not store tokens in plaintext; do not silently swallow invalid PKCE state.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: security-sensitive auth and adapter boundary.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Error types, cancellation, local async server.
  - Omitted: [`gpui`] - UI consumes events later.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [11, 12, 13, 21] | Blocked By: [5, 6]

  **References**:
  - Pattern: `packages/desktop/src/auth/pkce.ts` - PKCE helpers.
  - Pattern: `packages/desktop/src/auth/server.ts` - local callback server behavior.
  - Pattern: `packages/desktop/src/auth/twitch.ts`, `packages/desktop/src/auth/youtube.ts`, `packages/desktop/src/auth/kick.ts` - provider flows.
  - Pattern: `packages/desktop/src/bun/index.ts:361-679` - RPC auth handlers and account operations.

  **Acceptance Criteria**:
  - [ ] `packages/desktop-rust/src/auth/` and `packages/desktop-rust/src/platforms/` contain provider-neutral auth/adapter traits.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml auth_pkce_round_trip -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml auth_invalid_state_rejected -- --nocapture` exits 0.
  - [ ] External browser open is abstracted behind a trait with test fake; production errors surface as service events.

  **QA Scenarios**:

  ```
  Scenario: OAuth callback success stores account
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml auth_callback_success_stores_account -- --nocapture`.
    Expected: Mock provider returns token, storage fixture gains account, and service emits `AuthSuccess`.
    Evidence: .sisyphus/evidence/task-9-auth-success.json

  Scenario: Invalid PKCE state is rejected
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml auth_invalid_state_rejected -- --nocapture`.
    Expected: Storage remains unchanged and service emits `AuthError::InvalidState`.
    Evidence: .sisyphus/evidence/task-9-auth-invalid-state.json
  ```

  **Commit**: YES | Message: `feat(auth): task-9 add rust auth adapter foundation` | Files: [`packages/desktop-rust/src/auth/`, `packages/desktop-rust/src/platforms/`, `packages/desktop-rust/Cargo.toml`, `.sisyphus/evidence/task-9-*`]

- [ ] 10. Port Chat, Event, Emote, Badge, And History Domain Logic

  **What to do**: Port normalized chat aggregation, dedupe, reply handling, deleted/moderated messages, emotes, badges, aliases, user chat history, backend metadata hooks, platform colors/icons, and event feed domain logic. Create high-volume fixture replay covering Twitch/YouTube/Kick messages and all display modes needed by GPUI and overlay.
  **Must NOT do**: Do not render UI in this task; do not lose message ordering or dedupe semantics; do not use HTTP polling for YouTube.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: core data correctness drives chat, events, overlay, and history.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Efficient data structures and service events.
  - Omitted: [`gpui`] - UI rendering comes later.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [18, 19, 23, 24] | Blocked By: [4, 6, 7]

  **References**:
  - Pattern: `packages/desktop/src/chat/aggregator.ts` - chat dedupe/aggregation.
  - Pattern: `packages/desktop/src/views/main/components/ChatMessage.vue:1-320` - required render data fields.
  - Pattern: `packages/desktop/src/views/main/composables/useUserChatHistory.ts:45-181` - paginated history behavior.
  - Pattern: `packages/desktop/src/views/main/composables/useUserCardMetadata.ts:7-95` - backend metadata behavior.
  - Pattern: `packages/desktop/src/views/main/stores/useAliasStore.ts:7-67` - alias persistence.

  **Acceptance Criteria**:
  - [ ] `packages/desktop-rust/src/chat/` contains aggregator, history, alias, emote/badge parsing, and event normalization modules.
  - [ ] Fixture replay covers at least Twitch, YouTube, Kick, replies, badges, emotes, self-ping, duplicate message, deletion/moderation, system/follow events, and high-volume burst.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml fixture_replay -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml chat_burst_preserves_order_and_dedupe -- --nocapture` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Chat fixture replay matches expected normalized output
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml fixture_replay -- --nocapture`.
    Expected: Replay output matches snapshots for ordering, dedupe, replies, emotes, badges, aliases, and event conversion.
    Evidence: .sisyphus/evidence/task-10-fixture-replay.json

  Scenario: Burst does not drop or reorder messages
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml chat_burst_preserves_order_and_dedupe -- --nocapture`.
    Expected: 10,000 fixture messages produce expected count, stable ordering, and bounded memory report.
    Evidence: .sisyphus/evidence/task-10-chat-burst.json
  ```

  **Commit**: YES | Message: `feat(chat): task-10 port message and event domain logic` | Files: [`packages/desktop-rust/src/chat/`, `packages/desktop-rust/fixtures/chat/`, `packages/desktop-rust/Cargo.toml`, `.sisyphus/evidence/task-10-*`]

- [ ] 11. Port Twitch Adapter Capabilities

  **What to do**: Implement Rust Twitch adapter capabilities matching current desktop: OAuth account use, chat read, send message, badges, emotes, stream status, category search/update stream metadata, watched channels, reconnect, and service events. Use mock Twitch HTTP/WS fixtures for deterministic tests and real-provider smoke tests only when credentials are available through safe environment configuration.
  **Must NOT do**: Do not require real credentials for normal CI/local tests; do not hardcode tokens; do not skip send-message error behavior.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: provider adapter with network, auth, and chat semantics.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Typed errors, async reconnect, fixture clients.
  - Omitted: [`gpui`] - UI handled later.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [21, 24] | Blocked By: [9, 10]

  **References**:
  - Pattern: `packages/desktop/src/platforms/twitch/adapter.ts` - current Twitch adapter behavior.
  - Pattern: `packages/desktop/src/auth/twitch.ts` - Twitch auth.
  - Pattern: `packages/backend/src/api/search-categories.ts` - Twitch category search implementation consumed by desktop RPC/backend fetch.
  - Pattern: `packages/backend/src/api/update-stream.ts` - stream metadata update implementation consumed by desktop RPC/backend fetch.

  **Acceptance Criteria**:
  - [ ] `packages/desktop-rust/src/platforms/twitch/` implements adapter trait methods for auth use, connect/disconnect, chat receive, send message, badges/emotes, stream status, category search, and stream update.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml twitch_adapter_mock_full_capability_matrix -- --nocapture` exits 0.
  - [ ] Failure tests cover auth expired, network timeout, rate limit, send failure, malformed message.

  **QA Scenarios**:

  ```
  Scenario: Twitch mock adapter full flow
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml twitch_adapter_mock_full_capability_matrix -- --nocapture`.
    Expected: Mock adapter authenticates, joins channel, receives chat, sends message, loads badges/emotes, searches category, updates stream metadata, and emits expected service events.
    Evidence: .sisyphus/evidence/task-11-twitch-full.json

  Scenario: Twitch expired token emits reauth state
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml twitch_adapter_expired_token_requires_reauth -- --nocapture`.
    Expected: Adapter stops affected connection, preserves account, emits `PlatformAuthState::ReauthRequired`, and does not retry indefinitely.
    Evidence: .sisyphus/evidence/task-11-twitch-expired-token.json
  ```

  **Commit**: YES | Message: `feat(twitch): task-11 port twitch adapter` | Files: [`packages/desktop-rust/src/platforms/twitch/`, `packages/desktop-rust/fixtures/platforms/twitch/`, `packages/desktop-rust/Cargo.toml`, `.sisyphus/evidence/task-11-*`]

- [ ] 12. Port YouTube Adapter With Non-Polling Chat

  **What to do**: Implement Rust YouTube adapter parity for auth, non-polling chat transport, send message if supported by current app, stream status, watched channels, reconnect, and service events. Preserve the project constraint: do not use HTTP polling for YouTube chat. Add fixtures for gRPC/event-stream-like message flow and failure cases.
  **Must NOT do**: Do not implement HTTP polling fallback; do not weaken non-polling requirement for convenience; do not omit reconnect/resubscribe tests.

  **Recommended Agent Profile**:
  - Category: `ultrabrain` - Reason: YouTube non-polling adapter is high-risk and provider-specific.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Streaming transport, cancellation, errors.
  - Omitted: [`gpui`] - UI handled later.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [21, 24] | Blocked By: [9, 10]

  **References**:
  - Pattern: `packages/desktop/src/platforms/youtube/adapter.ts` - current YouTube adapter.
  - Pattern: `packages/desktop/src/auth/youtube.ts` - YouTube auth.
  - Project guardrail: `AGENTS.md` - YouTube must not use HTTP polling.

  **Acceptance Criteria**:
  - [ ] `packages/desktop-rust/src/platforms/youtube/` implements non-polling chat receive flow and adapter trait methods.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml youtube_adapter_uses_non_polling_transport -- --nocapture` exits 0.
  - [ ] Static test or compile-time configuration prevents enabling HTTP polling code paths.
  - [ ] Failure tests cover auth expired, stream disconnect, malformed event, reconnect/resubscribe.

  **QA Scenarios**:

  ```
  Scenario: YouTube mock stream receives chat without polling
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml youtube_adapter_uses_non_polling_transport -- --nocapture`.
    Expected: Mock transport yields chat events through streaming API; test asserts zero calls to any polling client.
    Evidence: .sisyphus/evidence/task-12-youtube-non-polling.json

  Scenario: YouTube stream disconnect resubscribes
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml youtube_adapter_reconnects_and_resubscribes -- --nocapture`.
    Expected: Adapter emits disconnect, backoff, reconnect, resubscribe, and resumed message events in order.
    Evidence: .sisyphus/evidence/task-12-youtube-reconnect.json
  ```

  **Commit**: YES | Message: `feat(youtube): task-12 port non-polling adapter` | Files: [`packages/desktop-rust/src/platforms/youtube/`, `packages/desktop-rust/fixtures/platforms/youtube/`, `packages/desktop-rust/Cargo.toml`, `.sisyphus/evidence/task-12-*`]

- [ ] 13. Port Kick Adapter Capabilities

  **What to do**: Implement Rust Kick adapter parity for OAuth/account use, chat read, send message, chatroom lookup, stream status, webhook/event behavior represented in desktop, watched channels, reconnect, and service events. Use mock Kick fixtures and safe optional real smoke tests.
  **Must NOT do**: Do not require real Kick credentials for normal tests; do not omit chatroom ID lookup behavior; do not silently ignore webhook/event failures.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: provider integration and event semantics.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Async adapter and typed provider errors.
  - Omitted: [`gpui`] - UI handled later.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [21, 24] | Blocked By: [9, 10]

  **References**:
  - Pattern: `packages/desktop/src/platforms/kick/adapter.ts` - current Kick adapter.
  - Pattern: `packages/desktop/src/auth/kick.ts` - Kick auth.
  - Pattern: `packages/backend/src/api/kick-chatroom.ts` - Kick chatroom lookup implementation referenced by desktop flow.

  **Acceptance Criteria**:
  - [ ] `packages/desktop-rust/src/platforms/kick/` implements adapter trait methods for auth use, connect/disconnect, chat receive, send message, chatroom lookup, stream status, watched channels, and events.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml kick_adapter_mock_full_capability_matrix -- --nocapture` exits 0.
  - [ ] Failure tests cover auth failure, chatroom lookup missing, send failure, reconnect, malformed event.

  **QA Scenarios**:

  ```
  Scenario: Kick mock adapter full flow
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml kick_adapter_mock_full_capability_matrix -- --nocapture`.
    Expected: Mock adapter authenticates, resolves chatroom, receives chat, sends message, emits stream/event updates, and stores watched-channel state.
    Evidence: .sisyphus/evidence/task-13-kick-full.json

  Scenario: Kick missing chatroom is recoverable
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml kick_adapter_missing_chatroom_reports_error -- --nocapture`.
    Expected: Adapter emits a typed recoverable error shown later by UI; account and watched channel are not deleted.
    Evidence: .sisyphus/evidence/task-13-kick-missing-chatroom.json
  ```

  **Commit**: YES | Message: `feat(kick): task-13 port kick adapter` | Files: [`packages/desktop-rust/src/platforms/kick/`, `packages/desktop-rust/fixtures/platforms/kick/`, `packages/desktop-rust/Cargo.toml`, `.sisyphus/evidence/task-13-*`]

- [ ] 14. Port Watched Channels Runtime Manager

  **What to do**: Implement Rust watched-channel manager for tabs, active channel, per-channel adapter lifecycle, buffers, statuses, 7TV/emote subscriptions if present in current desktop, reconnect/resubscribe, layout assignments, and storage persistence. Enforce layout v2 constraints such as max 8 panels.
  **Must NOT do**: Do not implement UI drag/drop in this task; do not allow orphaned adapter tasks when channels are removed; do not exceed persisted layout constraints.

  **Recommended Agent Profile**:
  - Category: `ultrabrain` - Reason: coordinates platform adapters, storage, backend events, and UI state.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Ownership, cancellation, event routing.
  - Omitted: [`gpui`] - UI layout rendering later.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [20, 24] | Blocked By: [5, 6, 7, 11, 12, 13]

  **References**:
  - Pattern: `packages/desktop/src/watched-channels/manager.ts:1` - per-channel adapter/buffer/status/reconnect behavior.
  - Pattern: `packages/desktop/src/store/watched-channels-layout-store.ts:5` - v2 layout constraints.
  - Pattern: `packages/desktop/src/views/main/stores/layout.ts:16-320` - frontend layout state and persistence.

  **Acceptance Criteria**:
  - [ ] `packages/desktop-rust/src/watched_channels/` implements manager, tab model, panel assignment, layout persistence, and adapter lifecycle.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml watched_channels_manager_lifecycle -- --nocapture` exits 0.
  - [ ] Layout tests cover split, remove, assign, reorder, restore, max 8 panels, and invalid persisted layout recovery.

  **QA Scenarios**:

  ```
  Scenario: Watched channel manager starts and stops adapter tasks
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml watched_channels_manager_lifecycle -- --nocapture`.
    Expected: Adding channel starts adapter, removing channel cancels adapter, active tab updates, and no orphan tasks remain.
    Evidence: .sisyphus/evidence/task-14-watched-lifecycle.json

  Scenario: Invalid layout recovers safely
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml watched_channels_invalid_layout_recovers -- --nocapture`.
    Expected: Invalid fixture layout is repaired to a valid single-panel layout and original data is backed up in migration report.
    Evidence: .sisyphus/evidence/task-14-layout-recovery.json
  ```

  **Commit**: YES | Message: `feat(watched): task-14 port watched channels runtime` | Files: [`packages/desktop-rust/src/watched_channels/`, `packages/desktop-rust/fixtures/watched_channels/`, `.sisyphus/evidence/task-14-*`]

- [ ] 15. Port Update Toast State, External Open, And Runtime Config

  **What to do**: Implement non-packaging desktop runtime utilities needed by parity: runtime build/config values, external URL open abstraction, update availability/downloaded/error state events for UI toast parity, and startup config. Actual installer/updater pipeline remains deferred to Task 25.
  **Must NOT do**: Do not implement installer packaging in this task; do not call platform updater APIs without tests/fakes; do not remove update-toast UI behavior from scope.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: runtime utility behavior must replace Electrobun services safely.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Abstractions, test fakes, errors.
  - Omitted: [`gpui`] - UI toast rendering later.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [17, 25] | Blocked By: [6]

  **References**:
  - Pattern: `packages/desktop/src/bun/index.ts:47` - Electrobun `BrowserWindow`, `Updater`, `Utils.openExternal`, `BuildConfig` hidden dependencies.
  - Pattern: `packages/desktop/src/views/main/App.vue:291-515` - update toast state and interactions.

  **Acceptance Criteria**:
  - [ ] Runtime config/update/external-open modules exist under `packages/desktop-rust/src/runtime/`.
  - [ ] Test fakes cover external URL success/failure and update state transitions.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml runtime_update_state_transitions -- --nocapture` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Update state emits toast-compatible events
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml runtime_update_state_transitions -- --nocapture`.
    Expected: Fake updater emits available, downloading, downloaded, error, dismissed states matching UI contract snapshots.
    Evidence: .sisyphus/evidence/task-15-update-state.json

  Scenario: External URL failure is surfaced
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml runtime_open_external_failure_reports_error -- --nocapture`.
    Expected: Invalid URL returns typed error and service event; no panic.
    Evidence: .sisyphus/evidence/task-15-open-external-error.json
  ```

  **Commit**: YES | Message: `feat(runtime): task-15 add config update and external open parity` | Files: [`packages/desktop-rust/src/runtime/`, `.sisyphus/evidence/task-15-*`]

- [ ] 16. Build GPUI Design Token And Component Foundation

  **What to do**: Translate Vue theme/style source into GPUI tokens and primitive components: dark/light palettes, platform colors, font families (Inter/Manrope/system), text sizes, radii, spacing, borders, focus rings, scroll surfaces, buttons, chips, cards, tabs, text inputs, switches, sliders, popovers, modals, tooltips, SVG platform icons, animation timing constants. Keep tokens source-linked to Vue style references.
  **Must NOT do**: Do not redesign colors/spacing; do not replace SVG platform icons with emoji/glyphs; do not overbuild components not needed by parity matrix.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: exact UI parity and component primitives.
  - Skills: [`gpui`, `rust-best-practices`] - GPUI rendering/styling and Rust component structure.
  - Omitted: [`rust-async-patterns`] - No async work.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: [17-23] | Blocked By: [3]

  **References**:
  - Pattern: `packages/desktop/src/views/main/App.vue:807-935` - root theme variables.
  - Pattern: `packages/desktop/src/views/main/App.vue:939-1254` - shell/nav/update toast styles.
  - Pattern: `packages/desktop/src/views/main/components/ui/ChatAppearancePopover.vue:134-188` - theme/font/display controls.
  - Asset: `packages/desktop/src/assets/icons/platforms/twitch.svg` - Twitch icon source.
  - Asset: `packages/desktop/src/assets/icons/platforms/youtube.svg` - YouTube icon source.
  - Asset: `packages/desktop/src/assets/icons/platforms/kick.svg` - Kick icon source.
  - Current gap: `packages/desktop-rust/src/theme.rs:4-54` - palette only, incomplete token layer.

  **Acceptance Criteria**:
  - [ ] `packages/desktop-rust/src/ui/theme/` contains token structs for colors, spacing, radii, typography, z-layers, animation timings, and platform colors.
  - [ ] `packages/desktop-rust/src/ui/components/` contains reusable button, chip, card, tabs, input, switch, slider, modal, popover, tooltip, and platform icon components used by later pages.
  - [ ] Snapshot tests assert token values equal Vue source values for dark/light/platform palettes.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml ui_tokens_match_vue_sources -- --nocapture` exits 0.

  **QA Scenarios**:

  ```
  Scenario: GPUI tokens match Vue theme values
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml ui_tokens_match_vue_sources -- --nocapture`.
    Expected: Test reports exact matches for dark/light palettes, platform colors, radii, spacing scale, and typography choices.
    Evidence: .sisyphus/evidence/task-16-token-parity.json

  Scenario: Missing platform SVG fails component snapshot
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml ui_platform_icons_have_svg_sources -- --nocapture`.
    Expected: Test verifies Twitch/YouTube/Kick SVG assets are embedded or copied and fails if any emoji/glyph placeholder remains.
    Evidence: .sisyphus/evidence/task-16-platform-icons.json
  ```

  **Commit**: YES | Message: `feat(gpui): task-16 add design token foundation` | Files: [`packages/desktop-rust/src/ui/theme/`, `packages/desktop-rust/src/ui/components/`, `packages/desktop-rust/assets/`, `.sisyphus/evidence/task-16-*`]

- [ ] 17. Implement Main Shell, Navigation, Window Frame, And Update Toast

  **What to do**: Implement GPUI shell parity for app frame, left nav rail, section switching, sidebar collapse, unread badge, tab header, update toast UI/state, loading/error states, startup mount gating, and main content routing. Match Vue layout and screenshot proportions; remove prototype-only outer black frame mismatch unless parity matrix proves it is intended.
  **Must NOT do**: Do not change page names or nav order; do not use emoji placeholders for nav icons; do not omit update-toast UI because updater packaging is deferred.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: visual shell parity.
  - Skills: [`gpui`] - GPUI rendering, focus, layout.
  - Omitted: [`rust-best-practices`, `rust-async-patterns`] - Minor Rust patterns only; no service design.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: [18-23] | Blocked By: [15, 16]

  **References**:
  - Pattern: `packages/desktop/src/views/main/App.vue:37-105` - shell template.
  - Pattern: `packages/desktop/src/views/main/App.vue:120-233` - section/page state and initial loads.
  - Pattern: `packages/desktop/src/views/main/App.vue:291-515` - update toast logic.
  - Pattern: `packages/desktop/src/views/main/App.vue:520-1254` - shell/nav/update styles.
  - Current mismatch: `packages/desktop-rust/src/ui/shell/app.rs:24-40` - outer black frame and padded rounded container.

  **Acceptance Criteria**:
  - [ ] GPUI app renders Chat, Events, Platforms, Settings nav items in matching order and visual states.
  - [ ] Sidebar collapse/expand, unread badge, and update toast states are driven by `AppState` and service events.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_main_shell_matches_vue_reference -- --nocapture` exits 0 and writes screenshots/diffs.
  - [ ] Keyboard navigation/focus tests for nav and toast actions pass.

  **QA Scenarios**:

  ```
  Scenario: Main shell screenshot matches Vue reference
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_main_shell_matches_vue_reference -- --nocapture`.
    Expected: Diff report for 1229x845 dark theme is within configured threshold and includes nav rail, top tabs, content frame, and composer area placeholders.
    Evidence: .sisyphus/evidence/task-17-main-shell-diff.png

  Scenario: Update toast error and downloaded states render
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_update_toast_states -- --nocapture`.
    Expected: Available, downloaded, error, and dismissed states match Vue reference snapshots and button actions emit expected runtime commands.
    Evidence: .sisyphus/evidence/task-17-update-toast.json
  ```

  **Commit**: YES | Message: `feat(gpui): task-17 implement main shell parity` | Files: [`packages/desktop-rust/src/ui/`, `packages/desktop-rust/tests/visual/`, `.sisyphus/evidence/task-17-*`]

- [ ] 18. Implement Chat Page, Message List, Composer, Autocomplete, And Emote Picker

  **What to do**: Implement GPUI chat page parity: live chat header, status chips/tooltips, message list virtualization/wrapping, modern/compact modes, system messages, reply/copy/open-link actions, scroll-to-bottom pill, composer textarea, platform send chips, Enter/Shift+Enter behavior, autocomplete popup for mentions/emotes/commands, and emote picker grid/search/loading/error states. Use domain fixtures from Task 10.
  **Must NOT do**: Do not use fixed-height row virtualization if it breaks multiline/reply/emote rows; do not omit keyboard behavior; do not hide unsupported actions.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: complex visual and interaction parity.
  - Skills: [`gpui`, `rust-best-practices`] - GPUI components, data ownership.
  - Omitted: [`rust-async-patterns`] - Runtime services already exist; only event consumption.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: [19, 24] | Blocked By: [10, 16, 17]

  **References**:
  - Pattern: `packages/desktop/src/views/main/components/ChatList.vue:1-559` - chat page structure and behavior.
  - Pattern: `packages/desktop/src/views/main/components/ChatInput.vue:1-724` - composer/autocomplete/emote picker command handling.
  - Pattern: `packages/desktop/src/views/main/components/ChatMessage.vue:1-320` - message rendering behavior.
  - Pattern: `packages/desktop/src/views/main/components/AutocompletePopup.vue:1-56` - suggestions popup.
  - Pattern: `packages/desktop/src/views/main/components/EmotePicker.vue:1-107` - emote picker.

  **Acceptance Criteria**:
  - [ ] Chat fixture data renders all message kinds and modern/compact appearances.
  - [ ] Composer sends commands to service bus for selected platforms and preserves multiline behavior.
  - [ ] Autocomplete and emote picker can be opened, searched, keyboard-selected, dismissed, and fail gracefully.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_chat_page_matches_vue_reference -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml chat_input_keyboard_contract -- --nocapture` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Chat page visual parity with fixture messages
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_chat_page_matches_vue_reference -- --nocapture`.
    Expected: Screenshot diffs cover modern mode, compact mode, empty state, scroll pill, reply message, emote, badge, self-ping, and system event states within threshold.
    Evidence: .sisyphus/evidence/task-18-chat-page-diff.png

  Scenario: Composer handles Enter and Shift+Enter
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml chat_input_keyboard_contract -- --nocapture`.
    Expected: Enter sends one message through service bus; Shift+Enter inserts newline; empty message does not send and displays disabled state.
    Evidence: .sisyphus/evidence/task-18-chat-input.json
  ```

  **Commit**: YES | Message: `feat(gpui): task-18 implement chat page parity` | Files: [`packages/desktop-rust/src/ui/chat/`, `packages/desktop-rust/tests/visual/chat/`, `.sisyphus/evidence/task-18-*`]

- [ ] 19. Implement User Card, Context Menus, History Panel, Tooltips, And Popovers

  **What to do**: Implement GPUI equivalents for right-click user context menu, user card dialog, alias editing, backend metadata cards, paginated local chat history panel, emote tooltip, general tooltip, chat appearance popover, modal stack behavior, outside-click dismissal, Escape dismissal, focus trapping, and error/loading states.
  **Must NOT do**: Do not fake user metadata; do not make dialogs non-keyboard-dismissable; do not use global mutable state for modal stack.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: popovers/dialogs and fine-grained UI parity.
  - Skills: [`gpui`] - focus, events, popovers, rendering.
  - Omitted: [`rust-best-practices`, `rust-async-patterns`] - Domain/services already provided.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: [24] | Blocked By: [10, 16, 18]

  **References**:
  - Pattern: `packages/desktop/src/views/main/components/UserContextMenu.vue:1-47` - context entry point.
  - Pattern: `packages/desktop/src/views/main/components/UserCardDialog.vue:1-351` - user dialog.
  - Pattern: `packages/desktop/src/views/main/components/UserChatHistoryPanel.vue:1-69` - history panel.
  - Pattern: `packages/desktop/src/views/main/components/ui/Tooltip.vue:1-153` - tooltip token/animation rules.
  - Pattern: `packages/desktop/src/views/main/components/ui/ChatAppearancePopover.vue:1-191` - appearance popover.
  - Pattern: `packages/desktop/src/views/main/components/EmoteTooltip.vue:60-166` - emote tooltip.

  **Acceptance Criteria**:
  - [ ] User card opens from message/user context action and displays aliases, platform, metadata, history, loading, empty, and error states.
  - [ ] Alias edits persist through storage and update rendered messages.
  - [ ] Tooltip/popover/modal stack passes focus and dismissal tests.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_user_card_and_popovers_match_vue -- --nocapture` exits 0.

  **QA Scenarios**:

  ```
  Scenario: User card and history visual parity
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_user_card_and_popovers_match_vue -- --nocapture`.
    Expected: Screenshots cover user card loaded, metadata error, history empty, history paginated, alias edit, emote tooltip, and appearance popover states.
    Evidence: .sisyphus/evidence/task-19-user-card-popovers-diff.png

  Scenario: Modal focus and Escape dismissal
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml modal_focus_and_escape_contract -- --nocapture`.
    Expected: Focus is trapped while dialog open; Escape closes topmost dialog; underlying chat focus is restored.
    Evidence: .sisyphus/evidence/task-19-modal-focus.json
  ```

  **Commit**: YES | Message: `feat(gpui): task-19 implement user dialogs and popovers` | Files: [`packages/desktop-rust/src/ui/dialogs/`, `packages/desktop-rust/src/ui/popovers/`, `.sisyphus/evidence/task-19-*`]

- [ ] 20. Implement Watched Channel Tabs, Split Layouts, Drag/Drop, And Add Channel Flows

  **What to do**: Implement GPUI watched-channel UI parity: channel tab bar, add tab, close tab, reorder drag/drop, active tab, live dot, recursive split layouts, splitter dragging, panel add/change/remove/split actions, drag/drop channel assignment, add-channel modal/form, tab selector modal, layout persistence, and invalid layout recovery display.
  **Must NOT do**: Do not simplify split layouts to a single panel; do not remove drag/drop behavior; do not exceed max panel constraints.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: advanced UI layout/drag/drop parity.
  - Skills: [`gpui`, `rust-best-practices`] - GPUI events/layout and safe layout model.
  - Omitted: [`rust-async-patterns`] - Runtime manager already exists.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: [24] | Blocked By: [14, 16, 17]

  **References**:
  - Pattern: `packages/desktop/src/views/main/components/WatchedChannelsView.vue:1-194` - watched layout host.
  - Pattern: `packages/desktop/src/views/main/components/SplitNode.vue:1-191` - recursive split renderer.
  - Pattern: `packages/desktop/src/views/main/components/PanelNode.vue:1-254` - panel actions/drop/add form.
  - Pattern: `packages/desktop/src/views/main/components/ChannelTabBar.vue:1-191` - tab reorder/remove/add.
  - Pattern: `packages/desktop/src/views/main/components/AddChannelModal.vue:1-44` - modal wrapper.
  - Pattern: `packages/desktop/src/views/main/components/AddChannelForm.vue:1-126` - platform/channel entry.
  - Pattern: `packages/desktop/src/views/main/components/TabSelectorModal.vue:36-66` - command-palette modal.

  **Acceptance Criteria**:
  - [ ] Visual parity tests cover single panel, horizontal split, vertical split, max panels, empty panel, active drop target, dragging splitter, tab reorder, add modal, tab selector.
  - [ ] Interaction tests verify split/add/remove/assign/reorder persist to storage and restore after restart.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml watched_layout_interaction_contract -- --nocapture` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Watched split layout visual parity
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_watched_layouts_match_vue -- --nocapture`.
    Expected: Screenshot diffs cover all split orientations, panel headers/actions, active drop zones, and tab bar states within threshold.
    Evidence: .sisyphus/evidence/task-20-watched-layouts-diff.png

  Scenario: Drag/drop reorder persists
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml watched_layout_interaction_contract -- --nocapture`.
    Expected: Simulated tab drag reorders tabs, panel assignment changes, layout writes to fixture DB, and restored state matches expected snapshot.
    Evidence: .sisyphus/evidence/task-20-watched-interactions.json
  ```

  **Commit**: YES | Message: `feat(gpui): task-20 implement watched layout parity` | Files: [`packages/desktop-rust/src/ui/watched/`, `packages/desktop-rust/tests/visual/watched/`, `.sisyphus/evidence/task-20-*`]

- [ ] 21. Implement Platforms Page, Account Actions, Join/Leave, And Stream Editor

  **What to do**: Implement GPUI platforms page parity: platform cards, connected/disconnected states, account rows, connect/disconnect/logout, join/leave channel flows, per-platform toasts, loading spinners, stream status cards, category search, stream editor modal/form, update stream metadata, and provider-specific error states.
  **Must NOT do**: Do not merge platform-specific behaviors into one generic UI if current Vue shows differences; do not require real credentials for tests.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: UI parity plus service integration.
  - Skills: [`gpui`, `rust-best-practices`, `rust-async-patterns`] - GPUI UI, typed service commands, async states.
  - Omitted: [] - All relevant.

  **Parallelization**: Can Parallel: YES | Wave 5 | Blocks: [24] | Blocked By: [9, 11, 12, 13, 16, 17]

  **References**:
  - Pattern: `packages/desktop/src/views/main/components/PlatformsPanel.vue:1-841` - platforms page cards/actions/toasts.
  - Pattern: `packages/desktop/src/views/main/components/StreamEditor.vue:1-476` - stream editor behavior.
  - Pattern: `packages/desktop/src/views/main/stores/streamStatus.ts:7-96` - status cache behavior.

  **Acceptance Criteria**:
  - [ ] Platforms page renders all current states for Twitch, YouTube, Kick.
  - [ ] Connect/disconnect/join/leave/stream-update commands call service bus and handle success/error events.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_platforms_page_matches_vue -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml platforms_actions_contract -- --nocapture` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Platforms page visual parity
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_platforms_page_matches_vue -- --nocapture`.
    Expected: Screenshot diffs cover disconnected, connected, loading, error toast, joined channel, and stream editor states for all platforms.
    Evidence: .sisyphus/evidence/task-21-platforms-diff.png

  Scenario: Stream editor handles category search failure
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml stream_editor_category_search_failure -- --nocapture`.
    Expected: Search failure displays matching error state, preserves form input, and does not send update command.
    Evidence: .sisyphus/evidence/task-21-stream-editor-error.json
  ```

  **Commit**: YES | Message: `feat(gpui): task-21 implement platforms parity` | Files: [`packages/desktop-rust/src/ui/platforms/`, `packages/desktop-rust/tests/visual/platforms/`, `.sisyphus/evidence/task-21-*`]

- [ ] 22. Implement Settings Page, Hotkeys, Appearance, And Overlay Controls

  **What to do**: Implement GPUI settings page parity: appearance theme/font/chat display/self-ping controls, overlay URL/port/background/text color/font size/max messages/animation/position/platform icon/avatar toggles, copy overlay URL action, hotkey display/recording/reset, settings persistence, validation, and Rust overlay server integration. Apply settings to chat UI and overlay broadcasts.
  **Must NOT do**: Do not omit hotkey recorder; do not make overlay URL copy depend on manual clipboard verification; do not change existing setting names without migration aliases.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: dense settings UI and interaction parity.
  - Skills: [`gpui`, `rust-best-practices`, `rust-async-patterns`] - UI, persistence, service updates.
  - Omitted: [] - All relevant.

  **Parallelization**: Can Parallel: YES | Wave 5 | Blocks: [24] | Blocked By: [5, 8, 16, 17]

  **References**:
  - Pattern: `packages/desktop/src/views/main/components/SettingsPanel.vue:1-811` - settings UI and overlay controls.
  - Pattern: `packages/desktop/src/views/main/composables/useHotkeys.ts:11-187` - hotkey recorder/global hotkeys.
  - Pattern: `packages/desktop/src/views/main/components/ui/ChatAppearancePopover.vue:1-191` - appearance options.
  - Pattern: `packages/desktop/src/overlay-server.ts:64-240` - overlay URL/server behavior.

  **Acceptance Criteria**:
  - [ ] Settings page visual tests cover all groups and control states.
  - [ ] Hotkey recorder captures key combinations, rejects invalid combinations, saves settings, and restores after restart.
  - [ ] Overlay URL generation matches port/query behavior and copy action writes expected string to clipboard fake.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml settings_hotkeys_overlay_contract -- --nocapture` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Settings page visual parity
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_settings_page_matches_vue -- --nocapture`.
    Expected: Screenshot diffs cover appearance, chat, overlay, hotkeys, switches, sliders, URL box, and validation/error states.
    Evidence: .sisyphus/evidence/task-22-settings-diff.png

  Scenario: Hotkey recorder rejects duplicate binding
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml hotkey_recorder_rejects_duplicate -- --nocapture`.
    Expected: Duplicate binding shows error state, original binding remains persisted, and no command conflict is registered.
    Evidence: .sisyphus/evidence/task-22-hotkey-duplicate.json
  ```

  **Commit**: YES | Message: `feat(gpui): task-22 implement settings and hotkeys parity` | Files: [`packages/desktop-rust/src/ui/settings/`, `packages/desktop-rust/src/hotkeys/`, `.sisyphus/evidence/task-22-*`]

- [ ] 23. Implement Events Page And Runtime Event Feed

  **What to do**: Implement GPUI events page parity: event taxonomy, icons/colors, event cards, empty/loading/error states, ordering, filtering if present in current Vue, platform-specific events, backend events, watched-channel events, and integration with Rust service bus. Ensure events also feed overlay where current desktop does so.
  **Must NOT do**: Do not collapse event types into generic text rows; do not drop platform-specific coloring/icons.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: visual event cards and service integration.
  - Skills: [`gpui`, `rust-best-practices`] - UI components and typed event data.
  - Omitted: [`rust-async-patterns`] - Service bus already exists.

  **Parallelization**: Can Parallel: YES | Wave 5 | Blocks: [24] | Blocked By: [7, 10, 16, 17]

  **References**:
  - Pattern: `packages/desktop/src/views/main/components/EventsFeed.vue:1-220` - event taxonomy and rendering.
  - Pattern: `packages/desktop/src/views/main/components/EventsFeed.vue:144-497` - event page styling.
  - API/Type: `packages/shared/types.ts:28` - normalized events.

  **Acceptance Criteria**:
  - [ ] Event feed renders all normalized event fixture types with correct icon/color/platform metadata.
  - [ ] Empty/loading/error states match Vue reference.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_events_page_matches_vue -- --nocapture` exits 0.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml events_feed_ordering_contract -- --nocapture` exits 0.

  **QA Scenarios**:

  ```
  Scenario: Events page visual parity
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml visual_events_page_matches_vue -- --nocapture`.
    Expected: Screenshot diffs cover populated, empty, loading, and error states with platform-specific icons/colors.
    Evidence: .sisyphus/evidence/task-23-events-diff.png

  Scenario: Event ordering is stable under burst
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml events_feed_ordering_contract -- --nocapture`.
    Expected: Burst events retain timestamp order with stable tie-breaking and no dropped backend events.
    Evidence: .sisyphus/evidence/task-23-event-ordering.json
  ```

  **Commit**: YES | Message: `feat(gpui): task-23 implement events parity` | Files: [`packages/desktop-rust/src/ui/events/`, `packages/desktop-rust/tests/visual/events/`, `.sisyphus/evidence/task-23-*`]

- [ ] 24. Harden Visual, Fixture, Overlay, And Performance Parity Gates

  **What to do**: Consolidate all tests into repeatable parity suites: visual screenshots vs Vue references, fixture replay, DB compatibility, backend/overlay WS, provider mocks, hotkeys/focus, accessibility/focus traversal, and performance. Add a single `cargo test ... parity_full_suite` target or documented command sequence that produces an evidence index. Tune chat virtualization/performance only after proving feature parity.
  **Must NOT do**: Do not hide flaky tests by ignoring them; do not loosen visual thresholds without recording rationale; do not optimize by removing message features.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: cross-cutting QA and performance hardening.
  - Skills: [`gpui`, `rust-best-practices`, `rust-async-patterns`] - UI tests, Rust QA, async/performance.
  - Omitted: [] - All relevant.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: [25, F1-F4] | Blocked By: [8, 10-23]

  **References**:
  - Verification matrix: `packages/desktop-rust/parity/desktop-parity-matrix.json` - required parity rows.
  - Visual source: `packages/desktop/src/views/main/**/*.vue` and `packages/desktop/src/views/overlay/App.vue` - reference states.
  - Performance risk: `packages/desktop-rust/src/ui/chat.rs` current `uniform_list` fixed-height prototype may not fit real multiline chat rows.

  **Acceptance Criteria**:
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml parity_full_suite -- --nocapture` exits 0 and writes `.sisyphus/evidence/parity/index.json`.
  - [ ] Evidence index links all task evidence, visual diffs, fixture outputs, DB reports, overlay WS reports, and performance reports.
  - [ ] Performance report proves high-volume chat does not drop messages, does not block UI state updates, and preserves all display features.
  - [ ] Visual diff thresholds are documented in `packages/desktop-rust/tests/visual/README.md` with no human approval requirement.

  **QA Scenarios**:

  ```
  Scenario: Full parity suite passes
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml parity_full_suite -- --nocapture`.
    Expected: Suite exits 0 and evidence index contains passing entries for contract, storage, backend, overlay, providers, UI pages, dialogs, hotkeys, and performance.
    Evidence: .sisyphus/evidence/task-24-parity-index.json

  Scenario: Performance burst keeps feature parity
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml chat_burst_performance -- --nocapture`.
    Expected: Report shows no dropped messages, bounded memory, no UI-thread blocking assertion failures, and preserved emote/badge/reply rendering flags.
    Evidence: .sisyphus/evidence/task-24-chat-burst-performance.json
  ```

  **Commit**: YES | Message: `test(gpui): task-24 harden parity and performance gates` | Files: [`packages/desktop-rust/tests/`, `packages/desktop-rust/fixtures/`, `.sisyphus/evidence/task-24-*`, `.sisyphus/evidence/parity/`]

- [ ] 25. Add Post-Core Packaging And Updater Stabilization

  **What to do**: After Task 24 is green, add packaging/updater stabilization for the Rust desktop: build script, desktop app metadata, icon/assets inclusion, overlay asset inclusion, release artifact smoke checks, updater pipeline design/implementation if feasible in this branch, and migration notes for making Rust desktop the default target. Preserve the earlier decision that packaging/updater must not block core parity; this task begins only after parity is stable.
  **Must NOT do**: Do not start this before Task 24 passes; do not change default release target without a passing smoke artifact; do not regress overlay delivery.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: release/runtime packaging has OS and delivery implications.
  - Skills: [`rust-best-practices`] - Build scripts and robust errors.
  - Omitted: [`gpui`, `rust-async-patterns`] - Minimal UI/async work unless updater implementation needs it.

  **Parallelization**: Can Parallel: NO | Wave 6 | Blocks: [F1-F4] | Blocked By: [15, 24]

  **References**:
  - Current desktop config: `packages/desktop/electrobun.config.ts` - app meta/build/copy behavior.
  - Current desktop package scripts: `packages/desktop/package.json` - build/dev/typecheck/test scripts.
  - Current Rust manifest: `packages/desktop-rust/Cargo.toml` - package metadata/dependencies.
  - Overlay build: `packages/desktop/vite.overlay.config.ts` - overlay asset output.

  **Acceptance Criteria**:
  - [ ] Rust desktop has documented build command under `packages/desktop-rust/README.md` and/or root scripts.
  - [ ] Build artifact includes GPUI binary, required assets/icons, and Vue overlay built assets.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging_artifact_contains_required_assets -- --nocapture` exits 0.
  - [ ] If updater pipeline is not fully implemented, `packages/desktop-rust/docs/updater-stabilization.md` records exact remaining steps and parity risks; update-toast UI remains functional through Task 15/17 implementation.

  **QA Scenarios**:

  ```
  Scenario: Packaging artifact contains Rust app and overlay assets
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging_artifact_contains_required_assets -- --nocapture`.
    Expected: Test inspects build output and finds binary metadata, platform icons, theme assets, and overlay `index.html` plus `/assets/*`.
    Evidence: .sisyphus/evidence/task-25-packaging-assets.json

  Scenario: Missing overlay asset fails build smoke
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging_missing_overlay_asset_fails -- --nocapture`.
    Expected: Test fixture missing overlay assets fails with clear `MissingOverlayAsset` error and no partial release artifact is marked valid.
    Evidence: .sisyphus/evidence/task-25-packaging-error.json
  ```

  **Commit**: YES | Message: `chore(release): task-25 add rust desktop packaging stabilization` | Files: [`packages/desktop-rust/README.md`, `packages/desktop-rust/docs/`, `packages/desktop-rust/build.rs`, `packages/desktop-rust/Cargo.toml`, `package.json`, `.sisyphus/evidence/task-25-*`]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ screenshot/fixture harness; Playwright only for overlay browser surface)
- [ ] F4. Scope Fidelity Check — deep

### Final Verification QA Scenarios

```
Scenario: F1 Plan Compliance Audit approves completed branch state
  Tool: oracle
  Steps: Run Oracle against `.sisyphus/plans/desktop-rust-gpui-parity.md` plus the final changed file set and evidence index.
  Expected: Oracle reports that implemented work satisfies the saved plan or names concrete blocking gaps.
  Evidence: .sisyphus/evidence/final-f1-plan-compliance.md

Scenario: F2 Code Quality Review approves implementation quality
  Tool: unspecified-high
  Steps: Review all Rust/Vue changes included by the branch with emphasis on correctness, maintainability, and regression risk.
  Expected: Reviewer approves or returns concrete blocking defects with file paths.
  Evidence: .sisyphus/evidence/final-f2-code-quality.md

Scenario: F3 Real Manual QA executes runnable parity surfaces
  Tool: unspecified-high (+ Playwright for overlay browser surface if needed)
  Steps: Run the final executable checks, overlay/browser smoke, fixture replay, storage compatibility, backend bridge, and visual parity commands from the completed tasks.
  Expected: Runnable parity surfaces behave correctly without human intervention and all required evidence artifacts are produced.
  Evidence: .sisyphus/evidence/final-f3-manual-qa.md

Scenario: F4 Scope Fidelity Check confirms no forbidden drift
  Tool: deep
  Steps: Compare completed work against original request, interview summary, and Must Have / Must NOT Have sections.
  Expected: Reviewer confirms exact-scope delivery, including no internal webview/RPC runtime layer in `packages/desktop-rust` and no parity regressions.
  Evidence: .sisyphus/evidence/final-f4-scope-fidelity.md
```

## Commit Strategy

- Before implementation: create/switch branch with `git checkout -b feat/refactor-desktop-gpui` if it does not exist, otherwise `git checkout feat/refactor-desktop-gpui`.
- Never use `worktree` commands.
- Commit after each accepted task, not after broken intermediate edits.
- Standard pre-commit gate for Rust tasks:
  ```bash
  cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check
  cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings
  cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features
  git status --short
  # Stage exactly the paths listed in the current task's `Files:` field.
  git commit -m "the exact message from the current task's `Commit:` field"
  git status --short
  ```
- Standard pre-commit gate when Vue overlay files change:
  ```bash
  bun run --cwd packages/desktop typecheck
  bun run --cwd packages/desktop build:views
  cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check
  cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings
  cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features
  git status --short
  # Stage exactly the paths listed in the current task's `Files:` field.
  git commit -m "the exact message from the current task's `Commit:` field"
  git status --short
  ```
- Do not commit `.env`, real databases, generated secrets, credentials, or unrelated user changes.

## Success Criteria

- All TODO tasks are checked only after their acceptance criteria, QA scenarios, evidence, and commits complete.
- Final verification agents F1-F4 all approve.
- User explicitly approves final verification results.
- Branch `feat/refactor-desktop-gpui` contains all accepted commits and no uncommitted implementation changes.
