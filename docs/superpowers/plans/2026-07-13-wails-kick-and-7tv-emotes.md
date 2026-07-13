# Wails Kick and 7TV Emotes Implementation Plan

> **For agentic workers:** Use TDD task-by-task. This plan deliberately does not
> create commits: the user explicitly requested uncommitted changes only.

**Goal:** Restore native Kick emote parsing and 7TV emote support for every active
Wails desktop channel, including watched channels and live backend updates.

**Architecture:** Kick parses provider markers before storing and emitting messages.
The new Go 7TV service owns the authenticated backend WebSocket, exact-case
per-channel emote catalogs, channel-ID aliases, subscriptions, and Wails event
projection. Twitch and Kick subscribe/unsubscribe through a small interface; both
enrich incoming messages before persistence and Wails publication.

**Tech Stack:** Go 1.26, coder/websocket, existing Bun backend 7TV manager, Wails
v3 events, Vue 3 event bridge.

## Global Constraints

- Do not alter existing uncommitted work outside this feature.
- Do not create commits.
- Keep each 7TV alias exact-case; `чё` must not resolve `Чё`.
- Separate catalogs by platform and resolved channel identity.
- Use the existing backend WebSocket instead of direct desktop polling.
- Keep system notifications and emote-set mutations live through Wails events.
- Use `gofmt`, `go test ./...`, `bun run fix`, `bun run lint`, and `bun run typecheck` before handoff.

---

### Task 1: Native Kick marker parser

**Files:**

- Modify: `packages/desktop/internal/platforms/kick/service.go`
- Modify: `packages/desktop/internal/platforms/kick/service_test.go`

**Interfaces:**

- Produces `parseEmotes(content string) (string, []contracts.Emote)`.
- `handlePusherMessage` stores and emits the parsed message.

- [ ] Write tests for two valid markers, malformed markers, and non-ASCII text.
- [ ] Run `go test ./internal/platforms/kick -run Test.*Kick.*Emote` and verify it fails because markers remain raw.
- [ ] Implement a single-pass parser that only replaces complete non-empty `[emote:id:name]` markers, preserves all other bytes, and uses UTF-16 code-unit indices compatible with JavaScript `String.slice`.
- [ ] Run the focused package test and then `go test ./internal/platforms/kick`.

### Task 2: 7TV catalog, subscriptions, and backend event translation

**Files:**

- Create: `packages/desktop/internal/seventv/service.go`
- Create: `packages/desktop/internal/seventv/service_test.go`
- Modify: `packages/desktop/internal/backend/http_client.go`
- Modify: `packages/desktop/internal/contracts/models.go`
- Modify: `packages/desktop/internal/bridge/events.go`
- Modify: `packages/desktop/internal/bridge/storage_handlers.go`
- Modify: `packages/desktop/main.go`

**Interfaces:**

- `seventv.Service` implements `app.Service` and exposes `Subscribe`, `Unsubscribe`, `Enrich`, and `Emotes`.
- A subscription maps displayed platform channel IDs to the canonical backend 7TV channel ID.
- Backend envelopes `seventv_emote_set`, `seventv_emote_added`, `seventv_emote_removed`, `seventv_emote_updated`, and `seventv_system_message` update only their matching catalog.

- [ ] Write tests for exact alias matching, channel isolation, canonical/display ID lookup, reconnect resubscription, and mutation events.
- [ ] Run `go test ./internal/seventv` and verify failures before the service exists.
- [ ] Implement the catalog and bounded typed backend-envelope decoder; start/stop its existing reconnecting WebSocket client with the backend-derived `ws`/`wss` URL.
- [ ] Register the real `getChannelEmotes` handler and emit existing `channel_emotes_*` events plus a typed 7TV system-message event.
- [ ] Run `go test ./internal/seventv ./internal/backend ./internal/bridge`.

### Task 3: Subscribe and enrich every native channel

**Files:**

- Modify: `packages/desktop/internal/platforms/kick/service.go`
- Modify: `packages/desktop/internal/platforms/kick/service_test.go`
- Modify: `packages/desktop/internal/platforms/twitch/service.go`
- Modify: `packages/desktop/internal/platforms/twitch/service_test.go`
- Modify: `packages/desktop/main.go`

**Interfaces:**

- Platform services receive a narrow `Subscribe`, `Unsubscribe`, and `Enrich` dependency.
- Kick subscribes using its resolved broadcaster ID and keeps the slug as the display lookup ID.
- Twitch subscribes by channel login; both direct and watched channel paths use the same services.

- [ ] Write tests that assert subscriptions on join/restore and enriched messages before persistence.
- [ ] Run focused Twitch/Kick tests and verify the assertions fail before wiring.
- [ ] Wire the dependency through both platform services and application composition; unsubscribe only when the underlying service leaves the channel.
- [ ] Run all affected Go package tests.

### Task 4: Vue system-event display and end-to-end verification

**Files:**

- Modify: `packages/desktop/src/views/main/services/desktop-events.ts`
- Modify: `packages/desktop/src/views/main/App.vue`
- Modify/create frontend tests only when an existing matching test seam is present.

**Interfaces:**

- `seventv_system_message` becomes a normal system chat row for its mapped channel.

- [ ] Add a failing test or focused type-level assertion for deserializing and routing the system event.
- [ ] Implement the listener without polling or browser-to-Bun imports.
- [ ] Run `bun run fix`, `bun run lint`, `bun run typecheck`, `go test ./...`, and the relevant `bun test` suites.
