# Learnings: desktop-rust-user-history-modal

## 2026-05-22 Task: start-work

- Plan path: `.omo/plans/desktop-rust-user-history-modal.md`.
- Active boulder: `desktop-rust-user-history-modal-ef6881d5`.
- Work happens in current repo; no worktree path is set.
- Old Vue parity is source of truth; implementation target is `packages/desktop-rust`.

## 2026-05-22 Task: task-1-research

- Storage contracts should extend `packages/desktop-rust/tests/storage.rs`.
- Protocol serde contracts should extend `packages/desktop-rust/tests/protocol.rs` and/or `fixtures/protocol/rpc.json`.
- `MessageStore::save()` parses `NormalizedChatMessage.timestamp` as unix seconds string and stores `created_at` as milliseconds.
- Direct SQL fixtures store `chat_messages.created_at` in milliseconds; JSON payload timestamp may be ISO-ish in existing fixtures.
- `MessageStore::get_by_user()` orders query rows by `created_at DESC, id DESC`, then reverses returned messages for display order; `next_cursor` comes from the last page row before reverse semantics must be verified by tests.
- Existing helper examples: `tests/watched_channels_runtime.rs::chat_message`, `tests/app_state.rs::chat_message_with_badges`, `tests/parity_regression_contracts.rs::sample_chat_message`, `tests/chat_domain.rs::make_message`.
- Serde contract pattern: use `serde_json::json!`, `serde_json::to_value`, and `serde_json::from_value` without new dependencies; assert exact camelCase keys.

## 2026-05-22 Task: task-1-contract-hardening

- `MessageStore::get_by_user()` returns the newest matching DB window but reverses each page for display order; with limit 2 over timestamps 1..5, the first page is `[4, 5]` and the cursor points at the oldest row in that page (`4`) so the next request returns `[2, 3]`.
- Platform and author ID are the storage boundary for user-card history; same display names across Twitch/Kick do not leak when querying by `(platform, platform_user_id)`.
- User-card protocol structs already serialize to the required camelCase JSON for history params/pages and metadata request/response; no protocol implementation change was needed.

## 2026-05-22 Task: task-3-app-state-modal

- `/user` is handled in `AppState::queue_composer_send()` before any backend send queueing.
- User-card lookup is scoped to the active message collection first, then falls back to the home collection when needed.
- The modal state uses generation guards for history/metadata apply paths; opening or closing invalidates stale async results.
- `current_alias` remains `None` in Rust state for now because alias storage is intentionally out of scope for this task.

## 2026-05-22 Task: task-2-rust-service-path

- Added `packages/desktop-rust/src/services/user_card.rs` as the runtime service boundary for user-card history and metadata.
- History loading delegates directly to `storage.messages().get_by_user(...)`, preserving Task 1 cursor/display-order contracts.
- Metadata request building reuses protocol `UserCardMetadataBackendRequest`; Twitch auth is attached only for Twitch when a stored Twitch account has a valid decoded access token and platform user id. Kick requests intentionally omit auth.
- Metadata fetching uses `RuntimeConfig::backend_request("/api/user-card-metadata")` so backend URL and `X-Client-Secret` headers stay centralized.

### Task 4 - UserCard Render Components

- Migrated placeholder `UserCard` to full GPUI representation using `RenderOnce`.
- Replaced `history_expanded` state with structured explicit properties `MetadataState` and `HistoryState`.
- Implemented GPUI callback patterns using `Rc<dyn Fn(&mut Window, &mut App) + 'static>` for `on_refresh_metadata`, `on_refresh_history`, and `on_load_older`. This allows cloning the callback reference into multiple UI elements without consuming it or requiring `Clone` on `Fn`.
- Ensured `ImageSource::from(...)` follows `with_fallback` and `with_loading` closure requirements.
- Learned that GPUI Interactive traits (e.g. `on_click()`) and stateful container behaviors (e.g. `overflow_y_scroll()`) require the element to have an explicit `.id(...)` to bind across frames.
- Replaced Vue's text helpers with static strings formatted from state models; they match the visual contract expectations and provide isolated test hooks.

## 2026-05-22 Task: task-6-async-shell-integration

- `TwirChatApp` stores user-card metadata/history tasks and detects a new modal generation during render; the first render after `/user` opens starts both async loads.
- User-card refresh and load-older callbacks use `cx.entity()` handles from the top-level shell, so the `RenderOnce` component remains stateless while shell methods own runtime work.
- AppState now keeps `UserChatHistoryCursor` directly for user-card pagination and tracks `loading_older`; older pages are prepended through `apply_user_card_history_result` when the same generation is still active.
- The exact smoke command needed `default-run = "twirchat-desktop-rust"`; smoke mode also needs a process-level exit because background services can keep retrying backend WebSocket after `cx.quit()`.
- Follow-up verification fix: blocking user-card history/metadata work must not run inside `this.update(...)`. `AppRuntime::user_card_loader()` now returns a cloneable `UserCardRuntimeLoader` snapshot, and `TwirChatApp` runs loader calls with `cx.background_executor().spawn(...)`; UI update closures only apply completed `Result`s through AppState generation guards.

- GPUI global entity updates: Passing `Entity<AppState>` into render paths (like `message_row`) is necessary to execute callbacks that mutate the `AppState` and call `cx.notify()`. The entity should be cloned into closures that register event handlers.
- Right-click behavior on elements: Can be bound using `.on_mouse_down(gpui::MouseButton::Right, move |event, window, cx| { ... })`. This matches context menu expectations without triggering drag behaviors or default left-click selections.
- Extracting components from AppState: `AppState::user_card_target_for_message` allows extracting target fields consistently rather than duplicating logic across rendering functions.

### Task 5 Cleanup

- Removed temporary Python/Bash scripts from the repository root used for regex replacements.
- Removed unused `AppSettings` import from `packages/desktop-rust/src/ui/components/watched_layout.rs` to fix the clippy warning.
- Verified that the `user_card_right_click_trigger` test and `compact_chat_uses_distinct_layout_without_avatar_branch` test pass.
- Verified `cargo check` is now 100% warning-free.
- Task 7 completed: Polish for empty/error states and load-older token applied to UserCard and `app.rs` formatters.
- Handled formatting of metadata matching the requested spec.
- Added tests `user_card_empty_error_states`, `user_card_formats_metadata_text` to verify text and UI behavior.
- Task 7 tests updated: `user_card_empty_history_state` tests `AppState` mapping explicitly, and `user_card_load_older` verifies `HistoryState::Loaded` flags and UI string presence using source assertions.
- Adjusted subscription formatting in `app.rs` to match exact plan semantics: "Currently subscribed · Tier <tier> · Gifted by <gifter> · <message>".
- Task 7 test fixes: Updated `tests/ui_visuals.rs` to enforce the new explicit "Load older" string over the stale "Scroll up..." string from the original Vue structure.
- Task 7 test fixes: Switched bool assertions in `tests/user_card.rs` to idiomatic `assert!(bool)` formatting to keep clippy strict checks happy.

## 2026-05-22 Task 8 - Full desktop-rust verification

- Created/updated evidence files under `.omo/evidence/` for fmt, check, clippy, tests, and smoke.
- Fixed feature-related clippy `let_unit_value` warnings in `packages/desktop-rust/src/ui/shell/app.rs` by removing ignored unit bindings around user-card modal `Entity::update` callbacks, then reran the full verification sequence.
- `rtk cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check`: exit 0; rustfmt produced no output.
- `rtk cargo check --manifest-path packages/desktop-rust/Cargo.toml`: exit 0; `cargo build (1 crates compiled)`.
- `rtk cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings`: exit 0; no issues found.
- `rtk cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features`: exit 0; 147 passed across 26 suites.
- `rtk cargo run --manifest-path packages/desktop-rust/Cargo.toml -- --smoke-exit-after-first-frame`: exit 0; GPUI window opened and smoke mode shut down immediately; backend WebSocket connection refused log was present with backend absent, matching inherited wisdom.
- `lsp_diagnostics` on `packages/desktop-rust/src/ui/shell/app.rs`: no diagnostics.
- `git status --short` after verification still shows the existing desktop-rust feature worktree changes plus `.omo` task files; this task additionally touched `packages/desktop-rust/src/ui/shell/app.rs` and the Task 8 evidence/notepad files.

## 2026-05-22 Final-wave reject fixes

- `/user <query>` is now treated as a handled composer command: resolved matches open the user-card modal and return `true` without queuing backend or watched-channel sends; unresolved matches also return `true`, suppress sends, and record runtime feedback for user-visible/testable failure state.
- User-card history loads now carry a per-request token in addition to modal generation. Initial refreshes and older-page loads share the modal generation but only the latest active request can apply, so stale older-page results cannot overwrite a newer refresh.
- User-card metadata platform mapping is now optional in the shell: Twitch and Kick call backend metadata, while YouTube remains unsupported and leaves the modal on its graceful unsupported fallback without mapping to Kick.
- Verified with `rtk cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features user_command -- --nocapture`, `user_card_async`, `user_card_unsupported`, plus `rtk cargo check` and strict `rtk cargo clippy --all-targets --all-features -- -D warnings`.

## 2026-05-22 Task 8 - Evidence refresh after final-wave fixes

- Refreshed all Task 8 evidence files after final-wave fixes: fmt, check, clippy, full tests, and smoke all exited 0.
- Current full-test evidence now reports `cargo test: 149 passed (26 suites, 0.35s)`, replacing stale 147-test evidence.
- Smoke evidence still includes the accepted backend WebSocket connection refused log with no backend running and confirms `gpui window opened; smoke mode requested immediate shutdown before interactive QA`.
- `git status --short` after refresh still shows the existing desktop-rust feature changes plus `.omo` files; no source code was changed during this refresh.

## 2026-05-22 User-card metadata client secret fix

- `AppRuntime::start(Default::default())` must hydrate `RuntimeConfig.client_secret` from `storage.client_identity().get_client_secret()` after storage opens when no explicit `RuntimeConfigInput.client_secret` is provided; cloned `UserCardRuntimeLoader` instances then carry a config whose `backend_request("/api/user-card-metadata")` sends `X-Client-Secret`.

## 2026-05-22 Task 9 - Visual Polish for UserCard

- Unified the rounding radii across the `UserCard` modal: root is now `px(12.0)` with `overflow_hidden()`, avatar is `px(12.0)`, and inner containers are `px(8.0)`. This resolves the previously reported inconsistent corners.
- Fixed the glaring bright platform background on the user card header by using a 15% opacity tint over the base modal color instead of a fully saturated background, ensuring readability.
- Replaced the unstyled history text dumps with structured rows, featuring `px(12.0)` padding, a readable `1.4` relative line height, and a subtle `border_b_1` separator between messages.
- Retained all element IDs and text strings to preserve UI contract tests (`visual_user_card_and_popovers_match_vue` and `user_card_load_older_ui_contract` passed).

## 2026-05-22 User-card metadata client secret config follow-up

- Startup secret hydration must not call env-aware `RuntimeConfig::apply(...)`; use `apply_with_env(..., Option::<PathBuf>::None)` for the secret-only update so explicit startup `db_path`, backend URLs, and node env cannot drift from the already-opened storage while preserving `X-Client-Secret` metadata auth.

## 2026-05-22 Scope cleanup after metadata auth retry

- Removed unrelated stream-status/live-viewer worktree changes from the metadata auth retry: restored `app_state/mod.rs`, `services/mod.rs`, `ui/chat.rs`, and `ui/shell/app.rs` to HEAD, and deleted untracked stream-status patch/test/service files. The preserved diff is limited to user-card visual polish, runtime secret hydration/tests, and notepad notes.
