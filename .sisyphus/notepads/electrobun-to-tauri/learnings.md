# Electrobun → Tauri Migration Learnings

## App Metadata
- productName: "TwirChat"
- identifier: "dev.twirchat.app"
- version: "0.1.0"
- window size: 800x1200 (from tauri.conf.json spec)

## Overlay
- Port: 45823 (hardcoded, from OVERLAY_SERVER_PORT)
- Must serve dist/overlay/ from filesystem (not embedded)
- OBS requires http:// URL, not asset://

## Electrobun RPC to Tauri Commands
- ~40 BunRequests in rpc.ts need Tauri command stubs
- 13 WebviewMessages need Tauri events
- Command names: snake_case (e.g., get_accounts, connect_channel)

## Database
- SQLite schema must remain unchanged
- Old Electrobun path: ~/.local/share/TwirChat/ (Linux)
- New Tauri path: ~/.local/share/twirchat/ (Linux)
- client_secret UUID must be preserved across migration
- XOR-encrypted tokens must be migrated to AES-256-GCM on first read

## Lint/Format Standard
- rustfmt.toml: edition = "2024", style_edition = "2024"
- Workspace lints: boxxy-dev/boxxy standard (clippy pedantic + nursery)

## Tauri Scaffold Notes
- `tauri::generate_context!()` needs a valid `icons/icon.png` even for a minimal scaffold
- Clippy with `-D warnings` flags `semicolon_if_nothing_returned` on tiny entrypoints; add trailing semicolons
- `cargo check`, `cargo fmt -- --check`, and `cargo clippy -- -D warnings` all passed after the scaffold fixups

## Desktop Config Migration
- Removed Electrobun package/runtime deps from `packages/desktop/package.json`
- Added `@tauri-apps/api` and `@tauri-apps/cli` for the Tauri 2 toolchain
- Switched `start`/prod build scripts to `tauri dev` and `tauri build`
- Added `base: './'` to the main Vite config for built asset resolution
- Removed `electrobun.config.ts` and its tsconfig include entry
- `bun install` completed successfully in `packages/desktop`

## Rust Types / Error Layer
- Added `AppError` with typed variants for database, io, auth, adapter, serde, and not_found flows.
- `AppError` serializes as `{ kind, message }` so Tauri commands can return `Result<T, AppError>`.
- Mirrored the shared TS contracts in `src/types.rs`, including nested message/event/account/layout shapes.
- `PlatformFilter` needs custom serde to preserve the TS `all | Platform[]` union.
- `cargo check` and `cargo clippy -- -D warnings` passed in `packages/desktop/src-tauri`.

## 2026-04-14

- Added `src-tauri/src/commands/*` stub modules for all RPC request handlers.
- Registered every command explicitly in `src-tauri/src/lib.rs` with `tauri::generate_handler!`.
- Added missing Tauri-side Rust types for RPC payloads/responses in `src-tauri/src/types.rs`.
- Verified with `cargo check` and `cargo clippy -- -D warnings`.

## 2026-04-14 — T6: Rust SQLite Store Modules

### Store modules created
- `src/store/messages.rs` — `save_message`, `get_recent`, `clear_channel` + 6 unit tests
- `src/store/connections.rs` — `ChannelConnection` struct + `get_all`, `upsert`, `delete` + 4 tests
- `src/store/watched_channels.rs` — `get_all`, `add` (uuid v4 id), `remove` + 4 tests
- `src/store/user_aliases.rs` — `get_all` (HashMap), `set_alias` (upsert), `remove_alias` + 5 tests
- `src/store/mod.rs` — declares all four public submodules
- `pub mod store` added to `src/lib.rs`

### Implementation patterns
- `Platform` → SQL string via `serde_json::to_string(&p)?.trim_matches('"').to_owned()`
- SQL string → `Platform` via `serde_json::from_str(&format!("\"{platform_str}\""))?`
- `uuid` was already in `Cargo.toml` (added by T5); no duplicate needed
- `WatchedChannel.add()` queries `SELECT unixepoch()` after INSERT to populate `created_at`
- Message timestamp stored as Unix i64; custom no-dep RFC 3339 parser handles ISO 8601 strings

### Clippy pedantic requirements
- All public `Result`-returning fns need `/// # Errors` doc-section
- `SQLite` must be backtick-quoted in doc strings (`\`SQLite\``)
- Inlined format args required: `format!("\"{var}\"")` not `format!("\"{}\"", var)`
- Pure math helpers should be `const fn`
- `#[must_use]` required on pure value-returning public fns

### Test results
- 36 tests pass (`cargo test store::`)
- `cargo clippy -- -D warnings` exits 0

## 2026-04-14 — T7: DB Path Migration + XOR→AES-GCM Token Re-encryption

### Files created
- `src/store/migration.rs` — `migrate_db_path()`, `migrate_tokens()`, `aes_encrypt()`, `aes_decrypt()`, `is_aes_encrypted()`

### AES-GCM format (matching crypto.ts)
- Format: `base64( salt[16] || iv[12] || ciphertext )` (ciphertext includes 16-byte GCM auth tag)
- KDF: PBKDF2-SHA-256, 100_000 iterations, 32-byte output
- IKM: `"TwirChat:{hostname()}"` (same as xor_key)
- Crates: `aes-gcm = "0.10"`, `pbkdf2 = "0.12"`, `sha2 = "0.10"`, `rand = "0.8"`, `hmac = "0.12"`

### Token detection heuristic
- AES blobs are ≥60 base64 chars (salt16+iv12+ciphertext≥16 = 44 raw bytes = ceil(44*4/3)=60 b64)
- XOR blobs of short tokens (e.g., 15-char) produce ~20 b64 chars → reliably below threshold

### Clippy pedantic gotchas
- `struct Row` inside a function must be declared BEFORE any statements (items_after_statements)
- `and_then(|x| Some(y))` must be `map(|x| y)` (bind_instead_of_map)
- First doc paragraph must be short; second line for details (too_long_first_doc_paragraph)
- `tempfile = "3"` added as dev-dependency for DB path migration tests

### `xor_key_pub()` added to accounts.rs
- The private `xor_key()` now delegates to a `pub fn xor_key_pub()` so migration.rs can reuse it

### Test results
- 10 migration tests pass, 46 total store tests pass
- `cargo clippy -- -D warnings` exits 0

## 2026-04-14 — T8: AdapterTaskManager trait + lifecycle state machine

### Files created
- `src/platforms/mod.rs` — declares `adapter`, `kick`, `twitch`, `youtube` submodules
- `src/platforms/adapter.rs` — `PlatformAdapter` async trait, `AdapterState`, `AdapterEvent`, `AdapterTaskManager`
- `src/platforms/youtube/mod.rs` — re-exports `YouTubeAdapter`
- `src/platforms/youtube/adapter.rs` — stub impl returning `AppError::Adapter("not yet implemented")`
- `src/platforms/twitch/mod.rs` — placeholder
- `src/platforms/kick/mod.rs` — placeholder

### Key design decisions
- `PlatformAdapter` is `async_trait` trait (`Send + Sync`) — enables `Arc<dyn PlatformAdapter>`
- `AdapterEvent` boxes large variants: `Message(Box<NormalizedChatMessage>)`, `Event(Box<NormalizedEvent>)`
- `AdapterTaskManager` uses `Arc<Mutex<HashMap<String, ChannelHandle>>>` for per-channel state
- `connect()` spawns `tokio::task` per channel; idempotent (no-op if `Connected|Connecting`)
- `disconnect()` aborts the JoinHandle and transitions state to `Disconnected`
- `significant_drop_tightening`: explicit `drop(guard)` needed before awaiting in the spawned task

### Clippy pedantic gotchas
- `Box<LargeVariant>` required for enum variants holding structs > 3 words (large_enum_variant)
- `is_some_and(|h| matches!(...))` preferred over `if let Some(h) = ... { if matches!(...) }`
- `map_or(default, f)` preferred over `.map(...).unwrap_or(...)`
- `significant_drop_tightening` triggers if `MutexGuard` is held across `.await` points

### Test results
- 5 adapter state machine tests pass
- 46 total store + 5 platform tests pass
- `cargo clippy -- -D warnings` exits 0

## 2026-04-15 — Desktop auth backend secret header fix

- The Tauri auth flows in `src-tauri/src/auth/{kick,twitch,youtube}.rs` must send
  `X-Client-Secret` on both backend calls: `/start` and `/exchange`.
- `client_identity::get_or_create(&conn)` can be read lazily inside the auth flow
  after `backend_url` is loaded, using the existing `open_connection(&app_handle)?`.
- `cargo check` and `cargo test` both passed after adding the header; no other auth
  logic needed to change.

## 2026-04-14 — T9: Twitch IRC adapter via `twitch-irc`

- Added `twitch-irc` plus explicit `chrono` dependency in `src-tauri/Cargo.toml`.
- Replaced the Twitch adapter stub with a real `PlatformAdapter` implementation backed by `TwitchIRCClient<SecureTCPTransport, StaticLoginCredentials>`.
- `connect()` now loads stored Twitch credentials from the migrated SQLite DB, falls back to `StaticLoginCredentials::anonymous()`, joins the requested channel, and forwards IRC messages through `event_tx`.
- Mapped `PRIVMSG` to `AdapterEvent::Message(Box<NormalizedChatMessage>)`, `USERNOTICE` sub/resub/subgift/raid to `AdapterEvent::Event(Box<NormalizedEvent>)`, and `CLEARCHAT` / `CLEARMSG` to moderation-style `NormalizedEvent` payloads.
- Badge/color/display-name/emotes/reply metadata are mapped directly from `twitch-irc` parsed message structs; emote image URLs use Twitch CDN v2 format.
- `disconnect()` parts the channel and aborts the background receive task cleanly.
- Added a unit test that parses a sample raw `PRIVMSG` IRC line into the expected `NormalizedChatMessage` shape.
- Verification: `cargo check` and `cargo clippy -- -D warnings` both pass in `packages/desktop/src-tauri`.

## 2026-04-14 — Twitch adapter test timestamp fix

- The sample `PRIVMSG` test fixture uses `tmi-sent-ts=1594556065407`, which corresponds to `2020-07-12T12:14:25.407+00:00`.
- Updated `parse_sample_privmsg_into_normalized_message` to assert the correct UTC timestamp string.
- Verified with `cargo test platforms::twitch`.

## 2026-04-14 — T10: Tauri PKCE OAuth flows
- Added `src-tauri/src/auth/` with `mod.rs`, PKCE helpers, ephemeral Axum callback server, and platform-specific Twitch/YouTube/Kick OAuth modules.
- Callback server binds to `127.0.0.1:0`, exposes `/callback`, returns a oneshot `(code, state)` payload, and shuts down after the first successful callback.
- All public auth entrypoints now return `Result<(), AppError>` and persist tokens through `store::accounts::upsert` after env-driven `reqwest` token exchange + profile fetch.
- Added `tauri-plugin-opener` and initialized it in `lib.rs` so auth flows can open the system browser from Rust.
- `cargo test auth::` passes; `cargo clippy -- -D warnings` passes after fixing pre-existing Kick adapter warnings that blocked verification.
- Rust LSP diagnostics could not run in this environment because `rust-analyzer` is not installed (`Unknown binary rust-analyzer`).
- 2026-04-14: Implemented Axum-based overlay server in src-tauri with runtime dist/overlay path resolution via app_handle.path().resource_dir() fallback to CARGO_MANIFEST_DIR/../dist/overlay, HTTP routes for / and /assets/*, and WS broadcast on port 45823 using tokio::sync::broadcast. Message JSON matches existing overlay protocol: {"type":"chat_message"|"chat_event"|"clear","data":...}.

## 2026-04-14 — T11: Rust ChatAggregator port

- Added `src-tauri/src/chat/mod.rs` and `src-tauri/src/chat/aggregator.rs`; exported `pub mod chat;` from `src-tauri/src/lib.rs`.
- `ChatAggregator` uses `VecDeque<NormalizedChatMessage>` ring buffer, `HashMap<String, Instant>` dedup cache with 5-second TTL, and removes evicted IDs when the buffer overflows.
- `process_message()` saves each accepted message through `store::messages::save_message()` before emitting registered message handlers.
- Implemented callback registration for message/event/status with unsubscribe closures shaped as `FnOnce(&mut ChatAggregator)` to avoid storing shared mutable callback state.
- Added `SevenTVEvent` and a `(platform, channel_id) -> Vec<SevenTVEmote>` cache; message enrichment tokenizes text like the TS parser and merges repeated 7TV positions into a single `Emote` entry.
- Ported aggregator behavior tests into Rust module tests: collection, dedup, TTL expiry, ring buffer limit, unsubscribe, event/status emission, SQLite persistence, and 7TV enrichment.
- Verification passed with `cargo test chat::aggregator` and `cargo clippy -- -D warnings`.

## 2026-04-14 — Backend WS client
- Added `src-tauri/src/backend/mod.rs` and `src-tauri/src/backend/connection.rs` with `BackendConnectionManager` backed by `tokio-tungstenite`.
- Backend WS connect builds an HTTP request with `X-Client-Secret`, parses backend JSON via serde, emits `chat:message`, `chat:event`, `platform:status`, and `7tv:event` through `tauri::Emitter`.
- Reconnect loop uses tokio task spawn with exponential backoff from 1s up to 30s; connection state is tracked with `Arc<AtomicBool>`.
- Added a unit test covering `chat_message` JSON deserialization; `cargo check`, `cargo clippy -- -D warnings`, and the targeted test pass.

## 2026-04-15 — Desktop capability + public asset config
- Tauri needs `src-tauri/capabilities/default.json` to grant `core:default` and `opener:default` to the main window.
- Vite `publicDir` must point at `packages/desktop/public` so `/fonts/*.css` resolves from the package root during dev.

## 2026-04-15 — OAuth parity fix for Tauri desktop
- `src-tauri/src/main.rs` must load `packages/desktop/.env` via `dotenvy::from_filename("../.env")` before `app_lib::run()` so Rust sees desktop-side auth/overlay ports during startup.
- PKCE parity with the original Electrobun app is: verifier = 64 random bytes encoded as base64url without padding (~86 chars), state = 16 random bytes encoded as lowercase hex (32 chars).
- The Rust callback server now binds `AUTH_SERVER_PORT` from env (default `45821`) and each provider uses a fixed provider-specific callback path instead of an ephemeral port + generic `/callback`.

## 2026-04-15 — Backend WS send/ping/subscription parity
- Added a Rust `DesktopToBackendMessage` + `SeventvSubscription` model in `src-tauri/src/types.rs` so the desktop can actively drive backend WS actions instead of being read-only.
- `BackendConnectionManager` now owns an unbounded mpsc sender plus a subscription cache, sends JSON messages through `send()`, emits `ping` every 30 seconds while connected, and resends `seventv_resubscribe` immediately after reconnect.
- `join_channel` / `leave_channel` now mirror the Electrobun behavior by updating the manager subscription cache and sending `seventv_subscribe` / `seventv_unsubscribe`; Kick uses broadcaster user id when known, falling back to the channel slug.
- `auth/server.rs` test stability improved by binding the callback server to port `0` by default and reading the actual assigned port from `listener.local_addr()`.
- Rust desktop auth now matches Electrobun architecture again: desktop generates PKCE locally, asks backend for auth URL + token exchange, keeps direct platform user-info fetches, and never reads OAuth client IDs/secrets from desktop env.
- Overlay server port must be read at runtime from `OVERLAY_SERVER_PORT` with fallback `45823`.
