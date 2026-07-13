# Wails v3 Desktop Migration

## Goal

Replace the current Rust/GPUI desktop application with a Wails v3 desktop application that restores the Vue interface and behavior from the last pre-GPUI revision, while porting all local desktop runtime responsibilities from Bun/TypeScript to Go.

## Source Baseline

- The GPUI refactor is commit `16d2cd8a8d33cb9a1e5612fe85421a9a0b422e37` (`v0.7.0`), `refactor: use gpui for desktop application (#64)`.
- The final pre-GPUI Vue/Electrobun source is its parent, `bdd7e156eba73855e3c396216a4ddd610dd73223`.
- Restore the UI, overlay, Vue stores, assets, and frontend tests from that revision. Do not retain Electrobun or the Bun main process in the delivered desktop application.

## Requirements

1. `packages/desktop` becomes a Wails v3 application backed by Go.
2. Restore the Vue main-window and OBS overlay behavior from `bdd7e156`.
3. Port all former Bun main-process responsibilities to Go: SQLite storage, credential encryption, client identity, OAuth, platform adapters, YouTube gRPC, chat aggregation, 7TV state, remote backend transport, watched channels, and the OBS overlay server.
4. Vue must use generated Wails bindings and runtime events rather than Electrobun RPC or direct backend access.
5. Preserve the historical Vue-facing request and event semantics where possible so component changes are limited to the desktop API boundary.
6. Use a fresh Wails application-data SQLite profile. Do not migrate Rust/GPUI or Electrobun user data.
7. Support portable Linux/macOS/Windows source code. Validate runtime behavior on Linux in this phase.

## Non-requirements

- Installer packaging, code signing, release channels, CI release builds, and auto-update delivery.
- Migration of accounts, tokens, settings, channels, messages, aliases, or layouts from previous runtimes.
- Retaining Bun, Electrobun, or a Bun sidecar as a production runtime dependency.
- Adding HTTP polling for YouTube. The Go adapter must retain a streaming gRPC implementation.

## Architecture

Wails owns the native application lifecycle and loads the restored Vue main build. A Go composition root creates storage, transport, OAuth, adapters, aggregation, watched-channel, and overlay services; it closes all listeners and goroutines when Wails exits.

`internal/bridge` exports focused Wails services with JSON DTOs compatible with the historical `@twirchat/shared` shapes. It emits the old webview event names through Wails runtime events. Vue uses a single `desktopApi` facade around generated bindings and a paired event facade; no component imports generated bindings directly.

The overlay remains a separate Vue Vite target. A Go HTTP/WebSocket server serves its assets and broadcasts the existing overlay message protocol at `http://localhost:45823`.

## Components

### Go Runtime

- `internal/app`: Wails app/window options, dependency construction, startup, cancellation, and shutdown.
- `internal/bridge`: Wails-exposed methods, capability response, event emitter, and conversion from domain models to frontend DTOs.
- `internal/contracts`: platform, account, message, event, status, layout, request, and response DTOs with stable JSON tags.
- `internal/storage`: SQLite schema, repositories, client secret, and AES-256-GCM credential encryption.
- `internal/backend`: authenticated REST client and reconnecting backend WebSocket client.
- `internal/auth`: PKCE, OAuth URLs, local callback server, browser opening, credentials, and adapter reconnects.
- `internal/platforms`: Twitch, Kick, and YouTube adapters. YouTube uses generated Go protobuf/gRPC code from the restored `stream_list.proto`.
- `internal/chat`: normalized message/event routing, deduplication, persistence, and status propagation.
- `internal/seventv`: backend subscription commands, emote cache, and update handling.
- `internal/watched`: watched-channel lifecycle, buffers, send operations, statuses, and persisted layouts.
- `internal/overlay`: static overlay assets, receive-only OBS WebSocket clients, and broadcast payload construction.

### Vue Runtime

- Restore `src/views/main` and `src/views/overlay` from `bdd7e156`.
- Replace `Electroview.defineRPC` and direct `rpc` use with `desktopApi` and `desktopEvents`.
- Keep the existing Pinia stores, composables, component hierarchy, layout behavior, and overlay query parameters.
- Disable the update-check UI through a Go-provided capability value. Do not expose a fake updater.

## Data Flow

1. Wails starts the Go application, opens a fresh SQLite profile, restores the current profile's saved state, starts the overlay server, and begins backend/platform connections.
2. Vue starts after the Wails runtime is ready and loads initial state through `desktopApi`.
3. A Vue request reaches a generated Wails binding, then the bridge and its targeted Go service. The result returns as a promise.
4. Platform chat/events, 7TV updates, OAuth outcomes, backend messages, and watched-channel state are converted to DTOs, emitted with Wails events, and consumed through `desktopEvents`.
5. Normalized chat/events are persisted, emitted to Vue, and broadcast to connected OBS overlay clients.

## Errors And Shutdown

- Binding methods return Go errors so Vue promises reject with actionable context.
- Background transport and adapter failures emit the existing platform or watched-channel `error` status and write structured Go logs.
- OAuth failures emit the historical `auth_error` event.
- The application root owns a cancellation context. Shutdown stops callback/overlay servers, closes backend/platform sockets, cancels streaming RPCs, and waits for goroutines before the process exits.

## Verification

- Preserve and adapt the Vue unit tests to mock only the `desktopApi` and event facade.
- Add Go unit tests for storage, crypto, contracts, OAuth/PKCE, backend WebSocket retry/protocol parsing, adapter normalization, aggregation, watched channels, and overlay serving/broadcasting.
- Add local HTTP/WebSocket integration tests covering startup, a message travelling to both Vue event subscribers and OBS, and clean service shutdown.
- On Linux, verify `wails3 dev`, Vite HMR, OAuth callback, Twitch/Kick/YouTube connections, message send/receive, 7TV, watched channels, and overlay delivery.
- Run `gofmt`, `go test ./...`, `go vet ./...`, `bun run fix`, `bun run lint`, `bun run typecheck`, and the restored frontend test suite.

## Risks

Wails is currently used through `v3.0.0-alpha2.117`. Pin the Go module and CLI-compatible generated bindings to that release, regenerate bindings through `wails3 generate bindings`, and verify the Wails API against the current v3 documentation before adopting framework-specific calls.
