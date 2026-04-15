# Migration Decisions

## Framework Choice
- Tauri 2.x with Rust backend
- tauri-build = "2"
- tokio = { features = ["full"] }

## Crypto Migration
- XOR decode in Rust replicates crypto.ts algorithm exactly
- AES-256-GCM via aes-gcm crate
- Key derived via SHA-256(client_secret)
- 12-byte nonce prepended to ciphertext

## Adapter Pattern
- PlatformAdapter trait with async_trait
- AdapterTaskManager<A: PlatformAdapter> with tokio tasks and HashMap of handles

## 2026-04-14 — OAuth implementation choices
- Used `tauri-plugin-opener` for browser launch because Tauri 2 no longer exposes `tauri::api::shell::open` in the same form as Tauri 1.
- Reused per-platform direct OAuth/token/userinfo calls in Rust instead of bouncing through backend endpoints; client IDs/secrets come from environment variables only.
- Kept callback route as `/callback` on an ephemeral localhost port and passed the full redirect URI into each provider auth URL/token exchange request.

## 2026-04-14 — Backend WebSocket client
- Kept a Rust-local `BackendToDesktopMessage` serde model in `backend/connection.rs` to mirror the shared TS protocol without modifying `packages/shared`.
- Emitted all 7TV backend variants through a single Tauri event name, `7tv:event`, while preserving dedicated events for chat messages, chat events, and platform status.

## 2026-04-15 — Desktop config fix
- Use a dedicated Tauri capability manifest at `src-tauri/capabilities/default.json` for the main window instead of relying on implicit permissions.
- Point both Vite configs at `public/` explicitly so packaged font assets stay resolvable in dev and build.

## 2026-04-15 — OAuth architecture parity decision
- Reverted the Rust desktop auth flows to the original Electrobun split: desktop owns PKCE/session/state validation and account persistence, backend owns provider client credentials plus `/api/auth/{platform}/start` and `/api/auth/{platform}/exchange`.
- Standardized callback endpoints to provider-specific paths (`/auth/twitch/callback`, `/auth/youtube/callback`, `/auth/kick/callback`) on a fixed localhost auth server port loaded from desktop `.env`.

## 2026-04-15 — Backend websocket reconnection design
- Kept the backend websocket writer inside `BackendConnectionManager` via `tokio::sync::mpsc::unbounded_channel` so commands can enqueue outbound backend messages without touching the live socket directly.
- Stored 7TV subscriptions as `Arc<Mutex<Vec<SeventvSubscription>>>` on the manager and replay them with a single `seventv_resubscribe` message after reconnect, matching the original Electrobun lifecycle.
- Limited 7TV backend subscribe/unsubscribe traffic to Twitch and Kick channel joins/leaves; YouTube remains excluded because the desktop adapter does not support that flow.
