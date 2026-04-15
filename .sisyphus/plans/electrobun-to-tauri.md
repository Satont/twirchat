# Electrobun → Tauri 2 Migration

## TL;DR

> **Quick Summary**: Migrate `packages/desktop` from Electrobun (Bun-based native wrapper) to Tauri 2 (Rust backend + WebKit frontend), rewriting all platform adapters, stores, auth, overlay server, and IPC layer in Rust. Vue 3 frontend is preserved; only the IPC API surface changes.
>
> **Deliverables**:
> - `packages/desktop/src-tauri/` — full Rust crate (Tauri 2 app)
> - All platform adapters (Twitch, Kick) rewritten in Rust; YouTube stubbed
> - SQLite stores in Rust (rusqlite), with migration from Electrobun DB path
> - Overlay HTTP+WS server in Rust (Axum) on port 45823
> - PKCE OAuth flows in Rust
> - Vue 3 frontend using `@tauri-apps/api` instead of `electrobun/view`
> - Rust lint/format config matching boxxy-dev/boxxy standard
> - GitHub Actions rewritten for Tauri 2 build matrix
>
> **Estimated Effort**: XL
> **Parallel Execution**: YES — 7 waves
> **Critical Path**: T1 (scaffold) → T3 (types) → T5 (stores) → T9 (adapters) → T14 (aggregator) → T17 (IPC sweep) → F1-F4

---

## Context

### Original Request
> «Составь план по переписыванию electrobun на tauri. Логика подключений к чатам и всему такому должна остаться прежней, на бэке приложения, не на webview.»
> «Учти в плане, что нам надо будет ещё переписать github actions.»
> «А ещё добавь в план, что мы должны будем сделать линты и форматирование как в репозитории https://github.com/boxxy-dev/boxxy.»

### Interview Summary
**Key Discussions**:
- Chat logic placement: Keep all platform adapters, stores, auth on Rust backend (main process). Never in webview.
- Frontend: Keep Vue 3 SFC as-is; migrate IPC calls only
- Overlay: Must remain HTTP+WS server (OBS requires http:// URL, not asset:// protocol)
- YouTube: Too complex to rewrite in Phase 2 — stub returning an error, full impl deferred
- Lint/format: Match boxxy-dev/boxxy Rust standards (rustfmt.toml + workspace Clippy lints)
- GitHub Actions: Rewrite build jobs for Tauri; keep backend Docker push unchanged

**Research Findings**:
- Electrobun RPC: ~40 request types (webview→bun) + 13 push event types (bun→webview), all in `src/shared/rpc.ts`
- Twitch adapter uses `@twurple/chat` (Node-only) → replace with `twitch-irc` Rust crate
- Kick adapter uses Pusher-style WebSocket → replace with `tokio-tungstenite`
- YouTube adapter uses `youtubei.js` Innertube polling → stub in Rust (Phase 2), full impl Phase 6
- SQLite stores use synchronous XOR encryption (actually used!) + AES-GCM helpers (unused)
- Overlay serves `dist/overlay/` SPA from filesystem (cannot embed with `include_str!` for JS/CSS bundles)
- Auth: PKCE, local callback HTTP server, token exchange via `packages/backend` proxy
- Backend connection: WS client with `X-Client-Secret` header, handles 7TV event forwarding
- boxxy lint config: `rustfmt edition=2024`, workspace Clippy lints (pedantic, nursery, perf, all=warn)
- GitHub Actions: Single `release.yml` with matrix (ubuntu/macos/windows), builds desktop + backend + Docker

### Metis Review
**Identified Gaps** (addressed):
- Token encryption migration: XOR used for existing tokens → implement XOR decoder in Rust for migration, immediately re-encrypt with AES-256-GCM on first read. Force re-auth if decryption fails.
- `client_secret` continuity: Read existing UUID from DB, do NOT generate a new one (would break backend WS auth)
- DB path migration: Electrobun stores data at `~/.local/share/TwirChat/` (Linux); Tauri uses `~/.local/share/twirchat/`. At startup, check old path and migrate if new path doesn't exist yet.
- Overlay static files: Axum must serve `dist/overlay/` from filesystem path (not embedded), resolved via `tauri::api::path::resource_dir()` or `CARGO_MANIFEST_DIR` at runtime
- `AdapterTaskManager` pattern: unified across all three adapters (Twitch/Kick/YouTube-stub) — single trait/struct
- YouTube stub: Return `Err("YouTube adapter not yet implemented")` from all YouTube commands
- AUTH_SERVER_PORT: pick ephemeral port dynamically (bind to :0, read assigned port) to avoid conflicts

---

## Work Objectives

### Core Objective
Replace the Electrobun desktop runtime with Tauri 2 in `packages/desktop`, rewriting all backend logic in Rust while preserving the Vue 3 frontend (with updated IPC calls), the overlay WebSocket protocol, the SQLite schema, and the `packages/backend` integration.

### Concrete Deliverables
- `packages/desktop/src-tauri/Cargo.toml` + full Rust crate
- `packages/desktop/src-tauri/rustfmt.toml` (boxxy standard)
- All 40+ Tauri `#[tauri::command]` handlers (replacing RPC requests)
- Tauri events replacing all 13 RPC push messages
- SQLite migration (Electrobun path → Tauri path)
- Token XOR→AES-GCM migration at first startup
- Twitch IRC adapter (Rust, twitch-irc crate)
- Kick WebSocket adapter (Rust, tokio-tungstenite)
- YouTube stub (returns error)
- PKCE OAuth for Twitch, YouTube, Kick in Rust
- Overlay Axum server on port 45823
- Backend WebSocket client in Rust
- Vue frontend updated to use `@tauri-apps/api/core` + `@tauri-apps/api/event`
- Rewritten `.github/workflows/release.yml` for Tauri 2

### Definition of Done
- [ ] `cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml` exits 0
- [ ] `cargo fmt --manifest-path packages/desktop/src-tauri/Cargo.toml -- --check` exits 0
- [ ] `cargo clippy --manifest-path packages/desktop/src-tauri/Cargo.toml -- -D warnings` exits 0
- [ ] `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml` — all tests pass
- [ ] `bun run typecheck` in `packages/desktop` exits 0 (vue-tsc)
- [ ] `grep -rn "electrobun\|Electroview\|rpc\.request\|rpc\.on\|rpc\.send" packages/desktop/src/views/ | wc -l` = 0
- [ ] `curl -sf http://localhost:45823/` returns HTML (overlay server up)
- [ ] App window opens, Twitch chat messages appear, Kick chat messages appear

### Must Have
- All platform logic runs in Rust main process, never in webview
- Overlay server listens on HTTP port 45823 (hardcoded, not env var)
- SQLite schema unchanged (same column names and types)
- Existing user tokens migrated without force re-auth (XOR→AES-GCM at first read)
- `client_secret` UUID preserved across migration (read from existing DB)
- Vue 3 frontend preserved, only IPC API surface changed
- Rust lint/format matching boxxy-dev/boxxy (rustfmt.toml + workspace Clippy lints)
- GitHub Actions updated for Tauri 2 build matrix

### Must NOT Have (Guardrails)
- NO changes to `packages/backend` code
- NO changes to `packages/shared` types
- NO changes to overlay WebSocket message protocol (OBS overlay must remain compatible)
- NO changes to SQLite schema (column names, types, constraints)
- NO new features added during migration (pure behavioral parity)
- NO `as_any` / `unwrap()` in Rust code except in tests — use `?` and `thiserror`
- NO hardcoded paths except port 45823 (use Tauri path APIs for data dirs)
- NO YouTube adapter implementation (stub only — full impl is separate task)
- NO `#[allow(clippy::...)]` blanket suppressions — fix the lint instead
- NO `console.log` debug statements left in frontend code

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun test in packages/desktop)
- **Automated tests**: YES (Tests-after for Rust units; existing bun tests preserved)
- **Framework**: `cargo test` (Rust) + `bun test` (TypeScript, existing tests)
- **Rust modules**: each store, adapter, and auth module gets unit tests

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Playwright — navigate, interact, assert DOM, screenshot
- **CLI/Rust**: Bash (cargo test / cargo check) — compile + unit tests
- **API/Backend**: Bash (curl) — assert HTTP status + body
- **Overlay**: Bash (curl + wscat/websocat) — assert HTTP + WS connection

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — scaffold + types + config):
├── Task 1:  Tauri 2 scaffold + rustfmt.toml + workspace lints [quick]
├── Task 2:  Rust error types (thiserror) + shared Rust types [quick]
├── Task 3:  Rust type stubs for all 40+ commands (cargo check target) [quick]
└── Task 4:  Remove Electrobun deps + update package.json + vite configs [quick]

Wave 2 (After Wave 1 — stores + DB migration):
├── Task 5:  Rust SQLite stores: accounts, settings, client_identity [unspecified-high]
├── Task 6:  Rust SQLite stores: chat_messages, channel_connections, watched_channels, user_aliases [unspecified-high]
└── Task 7:  DB path migration + token XOR→AES-GCM migration [deep]

Wave 3 (After Wave 2 — adapters + auth + overlay):
├── Task 8:  AdapterTaskManager trait + lifecycle state machine [deep]
├── Task 9:  Twitch IRC adapter (twitch-irc crate) [deep]
├── Task 10: Kick WebSocket adapter (tokio-tungstenite) [unspecified-high]
├── Task 11: YouTube stub adapter [quick]
├── Task 12: PKCE auth flows in Rust (Twitch + YouTube + Kick) [deep]
└── Task 13: Overlay Axum HTTP+WS server (port 45823) [deep]

Wave 4 (After Wave 3 — backend connection + aggregator + commands):
├── Task 14: Backend WS client (X-Client-Secret, 7TV events, reconnect) [deep]
├── Task 15: ChatAggregator in Rust (dedup, ring buffer 500, 7TV merge) [deep]
└── Task 16: All 40+ Tauri command handlers wired to stores/adapters [unspecified-high]

Wave 5 (After Wave 4 — frontend IPC migration):
├── Task 17: Replace Electroview.defineRPC → @tauri-apps/api invoke/listen in main.ts + App.vue [visual-engineering]
├── Task 18: Migrate all rpc.request.* calls in components → invoke() [visual-engineering]
└── Task 19: Migrate all rpc.on.* / event listeners → listen() + useEventListener composable [visual-engineering]

Wave 6 (After Wave 5 — CI/CD):
└── Task 20: Rewrite .github/workflows/release.yml for Tauri 2 [unspecified-high]

Wave FINAL (After ALL tasks — parallel review):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review (cargo + bun) [unspecified-high]
├── Task F3: Real manual QA (Playwright + curl) [unspecified-high]
└── Task F4: Scope fidelity check [deep]
→ Present results → Get explicit user okay

Critical Path: T1 → T3 → T5 → T8 → T9 → T14 → T15 → T16 → T17 → T20 → F1-F4
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 6 (Wave 3)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| T1 | — | T2, T3, T4 |
| T2 | T1 | T3, T5, T6, T8, T9, T10, T12, T13, T14, T15 |
| T3 | T1, T2 | T16 |
| T4 | T1 | T17 |
| T5 | T2 | T7, T12, T16 |
| T6 | T2 | T7, T14, T15, T16 |
| T7 | T5, T6 | T16 |
| T8 | T2 | T9, T10, T11 |
| T9 | T2, T8 | T14, T16 |
| T10 | T2, T8 | T14, T16 |
| T11 | T8 | T16 |
| T12 | T2, T5 | T16 |
| T13 | T2 | T16, T19 |
| T14 | T2, T6, T9, T10 | T15, T16 |
| T15 | T2, T6, T14 | T16 |
| T16 | T3, T5, T6, T7, T9, T10, T11, T12, T13, T14, T15 | T17 |
| T17 | T4, T16 | T18, T19 |
| T18 | T17 | T20 |
| T19 | T17 | T20 |
| T20 | T18, T19 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1**: 4 tasks → T1 `quick`, T2 `quick`, T3 `quick`, T4 `quick`
- **Wave 2**: 3 tasks → T5 `unspecified-high`, T6 `unspecified-high`, T7 `deep`
- **Wave 3**: 6 tasks → T8 `deep`, T9 `deep`, T10 `unspecified-high`, T11 `quick`, T12 `deep`, T13 `deep`
- **Wave 4**: 3 tasks → T14 `deep`, T15 `deep`, T16 `unspecified-high`
- **Wave 5**: 3 tasks → T17 `visual-engineering`, T18 `visual-engineering`, T19 `visual-engineering`
- **Wave 6**: 1 task → T20 `unspecified-high`
- **FINAL**: 4 tasks → F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. Tauri 2 scaffold + rustfmt.toml + workspace Clippy lints

  **What to do**:
  - Run `bunx create-tauri-app` or manually scaffold `packages/desktop/src-tauri/` with `Cargo.toml`, `tauri.conf.json`, `build.rs`, `src/main.rs`, `src/lib.rs`
  - Tauri 2 dependencies: `tauri = { version = "2", features = ["..."] }`, `tauri-build = "2"`, `serde`, `serde_json`, `tokio = { features = ["full"] }`
  - Create `packages/desktop/src-tauri/rustfmt.toml`:
    ```toml
    edition = "2024"
    style_edition = "2024"
    ```
  - Add workspace lints to `Cargo.toml` `[lints]` section (boxxy standard):
    ```toml
    [lints.rust]
    rust_2018_idioms = "deny"
    unused_must_use = "deny"
    unreachable_pub = "deny"

    [lints.clippy]
    all = { level = "warn", priority = -1 }
    correctness = { level = "warn", priority = -1 }
    suspicious = { level = "warn", priority = -1 }
    complexity = { level = "warn", priority = -1 }
    perf = { level = "warn", priority = -1 }
    style = { level = "warn", priority = -1 }
    pedantic = "warn"
    type_complexity = "warn"
    nursery = "warn"
    ```
  - `tauri.conf.json`: set `productName = "TwirChat"`, `identifier = "dev.twirchat.app"`, `windows[0].title = "TwirChat"`, `windows[0].width = 800`, `windows[0].height = 1200`
  - `build.rs`: standard Tauri build script
  - `src/main.rs`: `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` + `fn main() { app_lib::run() }`
  - `src/lib.rs`: `pub fn run() { tauri::Builder::default().run(...).expect("error running tauri app") }`
  - Verify: `cargo check` exits 0, `cargo fmt -- --check` exits 0, `cargo clippy -- -D warnings` exits 0

  **Must NOT do**:
  - Do NOT add any platform adapter code yet — just the empty skeleton
  - Do NOT modify `packages/backend` or `packages/shared`
  - Do NOT add `#[allow(clippy::...)]` suppressions

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure scaffolding — well-defined structure, no logic decisions
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (first task, nothing exists yet)
  - **Parallel Group**: Wave 1 (starts all other Wave 1 tasks)
  - **Blocks**: T2, T3, T4
  - **Blocked By**: None

  **References**:
  - `packages/desktop/electrobun.config.ts` — current app metadata (name, identifier) to replicate in tauri.conf.json
  - `packages/desktop/package.json` — current scripts to understand build flow
  - boxxy `rustfmt.toml`: `edition = "2024"`, `style_edition = "2024"` (confirmed from research)
  - Tauri 2 docs: https://v2.tauri.app/start/create-project/

  **Acceptance Criteria**:

  - [ ] `packages/desktop/src-tauri/Cargo.toml` exists with tauri 2.x dependency
  - [ ] `packages/desktop/src-tauri/rustfmt.toml` exists with `edition = "2024"`
  - [ ] `packages/desktop/src-tauri/tauri.conf.json` exists with correct productName + window size

  ```
  Scenario: Rust project compiles cleanly
    Tool: Bash
    Preconditions: Cargo.toml and src/ files created
    Steps:
      1. cd packages/desktop/src-tauri && cargo check 2>&1
      2. Assert: exit code 0, no "error[E...]" lines
    Expected Result: "Finished" message, exit 0
    Evidence: .sisyphus/evidence/task-1-cargo-check.txt

  Scenario: Format and lint pass
    Tool: Bash
    Steps:
      1. cargo fmt -- --check 2>&1 → exit 0
      2. cargo clippy -- -D warnings 2>&1 → exit 0
    Expected Result: Both exit 0, no warnings promoted to errors
    Evidence: .sisyphus/evidence/task-1-clippy.txt
  ```

  **Commit**: YES
  - Message: `chore(desktop): scaffold Tauri 2 crate with rustfmt + clippy lints`
  - Files: `packages/desktop/src-tauri/**`

- [x] 2. Rust error types (thiserror) + shared Rust type definitions

  **What to do**:
  - Add `thiserror` to `Cargo.toml`
  - Create `src/error.rs`:
    ```rust
    #[derive(Debug, thiserror::Error)]
    pub enum AppError {
        #[error("database error: {0}")]
        Database(#[from] rusqlite::Error),
        #[error("io error: {0}")]
        Io(#[from] std::io::Error),
        #[error("auth error: {0}")]
        Auth(String),
        #[error("adapter error: {0}")]
        Adapter(String),
        #[error("serialization error: {0}")]
        Serde(#[from] serde_json::Error),
        #[error("not found: {0}")]
        NotFound(String),
    }
    // Make AppError serializable for Tauri commands
    impl serde::Serialize for AppError { ... }
    ```
  - Create `src/types.rs` with Rust equivalents of `packages/shared/types.ts`:
    - `NormalizedChatMessage`, `NormalizedEvent`, `Account`, `AppSettings`, `Platform` enum (`Twitch`, `YouTube`, `Kick`)
    - All must `#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]`
  - Re-export from `src/lib.rs`

  **Must NOT do**:
  - Do NOT use `String` for all errors — use typed variants with `thiserror`
  - Do NOT use `unwrap()` or `expect()` outside of tests
  - Do NOT duplicate logic already in `packages/shared/types.ts` for the frontend — these are Rust-only types

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical type translation — no architectural decisions
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T3, T4 after T1)
  - **Parallel Group**: Wave 1 (with T3, T4)
  - **Blocks**: T3, T5, T6, T8, T9, T10, T12, T13, T14, T15
  - **Blocked By**: T1

  **References**:
  - `packages/shared/types.ts` — canonical type definitions to mirror in Rust
  - `packages/shared/constants.ts` — `OVERLAY_SERVER_PORT = 45823`
  - `packages/shared/protocol.ts` — `BackendToDesktopMessage` / `DesktopToBackendMessage` shapes

  **Acceptance Criteria**:
  - [ ] `src/error.rs` exists, `AppError` implements `serde::Serialize`
  - [ ] `src/types.rs` has `Platform` enum with `Twitch`, `YouTube`, `Kick` variants
  - [ ] `cargo check` exits 0

  ```
  Scenario: Types compile without errors
    Tool: Bash
    Steps:
      1. cargo check 2>&1
      2. Assert: exit 0
    Expected Result: No type errors
    Evidence: .sisyphus/evidence/task-2-cargo-check.txt
  ```

  **Commit**: YES (groups with T1)
  - Message: `chore(desktop): add AppError, shared Rust types`

- [x] 3. Rust stubs for all 40+ Tauri commands (cargo check target for frontend migration)

  **What to do**:
  - Create `src/commands/` module with stub `#[tauri::command]` functions for every RPC request type in `packages/desktop/src/shared/rpc.ts`
  - Each stub returns `Ok(serde_json::Value::Null)` or the correct placeholder type
  - Group by domain: `src/commands/accounts.rs`, `src/commands/settings.rs`, `src/commands/connections.rs`, `src/commands/auth.rs`, `src/commands/stream.rs`, `src/commands/overlay.rs`, `src/commands/messages.rs`
  - Register all commands in `tauri::Builder::default().invoke_handler(tauri::generate_handler![...])`
  - Full list of commands to stub (from RPC schema research):
    - accounts: `get_accounts`, `get_account`, `remove_account`
    - settings: `get_settings`, `update_settings`
    - connections: `connect_channel`, `disconnect_channel`, `get_channel_connections`, `get_watched_channels`, `add_watched_channel`, `remove_watched_channel`
    - auth: `start_twitch_auth`, `start_youtube_auth`, `start_kick_auth`, `get_auth_url`, `exchange_code`
    - stream: `search_categories`, `update_stream_title`, `update_stream_category`, `get_stream_status`, `get_channels_status`
    - messages: `get_chat_messages`, `clear_chat_messages`, `get_user_aliases`, `set_user_alias`, `remove_user_alias`
    - overlay: `get_overlay_settings`, `update_overlay_settings`, `push_overlay_message`, `push_overlay_event`
    - misc: `get_app_version`, `open_external_url`, `check_for_update`, `download_update`, `apply_update`, `skip_update`

  **Must NOT do**:
  - Do NOT implement any real logic — these are stubs only
  - Do NOT invent command names — use exact names derived from `TwirChatRPCSchema` in `rpc.ts`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical stub generation from existing type inventory
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T2, T4 after T1)
  - **Parallel Group**: Wave 1
  - **Blocks**: T16 (which wires real logic to these stubs)
  - **Blocked By**: T1, T2

  **References**:
  - `packages/desktop/src/shared/rpc.ts` — authoritative list of ALL request/message types
  - `packages/desktop/src/bun/index.ts` — handler implementations showing exact payload shapes

  **Acceptance Criteria**:
  - [ ] All ~40 commands registered in `invoke_handler![]`
  - [ ] `cargo check` exits 0

  ```
  Scenario: All stubs compile
    Tool: Bash
    Steps:
      1. cargo check 2>&1
      2. Assert: exit 0, count of "pub fn" in src/commands/ matches known RPC count
    Expected Result: exit 0
    Evidence: .sisyphus/evidence/task-3-cargo-check.txt
  ```

  **Commit**: YES (groups with T1)
  - Message: `chore(desktop): add Tauri command stubs for all RPC handlers`

- [x] 4. Remove Electrobun deps + update package.json + vite configs for Tauri

  **What to do**:
  - In `packages/desktop/package.json`:
    - Remove: `electrobun`, `electrobun/bun`, `electrobun/view` dependencies
    - Add: `@tauri-apps/api`, `@tauri-apps/cli` (devDep)
    - Update `dev` script: `tauri dev` (instead of `electrobun dev`)
    - Update `build` script: `tauri build` (instead of `electrobun build`)
    - Keep: `concurrently`, `vite`, `@vitejs/plugin-vue`, `vue`, `vue-tsc`
  - In `vite.main.config.ts`:
    - Remove Electrobun-specific plugins
    - Set `base: './'`, `build.outDir: '../dist/main'`
    - Keep Vue plugin
  - Delete `electrobun.config.ts`
  - Update `packages/desktop/tsconfig.json`:
    - Remove `electrobun/bun` and `electrobun/view` from types/paths
    - Add `@tauri-apps/api` type references
  - DO NOT touch `packages/desktop/src/views/` yet — frontend migration is Task 17-19

  **Must NOT do**:
  - Do NOT start migrating IPC calls — this task is deps/config only
  - Do NOT remove `electrobun/view` imports from Vue files (Task 17 handles this)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Package.json + config edits, no logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T2, T3 after T1)
  - **Parallel Group**: Wave 1
  - **Blocks**: T17
  - **Blocked By**: T1

  **References**:
  - `packages/desktop/package.json` — current deps to remove/add
  - `packages/desktop/electrobun.config.ts` — to be deleted
  - `packages/desktop/vite.main.config.ts` — to update
  - `packages/desktop/tsconfig.json` — to update type references
  - `@tauri-apps/api` docs: https://v2.tauri.app/reference/javascript/

  **Acceptance Criteria**:
  - [ ] `packages/desktop/package.json` has `@tauri-apps/api` and no `electrobun` deps
  - [ ] `electrobun.config.ts` deleted
  - [ ] `bun install` succeeds in packages/desktop

  ```
  Scenario: bun install succeeds after dep change
    Tool: Bash
    Steps:
      1. bun install in packages/desktop 2>&1
      2. Assert: exit 0, no "UNMET DEPENDENCY" errors
    Expected Result: Clean install
    Evidence: .sisyphus/evidence/task-4-bun-install.txt
  ```

  **Commit**: YES
  - Message: `chore(desktop): replace Electrobun with Tauri 2 deps + update vite config`

- [x] 5. Rust SQLite stores: accounts, settings, client_identity

  **What to do**:
  - Add `rusqlite = { version = "0.31", features = ["bundled"] }` + `aes-gcm`, `rand`, `hex` to `Cargo.toml`
  - Create `src/store/mod.rs`, `src/store/db.rs` — open SQLite DB via Tauri data dir
  - DB path logic:
    ```rust
    // Use tauri app_data_dir() → <data_dir>/twirchat/data.db
    // Check old Electrobun path (~/.local/share/TwirChat/db.sqlite on Linux)
    // If old path exists AND new path doesn't → copy file, log migration
    ```
  - Create `src/store/accounts.rs`:
    - Struct `Account` mirroring DB schema (id, platform, platform_user_id, username, display_name, access_token_encrypted, refresh_token_encrypted, expires_at, avatar_url, created_at)
    - CRUD: `get_all()`, `get_by_id()`, `upsert()`, `delete()`
    - Token decryption: detect XOR-encrypted tokens (attempt XOR decode with `client_identity.secret`), re-encrypt with AES-256-GCM immediately
  - Create `src/store/settings.rs`:
    - Struct `AppSettings` mirroring schema
    - `get()` → returns settings row (create default if missing), `update()`
  - Create `src/store/client_identity.rs`:
    - `get_or_create()` → reads existing `client_secret` UUID, creates one if table is empty
    - CRITICAL: must read existing UUID — do NOT generate a new one if one exists
  - All store functions use `Result<T, AppError>`

  **Must NOT do**:
  - Do NOT change column names or types from the existing SQLite schema
  - Do NOT generate a new `client_secret` if one already exists in the DB
  - Do NOT use `unwrap()` — use `?` operator throughout

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Non-trivial Rust, token migration logic requires careful handling
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T6, T7 — but T7 depends on T5+T6)
  - **Parallel Group**: Wave 2 (with T6)
  - **Blocks**: T7, T12, T16
  - **Blocked By**: T2

  **References**:
  - `packages/desktop/src/store/account-store.ts` — TypeScript implementation to port
  - `packages/desktop/src/store/settings-store.ts` — settings store to port
  - `packages/desktop/src/store/client-secret.ts` — client identity store
  - `packages/desktop/src/store/crypto.ts` — XOR encryption implementation (must replicate XOR decode in Rust for migration)
  - `packages/desktop/src/store/db.ts` — schema migrations (table definitions)

  **Acceptance Criteria**:
  - [ ] `src/store/accounts.rs` compiled, CRUD functions exist
  - [ ] `src/store/settings.rs` compiled
  - [ ] `src/store/client_identity.rs` compiled, reads existing UUID

  ```
  Scenario: Store unit tests pass
    Tool: Bash
    Steps:
      1. cargo test store:: 2>&1
      2. Assert: all store tests pass
    Expected Result: "test result: ok"
    Evidence: .sisyphus/evidence/task-5-store-tests.txt

  Scenario: client_secret preserved across cold start
    Tool: Bash (cargo test)
    Steps:
      1. Write a test that creates a temp DB, inserts a known UUID
      2. Call get_or_create(), assert returned UUID equals the inserted one
    Expected Result: UUID unchanged
    Evidence: .sisyphus/evidence/task-5-client-secret-preserved.txt
  ```

  **Commit**: YES
  - Message: `feat(desktop): Rust SQLite stores for accounts, settings, client_identity`

- [x] 6. Rust SQLite stores: chat_messages, channel_connections, watched_channels, user_aliases

  **What to do**:
  - Create `src/store/messages.rs`:
    - `save_message(msg: NormalizedChatMessage)` — insert into `chat_messages`
    - `get_recent(channel: &str, limit: u32)` — query recent messages
    - `clear_channel(channel: &str)` — delete messages for channel
  - Create `src/store/connections.rs`:
    - `ChannelConnection` struct: id, platform, channel_name, channel_id, connected_at, status
    - `get_all()`, `upsert()`, `delete()`, `update_status()`
  - Create `src/store/watched_channels.rs`:
    - `WatchedChannel` struct: platform, channel_name, channel_id, display_name
    - `get_all()`, `add()`, `remove()`
  - Create `src/store/user_aliases.rs`:
    - `UserAlias` struct: platform, platform_user_id, alias
    - `get_all()` → `HashMap<(Platform, String), String>`
    - `set_alias()`, `remove_alias()`
  - All use `Result<T, AppError>`

  **Must NOT do**:
  - Do NOT change existing column names (user_aliases table already exists in schema)
  - Do NOT use `unwrap()`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Straightforward but more store modules with SQL to get right
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T5)
  - **Parallel Group**: Wave 2 (with T5)
  - **Blocks**: T7, T14, T15, T16
  - **Blocked By**: T2

  **References**:
  - `packages/desktop/src/store/db.ts` — full schema with all CREATE TABLE statements
  - `packages/desktop/src/chat/aggregator.ts` — how messages are stored/retrieved
  - `packages/shared/types.ts:NormalizedChatMessage` — message shape to store

  **Acceptance Criteria**:
  - [ ] All 4 store modules compile and have unit tests
  - [ ] `cargo test store::` passes

  ```
  Scenario: Chat message round-trip
    Tool: Bash (cargo test)
    Steps:
      1. Test: create temp DB, save a NormalizedChatMessage, get_recent(limit=10)
      2. Assert: returned message equals saved message
    Expected Result: Round-trip passes
    Evidence: .sisyphus/evidence/task-6-message-roundtrip.txt
  ```

  **Commit**: YES (groups with T5)
  - Message: `feat(desktop): Rust stores for messages, connections, watched_channels, user_aliases`

- [x] 7. DB path migration + token XOR→AES-GCM re-encryption

  **What to do**:
  - Create `src/store/migration.rs`:
    ```rust
    pub fn migrate_db_path(app: &tauri::AppHandle) -> Result<(), AppError> {
        let new_path = app.path().app_data_dir()?.join("data.db");
        if new_path.exists() { return Ok(()); }
        // Linux: ~/.local/share/TwirChat/db.sqlite
        // macOS: ~/Library/Application Support/TwirChat/db.sqlite
        // Windows: %APPDATA%\TwirChat\db.sqlite
        let old_paths = get_electrobun_paths();
        for old in old_paths {
            if old.exists() {
                std::fs::copy(&old, &new_path)?;
                return Ok(());
            }
        }
        Ok(()) // No old DB → first run
    }
    ```
  - Token re-encryption on first read in `accounts.rs`:
    ```rust
    // If token starts with XOR prefix marker OR decodes as valid UTF-8 via XOR:
    //   1. XOR-decode with client_secret bytes (same algorithm as crypto.ts)
    //   2. Re-encrypt with AES-256-GCM using client_secret as key material
    //   3. Update the DB row immediately
    ```
  - XOR algorithm (from `crypto.ts`):
    - Key = client_secret string bytes, repeated cyclically
    - Data = hex-decoded stored token
    - XOR each byte with corresponding key byte
  - AES-256-GCM: use `aes-gcm` crate, derive 32-byte key via SHA-256(client_secret), random 12-byte nonce prepended to ciphertext

  **Must NOT do**:
  - Do NOT delete the old Electrobun DB after migration (leave it as backup)
  - Do NOT fail startup if old DB not found (first-time install)
  - Do NOT change the DB schema during migration

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Crypto migration logic is security-sensitive and must be exactly correct
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs both T5 and T6 complete)
  - **Parallel Group**: Wave 2 (sequential within wave)
  - **Blocks**: T16
  - **Blocked By**: T5, T6

  **References**:
  - `packages/desktop/src/store/crypto.ts` — exact XOR algorithm to replicate in Rust
  - `packages/desktop/src/store/db.ts` — schema migrations, DB open logic
  - `packages/desktop/src/store/account-store.ts` — how tokens are stored/retrieved

  **Acceptance Criteria**:
  - [ ] `src/store/migration.rs` exists with `migrate_db_path()`
  - [ ] Token re-encryption test: XOR-encoded token is decoded and re-encoded in AES-GCM

  ```
  Scenario: XOR token decoded correctly
    Tool: Bash (cargo test)
    Steps:
      1. Test: take a known XOR-encoded token (hardcoded test vector from crypto.ts), decode with known key
      2. Assert: decoded value matches expected plaintext
    Expected Result: Decryption matches
    Evidence: .sisyphus/evidence/task-7-xor-decode.txt

  Scenario: DB path migration copies file
    Tool: Bash (cargo test)
    Steps:
      1. Test: create a temp old-path DB, run migrate_db_path
      2. Assert: new path file exists
    Expected Result: File copied
    Evidence: .sisyphus/evidence/task-7-db-migration.txt
  ```

  **Commit**: YES (groups with T5+T6)
  - Message: `feat(desktop): DB path migration + XOR→AES-GCM token re-encryption`

- [x] 8. AdapterTaskManager trait + lifecycle state machine

  **What to do**:
  - Create `src/platforms/mod.rs` and `src/platforms/adapter.rs`
  - Define the `PlatformAdapter` trait:
    ```rust
    #[async_trait::async_trait]
    pub trait PlatformAdapter: Send + Sync {
        async fn connect(&self, channel: &str) -> Result<(), AppError>;
        async fn disconnect(&self, channel: &str) -> Result<(), AppError>;
        fn platform(&self) -> Platform;
    }
    ```
  - Define `AdapterState` enum: `Disconnected`, `Connecting`, `Connected`, `Disconnecting`, `Error(String)`
  - Create `AdapterTaskManager<A: PlatformAdapter>`:
    - Holds a `tokio::sync::Mutex<AdapterState>` per channel
    - `connect(channel)` → spawn tokio task, transition states
    - `disconnect(channel)` → abort task, transition to Disconnected
    - `get_state(channel)` → current state
    - Channel-keyed `HashMap<String, JoinHandle<()>>`
  - Add `async-trait`, `tokio` (full features) to `Cargo.toml`

  **Must NOT do**:
  - Do NOT implement actual Twitch/Kick logic here — this is the shared framework only
  - Do NOT use `std::thread` — use `tokio::task::spawn`

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Async Rust state machine — tokio task lifecycle requires careful design
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T9-T13 in Wave 3, but T9/T10/T11 depend on T8)
  - **Parallel Group**: Wave 3 (must finish before T9, T10, T11 can proceed)
  - **Blocks**: T9, T10, T11
  - **Blocked By**: T2

  **References**:
  - `packages/desktop/src/platforms/base-adapter.ts` — TypeScript base adapter to mirror
  - `packages/desktop/src/bun/index.ts` — how adapters are started/stopped (connectToChannel, disconnectFromChannel handlers)

  **Acceptance Criteria**:
  - [ ] `AdapterTaskManager` compiles
  - [ ] State transitions tested: Disconnected → Connecting → Connected → Disconnecting → Disconnected

  ```
  Scenario: Adapter state machine transitions
    Tool: Bash (cargo test)
    Steps:
      1. cargo test platforms::adapter:: 2>&1
    Expected Result: "test result: ok"
    Evidence: .sisyphus/evidence/task-8-adapter-state.txt
  ```

  **Commit**: YES (groups with Wave 3)

- [x] 9. Twitch IRC adapter (twitch-irc crate)

  **What to do**:
  - Add `twitch-irc = "5"` to `Cargo.toml`
  - Create `src/platforms/twitch/mod.rs` and `src/platforms/twitch/adapter.rs`
  - Implement `PlatformAdapter` for `TwitchAdapter`
  - Connect: `TwitchIRCClient::new(config)`, join channel with OAuth token from accounts store
  - Message parsing:
    - `PRIVMSG` → `NormalizedChatMessage` (map badges, emotes, bits, color, display-name)
    - `USERNOTICE` msg-id `sub`/`resub`/`subgift`/`raid`/`cheer` → `NormalizedEvent`
    - `CLEARCHAT` / `CLEARMSG` → moderation event
  - Badge fetching: call `packages/backend` REST endpoint (or Twitch API directly if no backend endpoint)
  - Emit Tauri events: `chat:message`, `chat:event` to all windows
  - Config: anonymous for read-only, authenticated for full features

  **Must NOT do**:
  - Do NOT port `@twurple/chat` — use `twitch-irc` Rust crate instead
  - Do NOT implement in webview — Rust main process only
  - Do NOT add features not in the existing TypeScript adapter

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex IRC parsing, event mapping, async connection lifecycle
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T10, T11, T12, T13 after T8)
  - **Parallel Group**: Wave 3
  - **Blocks**: T14, T16
  - **Blocked By**: T2, T8

  **References**:
  - `packages/desktop/src/platforms/twitch/adapter.ts` — full TypeScript implementation to port
  - `packages/shared/types.ts:NormalizedChatMessage` — output shape required
  - `twitch-irc` crate docs: https://docs.rs/twitch-irc/latest/twitch_irc/
  - `packages/desktop/src/bun/index.ts` — how Twitch adapter is instantiated (look for `TwitchAdapter`)

  **Acceptance Criteria**:
  - [ ] `TwitchAdapter` implements `PlatformAdapter` trait
  - [ ] Compiles: `cargo check`
  - [ ] Unit test: parse a sample PRIVMSG IRC line → correct `NormalizedChatMessage`

  ```
  Scenario: PRIVMSG parsed to NormalizedChatMessage
    Tool: Bash (cargo test)
    Steps:
      1. Test: feed raw IRC "@badges=...;color=#FF0000;display-name=TestUser :testuser!... PRIVMSG #channel :hello world"
      2. Parse with adapter's message parser
      3. Assert: author.displayName == "TestUser", content == "hello world", platform == Platform::Twitch
    Expected Result: Correct NormalizedChatMessage
    Evidence: .sisyphus/evidence/task-9-twitch-parse.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(desktop): Twitch IRC adapter in Rust (twitch-irc)`

- [x] 10. Kick WebSocket adapter (tokio-tungstenite)

  **What to do**:
  - Add `tokio-tungstenite = { version = "0.24", features = ["native-tls"] }`, `url` to `Cargo.toml`
  - Create `src/platforms/kick/mod.rs` and `src/platforms/kick/adapter.rs`
  - Implement `PlatformAdapter` for `KickAdapter`
  - Connect to Kick Pusher-style WebSocket: `wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.6.0&flash=false`
  - Subscribe to channel: send `{"event":"pusher:subscribe","data":{"auth":"","channel":"chatrooms.<chatroom_id>.v2"}}`
  - Parse incoming events:
    - `App\Events\ChatMessageEvent` → `NormalizedChatMessage`
    - `App\Events\ChatroomClearEvent` → clear chat event
    - `App\Events\MessageDeletedEvent` → delete message event
  - Chatroom ID: fetch from Kick API (`https://kick.com/api/v2/channels/<username>`) before connecting
  - Emit Tauri events: `chat:message`, `chat:event`
  - Reconnect with exponential backoff on disconnect

  **Must NOT do**:
  - Do NOT use the `ws` JavaScript library — pure Rust tokio-tungstenite
  - Do NOT add Kick features not present in the TypeScript adapter

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: WebSocket client with JSON parsing, similar in complexity to Twitch but simpler protocol
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T9, T11, T12, T13)
  - **Parallel Group**: Wave 3
  - **Blocks**: T14, T16
  - **Blocked By**: T2, T8

  **References**:
  - `packages/desktop/src/platforms/kick/adapter.ts` — full TypeScript implementation to port
  - `packages/shared/types.ts:NormalizedChatMessage` — output shape
  - `packages/desktop/src/bun/index.ts` — how Kick chatroom ID is obtained before connect

  **Acceptance Criteria**:
  - [ ] `KickAdapter` implements `PlatformAdapter` trait
  - [ ] Unit test: parse sample Kick ChatMessageEvent JSON → correct `NormalizedChatMessage`
  - [ ] `cargo check` exits 0

  ```
  Scenario: Kick message JSON parsed correctly
    Tool: Bash (cargo test)
    Steps:
      1. Test: feed known Kick ChatMessageEvent JSON payload
      2. Assert: author.id == sender.id, content == message, platform == Platform::Kick
    Expected Result: Correct parse
    Evidence: .sisyphus/evidence/task-10-kick-parse.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(desktop): Kick WebSocket adapter in Rust (tokio-tungstenite)`

- [x] 11. YouTube stub adapter

  **What to do**:
  - Create `src/platforms/youtube/mod.rs` and `src/platforms/youtube/adapter.rs`
  - Implement `PlatformAdapter` for `YouTubeAdapter`:
    - `connect()` → return `Err(AppError::Adapter("YouTube adapter not yet implemented".into()))`
    - `disconnect()` → return `Ok(())`
    - `platform()` → `Platform::YouTube`
  - All YouTube Tauri commands that reach this adapter must surface the error to frontend
  - Add a `// TODO: implement YouTube Innertube polling` comment with link to `packages/desktop/src/platforms/youtube/adapter.ts`

  **Must NOT do**:
  - Do NOT attempt to port the YouTube adapter — this is intentionally a stub
  - Do NOT crash the app when YouTube is used — return a user-friendly error via Tauri command result

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Intentional stub — minimal code
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T9, T10, T12, T13)
  - **Parallel Group**: Wave 3
  - **Blocks**: T16
  - **Blocked By**: T8

  **References**:
  - `packages/desktop/src/platforms/youtube/adapter.ts` — reference implementation (for comment/TODO only)
  - `packages/shared/types.ts:Platform` — YouTube variant

  **Acceptance Criteria**:
  - [ ] `YouTubeAdapter::connect()` returns an error with message "YouTube adapter not yet implemented"
  - [ ] `cargo check` exits 0

  ```
  Scenario: YouTube connect returns error
    Tool: Bash (cargo test)
    Steps:
      1. Test: call YouTubeAdapter::connect("channel") in a tokio runtime
      2. Assert: returns Err with message containing "not yet implemented"
    Expected Result: Correct error
    Evidence: .sisyphus/evidence/task-11-youtube-stub.txt
  ```

  **Commit**: YES (groups with Wave 3)

- [x] 12. PKCE OAuth flows in Rust (Twitch + YouTube + Kick)

  **What to do**:
  - Add `axum = "0.7"`, `reqwest = { features = ["json"] }`, `base64`, `sha2`, `rand` to `Cargo.toml`
  - Create `src/auth/pkce.rs`:
    - `generate_code_verifier()` → 128-char random alphanumeric string
    - `generate_code_challenge(verifier)` → BASE64URL(SHA256(verifier))
    - Port all assertions from `packages/desktop/src/auth/pkce.ts` as unit tests
  - Create `src/auth/server.rs`:
    - Local HTTP callback server using `axum` on a random ephemeral port (bind to `127.0.0.1:0`)
    - Single route: `GET /callback?code=...&state=...`
    - Returns `oneshot::Receiver<(String, String)>` (code, state)
    - Server shuts down after first callback
  - Create `src/auth/twitch.rs`, `src/auth/youtube.rs`, `src/auth/kick.rs`:
    - Build authorization URL (with PKCE params + redirect_uri = localhost:PORT/callback)
    - Open URL in system browser: `tauri::api::shell::open()`
    - Await callback server, exchange code for tokens via `reqwest`
    - Store tokens via accounts store

  **Must NOT do**:
  - Do NOT use a fixed port for the callback server — must bind to :0 (ephemeral)
  - Do NOT store client secrets in code — read from environment or settings store

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Security-sensitive auth flow with PKCE, async HTTP server, token exchange
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T9, T10, T11, T13)
  - **Parallel Group**: Wave 3
  - **Blocks**: T16
  - **Blocked By**: T2, T5

  **References**:
  - `packages/desktop/src/auth/pkce.ts` — PKCE helpers to port with test vectors
  - `packages/desktop/src/auth/twitch.ts` — Twitch OAuth flow
  - `packages/desktop/src/auth/youtube.ts` — YouTube OAuth flow
  - `packages/desktop/src/auth/kick.ts` — Kick OAuth flow
  - `packages/desktop/src/auth/server.ts` — local callback HTTP server (Bun.serve → axum)

  **Acceptance Criteria**:
  - [ ] `generate_code_verifier()` produces 128-char string
  - [ ] `generate_code_challenge()` matches known test vector
  - [ ] Callback server binds and receives code

  ```
  Scenario: PKCE challenge matches expected value
    Tool: Bash (cargo test)
    Steps:
      1. cargo test auth::pkce:: 2>&1
      2. Assert: all PKCE tests pass (known verifier → known challenge)
    Expected Result: "test result: ok"
    Evidence: .sisyphus/evidence/task-12-pkce-tests.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(desktop): PKCE OAuth flows in Rust (Twitch/YouTube/Kick)`

- [x] 13. Overlay Axum HTTP+WS server on port 45823

  **What to do**:
  - Create `src/overlay/server.rs`
  - Axum router:
    - `GET /` → serve `dist/overlay/index.html` from filesystem
    - `GET /assets/*path` → serve `dist/overlay/assets/{path}` from filesystem
    - `GET /ws` → WebSocket upgrade handler
  - WebSocket: maintain a `broadcast::Sender<OverlayMessage>` (tokio::sync::broadcast)
  - `push_message(msg: NormalizedChatMessage)` → broadcast to all WS clients
  - `push_event(event: NormalizedEvent)` → broadcast to all WS clients
  - WS message format: JSON matching existing `packages/desktop/src/overlay-server.ts` protocol
  - Static file path: `{app_resource_dir}/dist/overlay/` (NOT embedded — filesystem)
  - Start server as a `tokio::task::spawn` during app init
  - Port: hardcoded `45823` (from `OVERLAY_SERVER_PORT` constant)

  **Must NOT do**:
  - Do NOT use Tauri asset protocol for overlay (OBS cannot access asset:// URLs)
  - Do NOT change the WebSocket message format (OBS overlay depends on it)
  - Do NOT embed overlay files with `include_bytes!` — serve from filesystem

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Async HTTP+WS server with broadcast channel, file serving
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T9-T12)
  - **Parallel Group**: Wave 3
  - **Blocks**: T16, T19
  - **Blocked By**: T2

  **References**:
  - `packages/desktop/src/overlay-server.ts` — exact implementation to port (Bun.serve → Axum)
  - `packages/shared/constants.ts:OVERLAY_SERVER_PORT` = 45823
  - `packages/desktop/src/views/overlay/App.vue` — WebSocket client (to verify protocol compatibility)

  **Acceptance Criteria**:
  - [ ] `curl -sf http://localhost:45823/` returns HTML
  - [ ] WebSocket connects to `ws://localhost:45823/ws`

  ```
  Scenario: Overlay HTTP server serves index.html
    Tool: Bash (curl)
    Preconditions: App running, dist/overlay/ exists
    Steps:
      1. curl -sf http://localhost:45823/ 2>&1
      2. Assert: response contains "<html"
    Expected Result: HTML response, exit 0
    Evidence: .sisyphus/evidence/task-13-overlay-http.txt

  Scenario: WebSocket connects successfully
    Tool: Bash (websocat or cargo test)
    Steps:
      1. Connect to ws://localhost:45823/ws
      2. Assert: connection established without error
    Expected Result: WS handshake succeeds
    Evidence: .sisyphus/evidence/task-13-overlay-ws.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(desktop): Axum overlay HTTP+WS server on port 45823`

- [x] 14. Backend WebSocket client (X-Client-Secret, 7TV events, reconnect)

  **What to do**:
  - Create `src/backend/connection.rs`
  - WebSocket client using `tokio-tungstenite` connecting to backend WS URL (from settings/env)
  - Attach header: `X-Client-Secret: <client_secret>` on connect
  - Parse incoming `BackendToDesktopMessage` (from `packages/shared/protocol.ts`)
  - Forward chat messages → emit Tauri `chat:message` event
  - Forward 7TV events (`channel_emotes_set`, `channel_emote_added`, `channel_emote_removed`, `channel_emote_updated`) → emit Tauri `7tv:event`
  - Reconnect strategy: exponential backoff (1s, 2s, 4s, 8s, max 30s)
  - Expose `BackendConnectionManager` with `connect()`, `disconnect()`, `is_connected()` → `Arc<Mutex<bool>>`

  **Must NOT do**:
  - Do NOT change `BackendToDesktopMessage` shape — it's defined in `packages/shared`
  - Do NOT change `DesktopToBackendMessage` shape
  - Do NOT implement backend logic here — only the WS client

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Async WS client with reconnect loop and event forwarding
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T15)
  - **Parallel Group**: Wave 4 (with T15)
  - **Blocks**: T15, T16
  - **Blocked By**: T2, T6, T9, T10

  **References**:
  - `packages/desktop/src/backend-connection.ts` — TypeScript implementation to port
  - `packages/shared/protocol.ts` — `BackendToDesktopMessage` and `DesktopToBackendMessage` types
  - `packages/desktop/src/bun/index.ts` — how backend connection is initialized and used

  **Acceptance Criteria**:
  - [ ] `BackendConnectionManager` compiles
  - [ ] Unit test: parse a `BackendToDesktopMessage::ChatMessage` variant

  ```
  Scenario: BackendToDesktopMessage parsed correctly
    Tool: Bash (cargo test)
    Steps:
      1. Test: deserialize JSON matching BackendToDesktopMessage::ChatMessage from protocol.ts
      2. Assert: all fields present, no deserialization error
    Expected Result: Deserialization succeeds
    Evidence: .sisyphus/evidence/task-14-backend-protocol.txt
  ```

  **Commit**: YES (groups with Wave 4)

- [x] 15. ChatAggregator in Rust (dedup, ring buffer 500, 7TV emote merge)

  **What to do**:
  - Create `src/chat/aggregator.rs`
  - Port `packages/desktop/src/chat/aggregator.ts`:
    - Ring buffer: `VecDeque<NormalizedChatMessage>` capped at 500 messages
    - Deduplication: `HashMap<String, Instant>` keyed by `(platform, message_id)`, TTL 5s
    - `process_message(msg) -> Option<NormalizedChatMessage>`:
      - Return `None` if duplicate
      - Merge 7TV emotes from `seventy_tv_emote_cache` into message
      - Push to ring buffer
      - Save to messages store
    - `process_7tv_event(event)` → update emote cache
    - `get_recent(channel, limit)` → from ring buffer
  - All methods take `&mut self` or use `Arc<Mutex<ChatAggregatorState>>`

  **Must NOT do**:
  - Do NOT implement a different dedup strategy — match existing 5s TTL behavior

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Ring buffer + dedup + emote merging — stateful logic requiring correctness
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T14)
  - **Parallel Group**: Wave 4 (with T14)
  - **Blocks**: T16
  - **Blocked By**: T2, T6, T14

  **References**:
  - `packages/desktop/src/chat/aggregator.ts` — full TypeScript to port
  - `packages/desktop/tests/aggregator.test.ts` — existing tests to replicate in Rust

  **Acceptance Criteria**:
  - [ ] Dedup test: same message sent twice → only one processed
  - [ ] Ring buffer test: 600 messages → only 500 retained
  - [ ] 7TV emote merge test: emote in cache merged into message

  ```
  Scenario: Duplicate message is dropped
    Tool: Bash (cargo test)
    Steps:
      1. cargo test chat::aggregator:: 2>&1
    Expected Result: "test result: ok"
    Evidence: .sisyphus/evidence/task-15-aggregator-tests.txt
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `feat(desktop): ChatAggregator in Rust (dedup, ring buffer, 7TV merge)`

- [x] 16. Wire all 40+ Tauri command handlers to real implementations

  **What to do**:
  - Replace every stub in `src/commands/*.rs` with real implementations
  - Each command accesses shared state via `tauri::State<AppState>` where `AppState` contains:
    - `db: Arc<Mutex<rusqlite::Connection>>`
    - `aggregator: Arc<Mutex<ChatAggregator>>`
    - `twitch_manager: Arc<AdapterTaskManager<TwitchAdapter>>`
    - `kick_manager: Arc<AdapterTaskManager<KickAdapter>>`
    - `youtube_manager: Arc<AdapterTaskManager<YouTubeAdapter>>`
    - `backend_connection: Arc<BackendConnectionManager>`
    - `overlay_server: Arc<OverlayServer>`
  - Initialize `AppState` in `lib.rs` `run()` function, run DB migration, start overlay server, connect backend
  - Command mapping (examples):
    - `get_accounts` → `store::accounts::get_all(&state.db)`
    - `connect_channel(platform, channel)` → match platform, call `{platform}_manager.connect(channel)`
    - `get_chat_messages(channel, limit)` → `aggregator.get_recent(channel, limit)`
    - `push_overlay_message(msg)` → `overlay_server.push_message(msg)`
    - `start_twitch_auth` → `auth::twitch::start_auth_flow(app_handle)`
  - Verify all ~40 commands implemented (none returning `Null` stub)

  **Must NOT do**:
  - Do NOT implement business logic in command handlers — delegate to store/adapter/aggregator modules
  - Do NOT use global state (no `static mut`) — use Tauri managed state

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Large wiring task — many commands but mostly delegation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on all previous Wave 1-4 tasks)
  - **Parallel Group**: Wave 4 (final task in wave, sequential)
  - **Blocks**: T17, T18, T19
  - **Blocked By**: T3, T5, T6, T7, T9, T10, T11, T12, T13, T14, T15

  **References**:
  - `packages/desktop/src/bun/index.ts` — authoritative handler implementations (every handler documented in lines 1-770)
  - `packages/desktop/src/shared/rpc.ts` — RPC schema with payload types
  - All `src/commands/*.rs` stub files created in T3

  **Acceptance Criteria**:
  - [ ] `cargo check` exits 0
  - [ ] `grep -r "serde_json::Value::Null" src/commands/` returns 0 matches (no stubs remaining)
  - [ ] `cargo test` passes

  ```
  Scenario: No stub commands remain
    Tool: Bash
    Steps:
      1. grep -r "Value::Null" packages/desktop/src-tauri/src/commands/
      2. Assert: no output
    Expected Result: Empty (all stubs replaced)
    Evidence: .sisyphus/evidence/task-16-no-stubs.txt
  ```

  **Commit**: YES
  - Message: `feat(desktop): wire all Tauri command handlers to real implementations`

- [x] 17. Replace Electroview.defineRPC → @tauri-apps/api in main.ts + App.vue entry points

  **What to do**:
  - In `packages/desktop/src/views/main/main.ts`:
    - Remove `import { Electroview } from "electrobun/view"`
    - Remove `Electroview.defineRPC(...)` call
    - Remove `new Electroview({ rpc })`
    - Keep `createApp(App).mount("#app")`
    - Install `@tauri-apps/api`: already in package.json after T4
  - In `packages/desktop/src/views/main/App.vue`:
    - Remove any `rpc` prop passing or `rpc` imports from `electrobun/view`
    - Replace any top-level `rpc.on.*` listeners with `listen()` from `@tauri-apps/api/event`
  - Create `packages/desktop/src/views/main/composables/useTauriEvent.ts`:
    ```typescript
    import { listen } from '@tauri-apps/api/event'
    import { onMounted, onUnmounted } from 'vue'
    export function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
      let unlisten: (() => void) | null = null
      onMounted(async () => { unlisten = await listen<T>(event, e => handler(e.payload)) })
      onUnmounted(() => unlisten?.())
    }
    ```
  - Replace existing `useRpcListener` usages in App.vue with `useTauriEvent`

  **Must NOT do**:
  - Do NOT touch component-level `rpc.request.*` calls — Task 18 handles those
  - Do NOT remove event listener registrations — migrate them, don't remove

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Frontend entry point migration — Vue 3 composable patterns
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Vue 3 composable patterns, onMounted/onUnmounted lifecycle

  **Parallelization**:
  - **Can Run In Parallel**: NO (T18 and T19 depend on this)
  - **Parallel Group**: Wave 5 (entry point, must come first)
  - **Blocks**: T18, T19
  - **Blocked By**: T4, T16

  **References**:
  - `packages/desktop/src/views/main/main.ts` — file to modify
  - `packages/desktop/src/views/main/App.vue` — top-level event listeners to migrate
  - `packages/desktop/src/shared/rpc.ts` — event names to map to Tauri event strings
  - `@tauri-apps/api/event` docs: https://v2.tauri.app/reference/javascript/event/

  **Acceptance Criteria**:
  - [ ] `main.ts` has zero `electrobun` imports
  - [ ] `App.vue` uses `useTauriEvent` composable, not `rpc.on.*`
  - [ ] `bun run typecheck` exits 0 in packages/desktop

  ```
  Scenario: No electrobun imports in entry files
    Tool: Bash
    Steps:
      1. grep -n "electrobun" packages/desktop/src/views/main/main.ts
      2. grep -n "electrobun" packages/desktop/src/views/main/App.vue
      3. Assert: both return 0 matches
    Expected Result: No electrobun imports
    Evidence: .sisyphus/evidence/task-17-no-electrobun-imports.txt

  Scenario: TypeScript compiles after migration
    Tool: Bash
    Steps:
      1. bun run typecheck in packages/desktop 2>&1
      2. Assert: exit 0
    Expected Result: No type errors
    Evidence: .sisyphus/evidence/task-17-typecheck.txt
  ```

  **Commit**: YES (groups with Wave 5)
  - Message: `refactor(desktop): replace Electroview entry point with Tauri event API`

- [x] 18. Migrate all rpc.request.* calls in components → invoke()

  **What to do**:
  - Scan all `*.vue` and `*.ts` files under `src/views/main/`:
    - Replace `rpc.request.*` / `rpc.send.*` → `invoke('command_name', { args })` from `@tauri-apps/api/core`
    - Map each RPC method name to the Tauri command name (snake_case, matching T3/T16)
    - Replace `import { rpc } from '../main'` or similar with `import { invoke } from '@tauri-apps/api/core'`
  - Complete mapping (derive from `rpc.ts` BunRequests):
    - `rpc.request.getAccounts()` → `invoke<Account[]>('get_accounts')`
    - `rpc.request.connectChannel({ platform, channel })` → `invoke('connect_channel', { platform, channel })`
    - `rpc.request.getSettings()` → `invoke<AppSettings>('get_settings')`
    - (all ~40 request types)
  - Type the `invoke` calls with correct return types from `packages/shared/types.ts`

  **Must NOT do**:
  - Do NOT remove error handling — wrap `invoke` calls in try/catch
  - Do NOT use `any` as the generic type parameter for `invoke<T>` — always specify T

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Mechanical migration of IPC calls in Vue components
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Vue 3 TypeScript patterns for composables and component code

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T19 after T17)
  - **Parallel Group**: Wave 5
  - **Blocks**: T20
  - **Blocked By**: T17

  **References**:
  - `packages/desktop/src/shared/rpc.ts:BunRequests` — full list of request methods to replace
  - `packages/desktop/src/views/main/` — all Vue files to scan
  - `packages/desktop/src/views/main/App.vue` — primary consumer
  - `packages/desktop/src/views/main/components/ChatList.vue` — component with most RPC calls
  - `packages/shared/types.ts` — for typing `invoke<T>` generics

  **Acceptance Criteria**:
  - [ ] `grep -rn "rpc\.request\|rpc\.send" src/views/` = 0 matches
  - [ ] `bun run typecheck` exits 0
  - [ ] All `invoke` calls have explicit type parameters (no `invoke<any>`)

  ```
  Scenario: No rpc.request calls remain
    Tool: Bash
    Steps:
      1. grep -rn "rpc\.request\|rpc\.send" packages/desktop/src/views/ | wc -l
      2. Assert: output is 0
    Expected Result: 0
    Evidence: .sisyphus/evidence/task-18-no-rpc-requests.txt
  ```

  **Commit**: YES (groups with Wave 5)
  - Message: `refactor(desktop): migrate rpc.request.* → tauri invoke() in all components`

- [x] 19. Migrate all rpc.on.* event listeners → listen() + useTauriEvent composable

  **What to do**:
  - Scan all `*.vue` and `*.ts` files under `src/views/main/` for `rpc.on.*` calls
  - Replace with `useTauriEvent(eventName, handler)` composable (created in T17) or direct `listen()` calls
  - Event name mapping (derive from `rpc.ts` WebviewMessages):
    - `rpc.on.chat_message(handler)` → `useTauriEvent<NormalizedChatMessage>('chat:message', handler)`
    - `rpc.on.chat_event(handler)` → `useTauriEvent<NormalizedEvent>('chat:event', handler)`
    - `rpc.on.connection_status(handler)` → `useTauriEvent('connection:status', handler)`
    - `rpc.on.backend_status(handler)` → `useTauriEvent('backend:status', handler)`
    - `rpc.on.seventv_event(handler)` → `useTauriEvent('7tv:event', handler)`
    - (all 13 push event types)
  - Ensure `unlisten` cleanup happens in `onUnmounted` (via `useTauriEvent` composable)
  - Check `src/views/overlay/App.vue` — it uses direct WebSocket, NOT RPC, so no changes needed

  **Must NOT do**:
  - Do NOT touch `src/views/overlay/App.vue` — it uses its own WS client (not Electrobun RPC)
  - Do NOT leave unlistened events (memory leak) — composable handles cleanup

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Vue event listener migration with lifecycle cleanup
  - **Skills**: [`vue3-best-practices`]
    - `vue3-best-practices`: Vue 3 composable lifecycle patterns (onMounted/onUnmounted)

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with T18 after T17)
  - **Parallel Group**: Wave 5
  - **Blocks**: T20
  - **Blocked By**: T17

  **References**:
  - `packages/desktop/src/shared/rpc.ts:WebviewMessages` — all push event types to map
  - `packages/desktop/src/views/main/App.vue` — primary event listener location
  - `packages/desktop/src/views/main/components/ChatList.vue` — check for rpc.on usage
  - `packages/desktop/src/views/overlay/App.vue` — DO NOT TOUCH (uses plain WS, not RPC)

  **Acceptance Criteria**:
  - [ ] `grep -rn "rpc\.on\b" packages/desktop/src/views/main/` = 0 matches
  - [ ] `bun run typecheck` exits 0
  - [ ] `grep -rn "electrobun\|Electroview" packages/desktop/src/views/` = 0 matches

  ```
  Scenario: No rpc.on calls remain in main views
    Tool: Bash
    Steps:
      1. grep -rn "rpc\.on\b" packages/desktop/src/views/main/ | wc -l
      2. Assert: output is 0
    Expected Result: 0
    Evidence: .sisyphus/evidence/task-19-no-rpc-on.txt

  Scenario: Final electrobun grep across all views
    Tool: Bash
    Steps:
      1. grep -rn "electrobun\|Electroview" packages/desktop/src/views/ | wc -l
      2. Assert: output is 0
    Expected Result: 0
    Evidence: .sisyphus/evidence/task-19-electrobun-clean.txt
  ```

  **Commit**: YES (groups with Wave 5)
  - Message: `refactor(desktop): migrate rpc.on.* event listeners → Tauri listen()`

- [x] 20. Rewrite .github/workflows/release.yml for Tauri 2

  **What to do**:
  - Replace the `build-desktop` job's Electrobun steps with Tauri 2 build steps:
    ```yaml
    - name: Install Rust toolchain
      uses: dtolnay/rust-toolchain@stable
      with:
        toolchain: stable

    - name: Install Linux system deps
      if: runner.os == 'Linux'
      run: sudo apt-get install -y libgtk-3-dev libssl-dev libwebkit2gtk-4.1-dev build-essential libayatana-appindicator3-dev librsvg2-dev

    - name: Install macOS system deps
      if: runner.os == 'macOS'
      run: brew install pkg-config

    - name: Build views (Vite)
      run: bun run build:views
      working-directory: packages/desktop

    - name: Build Tauri app
      uses: tauri-apps/tauri-action@v0
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      with:
        projectPath: packages/desktop
        tagName: ${{ github.ref_name }}
        releaseName: "TwirChat ${{ github.ref_name }}"
        releaseBody: ${{ needs.changelog.outputs.changelog }}
        releaseDraft: true
        prerelease: false
    ```
  - Add Rust lint job (runs on PR + push to main):
    ```yaml
    rust-lint:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: dtolnay/rust-toolchain@stable
          with:
            components: rustfmt, clippy
        - run: cargo fmt --manifest-path packages/desktop/src-tauri/Cargo.toml -- --check
        - run: cargo clippy --manifest-path packages/desktop/src-tauri/Cargo.toml -- -D warnings
    ```
  - Artifact paths: `packages/desktop/src-tauri/target/release/bundle/{deb,appimage,dmg,msi}/**`
  - Keep unchanged: `changelog` job, `build-backend`, `push-docker`, secrets `BACKEND_URL`, `BACKEND_WS_URL`
  - Remove: `bunx electrobun build --env=stable` step entirely

  **Must NOT do**:
  - Do NOT change `build-backend` or `push-docker` jobs
  - Do NOT change release trigger (`v*` tags + workflow_dispatch)
  - Do NOT add secrets that don't already exist

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: YAML rewrite with knowledge of both Electrobun and Tauri CI patterns
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (should be done after frontend migration is complete)
  - **Parallel Group**: Wave 6 (single task)
  - **Blocks**: F1-F4
  - **Blocked By**: T18, T19

  **References**:
  - `.github/workflows/release.yml` — current file to rewrite (preserve structure, replace desktop build only)
  - `tauri-apps/tauri-action` GitHub Action: https://github.com/tauri-apps/tauri-action
  - `dtolnay/rust-toolchain`: https://github.com/dtolnay/rust-toolchain
  - Current matrix: `[ubuntu-22.04, macos-latest, windows-latest]` — preserve as-is

  **Acceptance Criteria**:
  - [ ] `.github/workflows/release.yml` has no `electrobun` references
  - [ ] `yamllint .github/workflows/release.yml` exits 0 (or `yq .` exits 0)
  - [ ] `rust-lint` job exists in the workflow
  - [ ] `tauri-apps/tauri-action@v0` used for desktop build

  ```
  Scenario: Workflow YAML is syntactically valid
    Tool: Bash
    Steps:
      1. yq e '.' .github/workflows/release.yml > /dev/null 2>&1
      2. Assert: exit 0
    Expected Result: Valid YAML
    Evidence: .sisyphus/evidence/task-20-yaml-valid.txt

  Scenario: No electrobun references in CI
    Tool: Bash
    Steps:
      1. grep -n "electrobun" .github/workflows/release.yml | wc -l
      2. Assert: output is 0
    Expected Result: 0
    Evidence: .sisyphus/evidence/task-20-no-electrobun-ci.txt
  ```

  **Commit**: YES
  - Message: `ci: rewrite release.yml for Tauri 2 + add Rust lint job`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run cargo check/test). For each "Must NOT Have": search codebase for forbidden patterns (grep for `electrobun`, `unwrap()` in non-test code, `console.log`, hardcoded paths). Check evidence files in .sisyphus/evidence/.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `cargo fmt -- --check` + `cargo clippy -- -D warnings` + `cargo test` + `bun run typecheck` + `bun run lint`. Review all Rust files for: `unwrap()` in prod code, `as_any`, `allow(clippy::...)` suppressions, empty match arms. Check frontend for leftover electrobun imports, `console.log`, unused variables.
  Output: `cargo [PASS/FAIL] | bun typecheck [PASS/FAIL] | lint [PASS/FAIL] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start app from clean state. Execute every QA scenario from every task. Test: app window opens, Twitch channel connects and messages appear, Kick channel connects and messages appear, overlay accessible at http://localhost:45823/, overlay receives messages via WS, OAuth flow triggers and returns token, settings persist across restart.
  Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", inspect actual Rust/TS diff. Verify nothing beyond spec was built (no extra features). Confirm `packages/backend`, `packages/shared`, overlay WS protocol, SQLite schema are untouched. Check for unaccounted Rust files.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `chore(desktop): scaffold Tauri 2, add rustfmt + clippy lints` — src-tauri/Cargo.toml, rustfmt.toml
- **Wave 2**: `feat(desktop): Rust SQLite stores + DB path migration + token re-encryption` — src-tauri/src/store/
- **Wave 3**: `feat(desktop): platform adapters (Twitch/Kick), PKCE auth, overlay Axum server` — src-tauri/src/
- **Wave 4**: `feat(desktop): backend WS client, chat aggregator, all Tauri command handlers` — src-tauri/src/
- **Wave 5**: `refactor(desktop): migrate Vue frontend from electrobun IPC to Tauri invoke/listen` — src/views/
- **Wave 6**: `ci: rewrite release.yml for Tauri 2 build matrix` — .github/workflows/release.yml
- **Final**: `chore(desktop): remove Electrobun, cleanup` — package.json, electrobun.config.ts (delete)

---

## Success Criteria

### Verification Commands
```bash
# Rust build + quality
cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml        # Expected: exit 0
cargo fmt --manifest-path packages/desktop/src-tauri/Cargo.toml -- --check  # Expected: exit 0
cargo clippy --manifest-path packages/desktop/src-tauri/Cargo.toml -- -D warnings  # Expected: exit 0
cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml          # Expected: all pass

# Frontend
bun run typecheck --filter packages/desktop  # Expected: exit 0
bun run lint --filter packages/desktop       # Expected: exit 0
grep -rn "electrobun\|Electroview" packages/desktop/src/views/ | wc -l   # Expected: 0

# Runtime
curl -sf http://localhost:45823/  # Expected: HTML response
sqlite3 "~/.local/share/twirchat/data.db" ".tables" | grep accounts      # Expected: accounts listed
```

### Final Checklist
- [ ] All "Must Have" items present and verified
- [ ] All "Must NOT Have" items absent (grep verified)
- [ ] `cargo test` passes
- [ ] `bun run typecheck` passes (vue-tsc)
- [ ] Overlay accessible on port 45823
- [ ] App window opens without crash
- [ ] Twitch chat messages flow end-to-end
- [ ] Kick chat messages flow end-to-end
- [ ] OAuth flow completes for at least one platform
- [ ] GitHub Actions updated and syntactically valid (act --dry-run or yamllint)
