# Wails v3 Desktop Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the pre-GPUI Vue desktop application and replace Electrobun/Bun desktop services with a Wails v3 Go runtime.

**Architecture:** Restore the Vue sources from `bdd7e156`, then isolate all Wails calls behind a Vue facade that preserves the old RPC semantics. A Go application composes local storage, OAuth, platform adapters, backend transport, chat aggregation, watched channels, and the OBS overlay; it emits Wails events using the historical event names.

**Tech Stack:** Go 1.26, Wails v3 `alpha2.117`, Vue 3, Vite, Pinia, Bun, SQLite, Go gRPC, Go WebSocket, `bun test`, and `go test`.

---

## File Map

- `packages/desktop/` — restored desktop package root and Wails v3 module.
- `packages/desktop/main.go` — Wails application/window composition entry point.
- `packages/desktop/go.mod` — Go module with a Wails v3 version compatible with CLI `v3.0.0-alpha2.117`.
- `packages/desktop/build/config.yml` — Wails development watcher and process configuration.
- `packages/desktop/Taskfile.yml` — development task entry points, including Vite and Go build/run tasks.
- `packages/desktop/internal/app/` — lifecycle, configuration, composition, startup, and shutdown.
- `packages/desktop/internal/contracts/` — frontend-compatible JSON DTOs and request/response structures.
- `packages/desktop/internal/bridge/` — Wails services, event emission, and capability reporting.
- `packages/desktop/internal/storage/` — SQLite schema/repositories, client identity, and AES-GCM credentials.
- `packages/desktop/internal/backend/` — authenticated HTTP and reconnecting WebSocket client.
- `packages/desktop/internal/auth/` — PKCE, OAuth, loopback callback, and browser launch.
- `packages/desktop/internal/platforms/` — Twitch, Kick, and YouTube adapters and shared adapter contract.
- `packages/desktop/internal/chat/` — aggregation, deduplication, normalization, persistence, and routing.
- `packages/desktop/internal/seventv/` — emote cache and backend subscription state.
- `packages/desktop/internal/watched/` — watched-channel lifecycle, buffers, and layouts.
- `packages/desktop/internal/overlay/` — OBS HTTP/WebSocket server and overlay payloads.
- `packages/desktop/src/views/main/services/desktop-api.ts` — Vue facade around Wails-generated bindings.
- `packages/desktop/src/views/main/services/desktop-events.ts` — Vue facade around Wails runtime events.
- `packages/desktop/src/views/main/main.ts` — Vue/Pinia bootstrap after Wails runtime readiness.
- `packages/desktop/src/views/main/composables/useRpcListener.ts` — compatibility composable backed by `desktopEvents`.
- `packages/desktop/src/views/main/stores/settings.ts` — capability-aware update UI behavior.
- `packages/desktop/vite.main.config.ts` — Wails-compatible Vite main target and `WAILS_VITE_PORT` support.
- `packages/desktop/vite.overlay.config.ts` — overlay build into the assets served by Go.

Do not create commits unless the user explicitly requests them.

---

### Task 1: Restore the Vue/Electrobun baseline as the migration source

**Files:**

- Create: `packages/desktop/**` from `bdd7e156eba73855e3c396216a4ddd610dd73223`.
- Test: restored `packages/desktop/tests/**`.

- [ ] Restore only the historical desktop directory with `git restore --source=bdd7e156 -- packages/desktop`.
- [ ] Verify the restored source contains `src/views/main`, `src/views/overlay`, assets, Pinia stores, composables, tests, Vite configs, and the historical RPC schema.
- [ ] Run `bun run --cwd packages/desktop test` and record any failures caused solely by the soon-to-be-removed Electrobun runtime.
- [ ] Run `bun run --cwd packages/desktop typecheck` to establish the Vue baseline before bridge replacement.

### Task 2: Create a minimal Wails v3 development host

**Files:**

- Create: `packages/desktop/go.mod`.
- Create: `packages/desktop/main.go`.
- Create: `packages/desktop/build/config.yml`.
- Create: `packages/desktop/Taskfile.yml`.
- Create: `packages/desktop/internal/app/application.go`.
- Create: `packages/desktop/internal/app/application_test.go`.
- Modify: `packages/desktop/package.json`.
- Modify: `packages/desktop/vite.main.config.ts`.

- [ ] Write `application_test.go` first; construct the application with a temporary profile directory and assert it exposes the configured application name, a cancellable root context, and no started services before `Start`.
- [ ] Add a Wails application using the version compatible with installed CLI `v3.0.0-alpha2.117`; configure the initial window title as `TwirChat`, width `1200`, and height `800`.
- [ ] Configure Wails dev mode to launch the package's Vite main target on `${WAILS_VITE_PORT:-9245}` with `strictPort: true` and hot reload.
- [ ] Make the main Vite production output the Wails asset directory and preserve `dist/overlay` for the separate overlay build.
- [ ] Add `dev:wails`, `build:main`, `build:overlay`, `build:views`, `typecheck`, and `test` scripts without Electrobun commands.
- [ ] Run `go test ./...` from `packages/desktop` and `wails3 dev -config build/config.yml`; the restored Vue shell must load in the native Wails window.

### Task 3: Define frontend contracts, bridge events, and the Vue API boundary

**Files:**

- Create: `packages/desktop/internal/contracts/models.go`.
- Create: `packages/desktop/internal/contracts/requests.go`.
- Create: `packages/desktop/internal/contracts/models_test.go`.
- Create: `packages/desktop/internal/bridge/desktop_service.go`.
- Create: `packages/desktop/internal/bridge/events.go`.
- Create: `packages/desktop/internal/bridge/events_test.go`.
- Create: `packages/desktop/src/views/main/services/desktop-api.ts`.
- Create: `packages/desktop/src/views/main/services/desktop-events.ts`.
- Modify: `packages/desktop/src/views/main/main.ts`.
- Modify: `packages/desktop/src/views/main/composables/useRpcListener.ts`.
- Modify: `packages/desktop/src/shared/rpc.ts` until every consumer has moved, then delete it.

- [ ] Write contract tests that marshal account, normalized chat message, normalized event, status, layout, and 7TV payloads to the exact camelCase keys consumed by `@twirchat/shared`.
- [ ] Define DTOs for every historical RPC group: accounts/settings/aliases, channels/auth/chat, status/stream/category/user-card, history/colors/emotes, watched channels/layouts, external URLs, and application capabilities.
- [ ] Implement a bridge service with Wails-exported methods named after the historical requests and an event emitter retaining `chat_message`, `chat_event`, `platform_status`, OAuth, 7TV, and watched-channel event names.
- [ ] Generate bindings with `wails3 generate bindings`; never hand-edit generated files.
- [ ] Implement `desktopApi` as the sole generated-binding caller. It must convert ISO timestamps to `Date`, preserve old argument shapes, and surface binding errors as rejected promises.
- [ ] Implement `desktopEvents` with `Events.On`, returning cleanup functions. Update `useRpcListener` to register and unregister through that facade.
- [ ] Run `bun run --cwd packages/desktop typecheck` and targeted Vue tests with mocked `desktopApi`/`desktopEvents`.

### Task 4: Port local profile storage and credential protection

**Files:**

- Create: `packages/desktop/internal/storage/database.go`.
- Create: `packages/desktop/internal/storage/schema.go`.
- Create: `packages/desktop/internal/storage/crypto.go`.
- Create: `packages/desktop/internal/storage/accounts.go`.
- Create: `packages/desktop/internal/storage/settings.go`.
- Create: `packages/desktop/internal/storage/messages.go`.
- Create: `packages/desktop/internal/storage/channels.go`.
- Create: `packages/desktop/internal/storage/watched.go`.
- Create: `packages/desktop/internal/storage/storage_test.go`.

- [ ] Write tests using a temporary SQLite database for schema creation, account token round trips, settings, channel connections, message cursor paging, aliases, watched channels, and persisted layouts.
- [ ] Create a fresh schema equivalent to the restored desktop behavior: client identity, accounts, settings, chat messages, channel connections, watched channels, aliases, and watched-channel layouts.
- [ ] Enable WAL and foreign keys. Resolve the database under Wails' per-user application-data path instead of the Rust or legacy Electrobun path.
- [ ] Replace the legacy XOR token encoding with AES-256-GCM encryption. Derive a machine-bound key with PBKDF2 and use a random salt and nonce for every encrypted value.
- [ ] Implement repositories with context-aware queries and explicit JSON encoding for structured settings, messages, and layout values.
- [ ] Run `go test ./internal/storage/...` and confirm a new profile has no dependency on legacy database paths.

### Task 5: Port remote backend transport and browser/OAuth flows

**Files:**

- Create: `packages/desktop/internal/backend/http_client.go`.
- Create: `packages/desktop/internal/backend/ws_client.go`.
- Create: `packages/desktop/internal/backend/ws_client_test.go`.
- Create: `packages/desktop/internal/auth/pkce.go`.
- Create: `packages/desktop/internal/auth/callback.go`.
- Create: `packages/desktop/internal/auth/service.go`.
- Create: `packages/desktop/internal/auth/service_test.go`.
- Modify: `packages/desktop/internal/app/application.go`.

- [ ] Write mock HTTP/WebSocket tests asserting every backend request carries `X-Client-Secret`, encoded protocol messages decode correctly, reconnect delay is bounded, and cancellation prevents reconnect.
- [ ] Port the persistent backend WebSocket protocol for auth and 7TV messages, including ping, exponential reconnect, and subscription replay after reconnect.
- [ ] Port HTTP calls for stream status, stream updates, category search, channel status, and user-card metadata. Attach stored access tokens only where the old protocol requires them.
- [ ] Write PKCE/callback tests for state mismatch rejection, successful callback delivery, timeout shutdown, and account persistence.
- [ ] Implement platform browser opening through Wails and emit `auth_url`, `auth_success`, and `auth_error` with historical payloads.
- [ ] Run `go test ./internal/backend/... ./internal/auth/...`.

### Task 6: Port shared chat behavior and the Twitch adapter

**Files:**

- Create: `packages/desktop/internal/platforms/adapter.go`.
- Create: `packages/desktop/internal/platforms/twitch/adapter.go`.
- Create: `packages/desktop/internal/platforms/twitch/adapter_test.go`.
- Create: `packages/desktop/internal/chat/aggregator.go`.
- Create: `packages/desktop/internal/chat/aggregator_test.go`.
- Modify: `packages/desktop/internal/app/application.go`.

- [ ] Write adapter tests with recorded Twitch payloads that assert normalized authors, badges, emotes, replies, actions, chat events, statuses, and send-message routing.
- [ ] Define a context-aware Go adapter interface for connect, disconnect, send, message, event, and status callbacks.
- [ ] Port aggregation/deduplication and ensure each normalized message is persisted, sent to the bridge, and available to overlay broadcasting exactly once.
- [ ] Implement Twitch OAuth token refresh, chat connection, status propagation, message sending, and emote extraction without a Node/Twurple dependency.
- [ ] Run `go test ./internal/chat/... ./internal/platforms/twitch/...`.

### Task 7: Port Kick and YouTube adapters

**Files:**

- Create: `packages/desktop/internal/platforms/kick/adapter.go`.
- Create: `packages/desktop/internal/platforms/kick/adapter_test.go`.
- Create: `packages/desktop/internal/platforms/youtube/adapter.go`.
- Create: `packages/desktop/internal/platforms/youtube/adapter_test.go`.
- Create: `packages/desktop/internal/platforms/youtube/stream_list.proto` from the restored source.
- Create: `packages/desktop/internal/platforms/youtube/gen/**` through Go protobuf generation.
- Modify: `packages/desktop/internal/app/application.go`.

- [ ] Write fixture-driven Kick tests for chat, events, badge/avatar handling, channel resolution, statuses, and outgoing messages.
- [ ] Implement Kick's WebSocket/Pusher protocol directly in Go and route all output through the shared adapter contract.
- [ ] Write YouTube fixture tests for streaming live-chat messages, super chats, memberships, gifts, and stream termination.
- [ ] Generate Go protobuf/gRPC code from `stream_list.proto`; never edit generated code.
- [ ] Implement the YouTube adapter with a cancellable streaming gRPC client. Do not add polling.
- [ ] Run `go test ./internal/platforms/kick/... ./internal/platforms/youtube/...`.

### Task 8: Port 7TV and watched-channel behavior

**Files:**

- Create: `packages/desktop/internal/seventv/service.go`.
- Create: `packages/desktop/internal/seventv/service_test.go`.
- Create: `packages/desktop/internal/watched/manager.go`.
- Create: `packages/desktop/internal/watched/manager_test.go`.
- Modify: `packages/desktop/internal/bridge/desktop_service.go`.
- Modify: `packages/desktop/internal/bridge/events.go`.

- [ ] Write 7TV tests for full set, add, remove, rename, system-message, unsubscribe, and reconnect-resubscribe paths.
- [ ] Maintain an emote cache keyed by platform and channel. Translate backend 7TV messages to the restored Vue event names and inject system messages into the normal chat route.
- [ ] Write watched-channel tests for add/remove, auto-connect, buffered history, send, connection status, panel assignment, split, and removal.
- [ ] Port watched channels to independent adapter instances so their messages do not alter the main chat channel state.
- [ ] Persist and validate layout trees before emitting updated views to Vue.
- [ ] Run `go test ./internal/seventv/... ./internal/watched/...`.

### Task 9: Port the OBS overlay server

**Files:**

- Create: `packages/desktop/internal/overlay/server.go`.
- Create: `packages/desktop/internal/overlay/server_test.go`.
- Modify: `packages/desktop/vite.overlay.config.ts`.
- Modify: `packages/desktop/internal/app/application.go`.

- [ ] Write HTTP/WebSocket tests for `/`, `/index.html`, `/assets/*`, `/fonts/*`, unknown assets, connected-client cleanup, and chat/event broadcasts.
- [ ] Build the restored overlay into `dist/overlay`; in development serve its filesystem assets and in production serve embedded assets.
- [ ] Bind the server to the shared overlay port `45823`, retain the historical SPA fallback, and keep all query parameters in the Vue overlay untouched.
- [ ] Emit the existing `chat_message`, `chat_event`, and `clear` overlay protocol with parsed message parts and ISO timestamps.
- [ ] Run `go test ./internal/overlay/...` and connect a browser WebSocket client to verify a broadcast.

### Task 10: Finish Vue migration and remove Electrobun/Bun runtime code

**Files:**

- Modify: all restored callers of `rpc` under `packages/desktop/src/views/main/**`.
- Modify: `packages/desktop/src/views/main/stores/settings.ts`.
- Delete: `packages/desktop/electrobun.config.ts`.
- Delete: `packages/desktop/index.ts`.
- Delete: `packages/desktop/src/bun/**`.
- Delete: former Bun runtime modules under `packages/desktop/src/auth`, `backend-connection.ts`, `chat`, `overlay-server.ts`, `platforms`, `seventv`, `store`, and `watched-channels` after their Go replacements are covered.
- Modify: `packages/desktop/package.json` and root dependency metadata to remove Electrobun/Bun-only desktop dependencies.

- [ ] Update each component/store/composable to import only `desktopApi` or `desktopEvents`; no Vue file may import a Go-generated binding directly.
- [ ] Add a capability response `{ updates: false }` and hide/disable automatic update checks and updater controls without displaying an unsupported-operation error.
- [ ] Replace the Electrobun socket wait with Wails runtime readiness before mounting Vue and Pinia.
- [ ] Delete historical runtime files only after every bridge method has a Go implementation and frontend coverage.
- [ ] Run `bun run --cwd packages/desktop typecheck` and `bun run --cwd packages/desktop test`.

### Task 11: Add end-to-end lifecycle tests and run Linux acceptance checks

**Files:**

- Create: `packages/desktop/internal/app/integration_test.go`.
- Create: `packages/desktop/tests/desktop-api.test.ts`.
- Create: `packages/desktop/tests/desktop-events.test.ts`.
- Modify: `packages/desktop/README.md`.
- Modify: root `README.md` only if it contains desktop startup commands.

- [ ] Write an integration test with mock backend/platform/overlay dependencies that asserts startup loads a clean profile, an inbound message reaches the bridge and overlay, and shutdown releases all listeners.
- [ ] Write Vue facade tests covering camelCase arguments, timestamp conversion, rejection propagation, event unsubscribe, and the disabled updater capability.
- [ ] Document Linux prerequisites, environment variables, `wails3 dev`, frontend binding generation, test commands, and the OBS URL. Do not document packaging or updater workflows.
- [ ] Run `gofmt -w` on all Go files, `go test ./...`, and `go vet ./...` from `packages/desktop`.
- [ ] Run `bun run fix`, `bun run lint`, `bun run typecheck`, and `bun run --cwd packages/desktop test` from the repository root.
- [ ] Manually validate on Linux: native Wails UI loads, Vite HMR works, OAuth callback succeeds, Twitch/Kick/YouTube each connect, messages send/receive, 7TV updates, watched channels, persisted settings, and OBS overlay broadcast all work.

---

## Completion Criteria

- The delivered desktop runtime contains Wails/Go and no Electrobun/Bun sidecar.
- The Vue interface and OBS overlay match the `bdd7e156` feature set except for updater functionality.
- All former Vue RPC requests resolve through generated Wails bindings and all push behavior arrives through Wails runtime events.
- New local profiles work without data migration.
- Linux verification and all automated Go/Vue checks pass.
