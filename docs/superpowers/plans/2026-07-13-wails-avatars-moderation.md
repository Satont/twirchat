# Wails avatars and message moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore non-blocking Twitch/Kick author avatars and a safe drag-to-moderate rail in the Wails desktop chat.

**Architecture:** The renderer renders initials synchronously and asks a shared Vue composable for avatars without awaiting. The composable deduplicates renderer requests while a Go resolver deduplicates, negatively caches, and bounds provider lookups for the lifetime of the desktop process. Moderation goes renderer → typed Wails gateway → authenticated backend routes so provider credentials remain outside the renderer and Twitch client credentials remain on the backend.

**Tech Stack:** Vue 3 + TypeScript + Virtua, Go/Wails v3, Bun backend, Twitch Helix, Kick Public API v1.

## Global Constraints

- Change Wails/Vue desktop code; do not modify `packages/desktop-rust`.
- Do not block a chat row render on avatar I/O; show initials until a loaded image replaces them.
- Preserve `AppSettings.showAvatars` as the one visibility toggle for both layouts.
- Support Twitch and Kick; do not show a moderation rail for YouTube or system/delivery messages.
- Treat delete, timeout, and permanent ban as distinct provider operations; never map delete to ban.
- Authenticate backend moderation requests with `X-Client-Secret`; never return OAuth tokens to Vue.
- Existing connected accounts must reauthenticate once to receive the new moderation scopes.
- Use `apply_patch` for edits, `gofmt` for Go formatting, `bun run fix` after TypeScript changes, and do not create a commit.

---

## File structure

- `packages/backend/src/api/moderation/kick.ts` — current Kick endpoint and payload implementation.
- `packages/backend/src/api/moderation/service.ts` — validates the request, resolves broadcaster IDs, and dispatches provider actions/capabilities.
- `packages/backend/src/routes/moderation.ts` — authenticated backend HTTP surface for desktop bridge requests.
- `packages/backend/src/auth/{twitch,kick}.ts` — requests the moderation scopes during OAuth.
- `packages/desktop/internal/avatar/resolver.go` — bounded process-local avatar cache and backend lookup client.
- `packages/desktop/internal/bridge/{avatar,moderation}_handlers.go` — typed Wails gateway handlers; moderation handler injects locally stored token.
- `packages/desktop/internal/contracts/{models,requests}.go` — gateway request and response DTOs.
- `packages/desktop/src/views/main/composables/useAvatarCache.ts` — reactive UI cache and background resolver request launcher.
- `packages/desktop/src/views/main/utils/moderation-drag.ts` — pure pointer-distance to action mapping.
- `packages/desktop/src/views/main/components/MessageModerationRail.vue` — presentational pointer slider emitting a selected action.
- `packages/desktop/src/views/main/components/{ChatMessage,ChatList}.vue` — fallback/image rendering, rail visibility, backend action dispatch, and toast.
- `packages/desktop/src/views/main/services/desktop-api.ts` — strongly typed gateway façade requests.

### Task 1: Request the provider moderation permissions

**Files:**

- Modify: `packages/backend/src/auth/twitch.ts`
- Modify: `packages/backend/src/auth/kick.ts`
- Create: `packages/backend/tests/auth-moderation-scopes.test.ts`

**Interfaces:**

- Produces OAuth URLs containing Twitch `moderator:read:moderators`, `moderator:manage:chat_messages`, and `moderator:manage:banned_users` scopes.
- Produces OAuth URLs containing Kick `moderation:chat_message:manage` and `moderation:ban` scopes.

- [ ] **Step 1: Write the failing scope regression test**

```ts
import { expect, test } from 'bun:test'
import { buildTwitchAuthUrl } from '../src/auth/twitch.ts'
import { buildKickAuthUrl } from '../src/auth/kick.ts'

test('OAuth URLs request every moderation scope required by the rail', () => {
  const twitch = new URL(buildTwitchAuthUrl('challenge', 'state', 'http://localhost/callback').url)
  const kick = new URL(buildKickAuthUrl('challenge', 'state', 'http://localhost/callback').url)

  expect(twitch.searchParams.get('scope')).toContain('moderator:manage:chat_messages')
  expect(twitch.searchParams.get('scope')).toContain('moderator:manage:banned_users')
  expect(twitch.searchParams.get('scope')).toContain('moderator:read:moderators')
  expect(kick.searchParams.get('scope')).toContain('moderation:chat_message:manage')
  expect(kick.searchParams.get('scope')).toContain('moderation:ban')
})
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `bun test tests/auth-moderation-scopes.test.ts`

Expected: FAIL because the requested moderation scopes are absent.

- [ ] **Step 3: Add exactly those scopes to the two OAuth scope lists**

```ts
const TWITCH_SCOPES = [
  'chat:read',
  'chat:edit',
  'user:write:chat',
  'moderator:read:moderators',
  'moderator:manage:chat_messages',
  'moderator:manage:banned_users',
]

scope: 'user:read channel:read chat:write events:subscribe moderation:chat_message:manage moderation:ban'
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `bun test tests/auth-moderation-scopes.test.ts`

Expected: PASS.

### Task 2: Make backend moderation provider calls current and testable

**Files:**

- Modify: `packages/backend/src/api/moderation/kick.ts`
- Modify: `packages/backend/src/api/moderation/types.ts`
- Modify: `packages/backend/tests/moderation.test.ts`

**Interfaces:**

- Produces `Kick.banUser(token, broadcasterUserID, { user_id, duration? })` using `POST /public/v1/moderation/bans`.
- Produces `Kick.deleteMessage(token, messageID)` using `DELETE /public/v1/chat/{message_id}`.
- Keeps `Twitch.deleteMessage` and `Twitch.banUser` unchanged as separate calls.

- [ ] **Step 1: Replace stale Kick test assertions with exact HTTP contract assertions**

```ts
const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
  expect(String(input)).toBe('https://api.kick.com/public/v1/moderation/bans')
  expect(init?.method).toBe('POST')
  expect(JSON.parse(String(init?.body))).toEqual({
    broadcaster_user_id: 999,
    user_id: 123,
    duration: 5,
  })
  return Response.json({ data: {} })
})

expect(String(deleteRequest)).toBe('https://api.kick.com/public/v1/chat/msg-kick-123')
expect(deleteInit?.method).toBe('DELETE')
```

- [ ] **Step 2: Run the focused provider tests and confirm failure**

Run: `bun test tests/moderation.test.ts`

Expected: FAIL because `kick.ts` uses obsolete `/v1/channels/...` paths and old field names.

- [ ] **Step 3: Replace the Kick request DTO and implementation**

```ts
export interface KickBanRequest {
  broadcaster_user_id: number
  user_id: number
  duration?: number
  reason?: string
}

await fetch('https://api.kick.com/public/v1/moderation/bans', {
  method: 'POST',
  headers: { Authorization: `Bearer ${kickToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(request),
})

await fetch(`https://api.kick.com/public/v1/chat/${encodeURIComponent(messageID)}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${kickToken}` },
})
```

Convert the common rail duration from seconds to whole minutes only for Kick; omit `duration` for a permanent ban. Remove the unsupported Kick unban helper instead of leaving a stale endpoint behind.

- [ ] **Step 4: Run the focused provider tests and confirm success**

Run: `bun test tests/moderation.test.ts`

Expected: PASS, including Twitch delete/timeout/ban regressions and Kick URL/payload assertions.

### Task 3: Expose authenticated moderation action and capability routes

**Files:**

- Create: `packages/backend/src/api/moderation/service.ts`
- Create: `packages/backend/src/routes/moderation.ts`
- Modify: `packages/backend/src/index.ts`
- Create: `packages/backend/tests/moderation-routes.test.ts`

**Interfaces:**

- Consumes: `{ platform, channelSlug, messageId, targetUserId, action, durationSeconds?, accessToken, platformUserId, scopes }`.
- Produces: `{ canModerate: boolean }` for `POST /api/moderation/capabilities` and `{ success: boolean, error?: { message: string } }` for `POST /api/moderation/action`.

- [ ] **Step 1: Write failing service tests with injected fetch stubs**

```ts
expect(
  await getModerationCapabilities({
    platform: 'twitch',
    channelSlug: 'streamer',
    platformUserId: '42',
    accessToken: 'token',
    scopes: [
      'moderator:read:moderators',
      'moderator:manage:chat_messages',
      'moderator:manage:banned_users',
    ],
  }),
).toEqual({ canModerate: true })

expect(
  await executeModerationAction({
    platform: 'kick',
    channelSlug: 'creator',
    messageId: 'message-id',
    targetUserId: '5',
    action: 'delete_message',
    accessToken: 'token',
    platformUserId: '1',
    scopes: ['moderation:chat_message:manage'],
  }),
).toMatchObject({ success: true })
```

- [ ] **Step 2: Run the test and confirm it fails because the service is absent**

Run: `bun test tests/moderation-routes.test.ts`

Expected: FAIL with a missing module/export error.

- [ ] **Step 3: Implement strict validation and provider dispatch**

```ts
export async function executeModerationAction(input: ModerationInput): Promise<ModerationResult> {
  assertActionScope(input)
  const broadcasterUserId = await resolveBroadcasterUserID(input)
  if (input.platform === 'twitch' && input.action === 'delete_message') {
    return Twitch.deleteMessage(
      input.accessToken,
      broadcasterUserId,
      input.platformUserId,
      input.messageId,
    )
  }
  if (input.platform === 'twitch') {
    return Twitch.banUser(input.accessToken, broadcasterUserId, input.platformUserId, {
      user_id: input.targetUserId,
      duration: input.action === 'timeout' ? input.durationSeconds : null,
    })
  }
  return input.action === 'delete_message'
    ? Kick.deleteMessage(input.accessToken, input.messageId)
    : Kick.banUser(input.accessToken, Number(broadcasterUserId), {
        broadcaster_user_id: Number(broadcasterUserId),
        user_id: Number(input.targetUserId),
        ...(input.action === 'timeout'
          ? { duration: Math.ceil((input.durationSeconds ?? 0) / 60) }
          : {}),
      })
}
```

Resolve Twitch channel slug to a broadcaster ID with `resolveTwitchUserId`; resolve Kick through `handleKickChatroom`. Twitch watched-tab capability must confirm the account is the broadcaster or appears in `Twitch.isModerator`; Kick capability must require the scopes corresponding to rail actions because the public API has no moderator-list endpoint. Both routes must call `requireClient` before parsing the body and return provider failures as structured successful JSON so the bridge can turn them into an actionable Wails error.

- [ ] **Step 4: Register the route map and verify the route contract**

```ts
routes: {
  ...streamRoutes,
  ...moderationRoutes,
}
```

Run: `bun test tests/moderation-routes.test.ts`

Expected: PASS; tests cover missing client secret, missing scope, Twitch moderator/broadcaster eligibility, Kick scope eligibility, and distinct delete versus ban dispatch.

### Task 4: Add the bounded Go avatar resolver

**Files:**

- Create: `packages/desktop/internal/avatar/resolver.go`
- Create: `packages/desktop/internal/avatar/resolver_test.go`
- Modify: `packages/desktop/internal/contracts/{models,requests}.go`

**Interfaces:**

- Produces `avatar.Resolver.Resolve(context.Context, contracts.ResolveAvatarParams) (contracts.AvatarResolution, error)`.
- `ResolveAvatarParams` is `{ platform, authorId, username }`; `AvatarResolution` is `{ avatarUrl }`.

- [ ] **Step 1: Write failing resolver tests with an `httptest.Server` backend**

```go
func TestResolverDeduplicatesConcurrentTwitchRequests(t *testing.T) {
  resolver := newTestResolver(t, server.URL, time.Hour, time.Minute)
  results := make(chan contracts.AvatarResolution, 2)
  go func() { value, _ := resolver.Resolve(context.Background(), twitchAuthor); results <- value }()
  go func() { value, _ := resolver.Resolve(context.Background(), twitchAuthor); results <- value }()
  <-results; <-results
  if got := serverCalls.Load(); got != 1 { t.Fatalf("calls = %d, want 1", got) }
}

func TestResolverCachesEmptyLookupForNegativeTTL(t *testing.T) { /* two calls, one backend request */ }
```

- [ ] **Step 2: Run the Go resolver test and confirm it fails**

Run: `go test ./internal/avatar -run 'TestResolver' -count=1`

Expected: FAIL because package `internal/avatar` does not exist.

- [ ] **Step 3: Implement cache, in-flight deduplication, and provider lookup**

```go
type Config struct {
  Backend *backend.HTTPClient
  PositiveTTL time.Duration
  NegativeTTL time.Duration
  MaxEntries int
}

func (r *Resolver) Resolve(ctx context.Context, input contracts.ResolveAvatarParams) (contracts.AvatarResolution, error) {
  key := string(input.Platform) + ":" + input.AuthorID
  // Return an unexpired entry, wait on an existing call, or install one call.
  // Fetch outside r.mu, then store a positive or negative TTL entry and close waiters.
}
```

Twitch must decode `/api/twitch/user?userId=<escaped id>` and read `user.profile_image_url`. Kick must decode `/api/kick/chatroom?slug=<escaped username>` and read `avatarUrl`. Reject platforms other than Twitch/Kick and reject an empty author ID before I/O. Evict the oldest stored entry before exceeding `MaxEntries`.

- [ ] **Step 4: Run focused resolver tests**

Run: `gofmt -w internal/avatar/resolver.go internal/avatar/resolver_test.go && go test ./internal/avatar -count=1`

Expected: PASS for positive cache, negative cache, concurrent deduplication, invalid params, Twitch decoding, and Kick decoding.

### Task 5: Wire avatar and moderation requests into the Wails gateway

**Files:**

- Create: `packages/desktop/internal/bridge/avatar_handlers.go`
- Create: `packages/desktop/internal/bridge/moderation_handlers.go`
- Create: `packages/desktop/internal/bridge/avatar_handlers_test.go`
- Create: `packages/desktop/internal/bridge/moderation_handlers_test.go`
- Modify: `packages/desktop/internal/contracts/requests.go`
- Modify: `packages/desktop/main.go`
- Regenerate: `packages/desktop/frontend/bindings/**`

**Interfaces:**

- Adds `resolveAvatar`, `getModerationCapabilities`, and `moderateMessage` request methods.
- The Vue side sends no credentials; `RegisterModerationHandlers` retrieves the local account token and forwards it only to the authenticated backend route.

- [ ] **Step 1: Write failing handler tests with fake resolver/client/storage**

```go
registry.Register(contracts.RequestResolveAvatar, handler)
value, err := registry.get(contracts.RequestResolveAvatar)(ctx, map[string]any{
  "platform": "twitch", "authorId": "7", "username": "viewer",
})

_, err = registry.get(contracts.RequestModerateMessage)(ctx, map[string]any{
  "platform": "twitch", "channelSlug": "streamer", "messageId": "m", "targetUserId": "7", "action": "delete_message",
})
```

- [ ] **Step 2: Run the focused bridge tests and confirm failure**

Run: `go test ./internal/bridge -run 'Test(Avatar|Moderation)' -count=1`

Expected: FAIL because the request constants and registration functions are absent.

- [ ] **Step 3: Define DTOs and register the handlers**

```go
type ModerateMessageParams struct {
  Platform contracts.Platform `json:"platform"`
  ChannelSlug string `json:"channelSlug"`
  MessageID string `json:"messageId"`
  TargetUserID string `json:"targetUserId"`
  Action string `json:"action"`
  DurationSeconds *int `json:"durationSeconds,omitempty"`
}

func RegisterModerationHandlers(registry *HandlerRegistry, client *backend.HTTPClient, store *storage.Storage) {
  // Decode params, find account by platform, read token, attach platformUserId/scopes,
  // POST to /api/moderation/capabilities or /api/moderation/action, and surface success:false as an error.
}
```

Instantiate `avatar.NewResolver` in `main.go`, register both handler groups before `host.Start()`, run `wails3 generate bindings -ts` from `packages/desktop`, and never edit generated bindings by hand.

- [ ] **Step 4: Format and run focused bridge tests**

Run: `gofmt -w internal/contracts internal/bridge main.go && go test ./internal/bridge -run 'Test(Avatar|Moderation)' -count=1`

Expected: PASS; token is present in backend payload but absent from Wails params, and unsuccessful provider result becomes a bridge error.

### Task 6: Add reactive non-blocking avatar rendering

**Files:**

- Create: `packages/desktop/src/views/main/composables/useAvatarCache.ts`
- Create: `packages/desktop/tests/avatar-cache.test.ts`
- Modify: `packages/desktop/src/views/main/services/desktop-api.ts`
- Modify: `packages/desktop/src/views/main/components/ChatMessage.vue`

**Interfaces:**

- Adds `desktopApi.request.resolveAvatar({ platform, authorId, username }): Promise<{ avatarUrl: string }>`.
- `useAvatarCache()` exposes `avatarUrlFor(message)` and `ensureAvatar(message): void`; neither returns a promise required for rendering.

- [ ] **Step 1: Write failing composable and source-contract tests**

```ts
test('returns no avatar immediately then updates every matching message after a single background lookup', async () => {
  const api = createAvatarCacheApi(async () => ({ avatarUrl: 'https://cdn/avatar.png' }))
  const cache = createAvatarCache(api)
  expect(cache.avatarUrlFor(twitchMessage)).toBeUndefined()
  cache.ensureAvatar(twitchMessage)
  await flushPromises()
  expect(cache.avatarUrlFor(laterMessageFromSameAuthor)).toBe('https://cdn/avatar.png')
  expect(api.calls).toBe(1)
})

expect(chatMessageSource).toContain('avatarImageReady')
expect(chatMessageSource).toContain("props.chatTheme === 'compact'")
expect(chatMessageSource).toContain('props.showAvatar !== false')
```

- [ ] **Step 2: Run and confirm the new tests fail**

Run: `bun test tests/avatar-cache.test.ts`

Expected: FAIL because cache/composable and compact avatar markup do not exist.

- [ ] **Step 3: Implement the reactive cache and fallback-first markup**

```ts
const urls = reactive(new Map<string, string>())
const requested = new Set<string>()

function ensureAvatar(message: NormalizedChatMessage): void {
  const key = avatarKey(message)
  if (!key || urls.has(key) || requested.has(key)) return
  requested.add(key)
  void desktopApi.request
    .resolveAvatar(toResolveParams(message))
    .then(({ avatarUrl }) => {
      if (avatarUrl) urls.set(key, avatarUrl)
    })
    .catch(() => undefined)
}
```

In `ChatMessage`, watch the author key with `{ immediate: true }` and call `ensureAvatar`. Keep the initials element mounted until `<img>` emits `load`; on `error`, retain the initials. Render the same `avatar-wrap` in compact and modern branches only when `showAvatar !== false`. A provided Kick `message.author.avatarUrl` must seed the shared map immediately and never require lookup.

- [ ] **Step 4: Run focused UI tests and typecheck**

Run: `bun test tests/avatar-cache.test.ts && bun run typecheck`

Expected: PASS; no `any`, immediate fallback and cache update paths are covered.

### Task 7: Implement the moderation rail and integrate it into chat lists

**Files:**

- Create: `packages/desktop/src/views/main/utils/moderation-drag.ts`
- Create: `packages/desktop/src/views/main/components/MessageModerationRail.vue`
- Create: `packages/desktop/tests/moderation-drag.test.ts`
- Create: `packages/desktop/tests/chat-moderation-rail.test.ts`
- Modify: `packages/desktop/src/views/main/services/desktop-api.ts`
- Modify: `packages/desktop/src/views/main/components/ChatMessage.vue`
- Modify: `packages/desktop/src/views/main/components/ChatList.vue`

**Interfaces:**

- `moderationActionForDrag(platform, distance)` returns `null | { action: 'delete_message' | 'timeout' | 'ban'; durationSeconds?: number; label: string }`.
- Rail emits `moderate` only after pointer release with an eligible action.
- `desktopApi.request.getModerationCapabilities` and `.moderateMessage` use the new typed Wails methods.

- [ ] **Step 1: Write failing pure mapping and integration contract tests**

```ts
expect(moderationActionForDrag('twitch', 20)).toBeNull()
expect(moderationActionForDrag('kick', 48)).toMatchObject({ action: 'delete_message' })
expect(moderationActionForDrag('twitch', 128)).toMatchObject({
  action: 'timeout',
  durationSeconds: 300,
})
expect(moderationActionForDrag('kick', 400)).toMatchObject({ action: 'ban' })

expect(chatListSource).toContain('!props.watchedChannel')
expect(chatListSource).toContain('getModerationCapabilities')
expect(chatMessageSource).toContain('MessageModerationRail')
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test tests/moderation-drag.test.ts tests/chat-moderation-rail.test.ts`

Expected: FAIL because the mapper, component, gateway facade, and chat wiring do not exist.

- [ ] **Step 3: Implement the discrete rail interactions and capability gating**

```ts
const TIMEOUTS = [60, 300, 600, 1800, 3600, 86_400, 604_800] as const
export function moderationActionForDrag(
  platform: 'twitch' | 'kick',
  distance: number,
): ModerationDragAction | null {
  if (distance < 32) return null
  if (distance < 80) return { action: 'delete_message', label: 'Delete message' }
  const index = Math.min(Math.floor((distance - 80) / 42), TIMEOUTS.length - 1)
  if (distance < 80 + TIMEOUTS.length * 42)
    return {
      action: 'timeout',
      durationSeconds: TIMEOUTS[index],
      label: formatTimeout(TIMEOUTS[index]),
    }
  return { action: 'ban', label: 'Ban permanently' }
}
```

`MessageModerationRail` must use pointer capture, preview the current action while dragging, cancel below 32 px, and emit only on pointer release. `ChatList` must always show the rail on the combined My Channels view for Twitch/Kick message rows. On a watched tab, it must request capabilities when the tab/platform/account changes and show the rail only when `canModerate` is true. The moderation action handler must call `desktopApi.request.moderateMessage`, disable only the active rail while its promise is pending, and show a short success/error toast without changing the message list.

- [ ] **Step 4: Run focused rail tests and typecheck**

Run: `bun test tests/moderation-drag.test.ts tests/chat-moderation-rail.test.ts && bun run typecheck`

Expected: PASS for thresholds, valid Twitch/Kick timeout range, cancellation, My Channels visibility, watched capability gating, and error toast wiring.

### Task 8: Format, regenerate, and perform full verification

**Files:**

- Modify only files changed by Tasks 1–7; do not add generated or unrelated churn.

- [ ] **Step 1: Regenerate and inspect Wails bindings**

Run: `wails3 generate bindings -ts && git diff --check`

Expected: generated contract enum exposes `RequestResolveAvatar`, `RequestGetModerationCapabilities`, and `RequestModerateMessage`; no whitespace errors.

- [ ] **Step 2: Apply project formatting and lint fixes**

Run: `bun run fix && gofmt -w internal/avatar internal/bridge internal/contracts main.go`

Expected: formatter exits successfully. Do not commit the resulting changes.

- [ ] **Step 3: Run desktop and backend test suites**

Run: `go test ./... && bun test tests/ && (cd ../backend && bun test)`

Expected: all suites pass.

- [ ] **Step 4: Run static checks and inspect final scope**

Run: `bun run lint && bun run typecheck && git status --short && git diff --check`

Expected: lint/typecheck/diff check pass; status contains only this feature’s uncommitted files plus pre-existing user work.

## Self-review

- **Spec coverage:** Task 4–6 implements immediate fallbacks, async background resolution, positive/negative caching, cache reuse, Twitch/Kick lookup, both themes, and the existing toggle. Tasks 1–3 and 5–7 implement the required permissions, provider-specific action requests, home/watched visibility rules, drag UI, and visible failures. Task 8 covers formatting and verification.
- **Placeholder scan:** the plan specifies concrete interfaces, endpoint paths, payload fields, tests, commands, and failure expectations; it contains no deferred implementation markers.
- **Type consistency:** desktop request names are `resolveAvatar`, `getModerationCapabilities`, and `moderateMessage` from Go contract through `desktop-api.ts`; provider action spelling remains `delete_message`, `timeout`, and `ban` across backend, bridge, and Vue.
