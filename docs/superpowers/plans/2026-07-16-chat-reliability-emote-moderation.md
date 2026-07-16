# Chat Reliability, Emotes, and Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop chat reliably follow new messages, keep its compact
composer usable, surface connection and 7TV changes, and preserve moderation
and profile actions for deleted messages.

**Architecture:** Keep pure chat-scroll, textarea, connection-notice, emote
catalog, and public-channel-url rules in small frontend utilities/composables.
`ChatList`, `ChatInput`, `EmotePicker`, and `UserCardDialog` render those
rules. The Wails bridge remains the sole Vue/native boundary; the existing
native 7TV catalog is adapted into source-tagged picker entries and continues
to publish live catalog mutations.

**Tech Stack:** Vue 3.5, Pinia 3, Virtua 0.49, Reka UI 2.9, Bun tests, Go,
Wails v3, and the current native 7TV service.

## Global Constraints

- Work in `/home/satont/Documents/Projects/chat`; do not overwrite unrelated
  user changes.
- Prefix every shell command with `rtk` and use Bun for JavaScript/TypeScript
  scripts and tests.
- The Wails main window minimum is exactly `720 x 520`.
- `showChannelLabel` and `emoteSessionCache` default to `true` and are the only
  new persisted settings.
- The catalog cache is memory-only. Disabling it re-requests the current native
  catalog on picker open; no catalog or image files are written by TwirChat.
- The picker order is Channel, 7TV, Collectibles, Global; empty groups are not
  displayed.
- 7TV mutations update the session catalog and issue a transient notice; they
  never create a chat-history system message.
- Moderation requests remain native/backend operations; Vue only uses the Wails
  gateway.
- Run `bun run fix`, `bun run lint`, `bun run typecheck`, focused Bun tests,
  and focused Go tests before each task commit. Run the full desktop suites at
  the end.

---

## File structure

| File                                                                   | Responsibility                                           |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/shared/types.ts`                                             | New persisted setting defaults.                          |
| `packages/desktop/internal/app/application.go`                         | Native Wails minimum dimensions.                         |
| `packages/desktop/src/views/main/utils/chat-scroll.ts`                 | Pure 64px bottom threshold.                              |
| `packages/desktop/src/views/main/utils/chat-textarea.ts`               | Stable composer-height calculation.                      |
| `packages/desktop/src/views/main/composables/useConnectionNotice.ts`   | Per-channel transition de-duplication and expiry.        |
| `packages/desktop/src/views/main/composables/useTransientNotice.ts`    | One app-wide transient-notice queue.                     |
| `packages/desktop/src/views/main/components/ChatNotice.vue`            | Accessible top-level notification surface.               |
| `packages/desktop/src/views/main/utils/emote-catalog.ts`               | Source grouping, filtering, and entry ordering.          |
| `packages/desktop/src/views/main/stores/emoteStore.ts`                 | Session cache and live 7TV mutation application.         |
| `packages/desktop/internal/contracts/models.go`                        | Source-tagged emote catalog DTO.                         |
| `packages/desktop/internal/bridge/seventv_handlers.go`                 | Convert native 7TV entries into catalog DTOs.            |
| `packages/desktop/src/views/main/utils/public-channel-url.ts`          | Safe Twitch, Kick, and YouTube public URLs.              |
| `packages/desktop/src/views/main/composables/useModerationOutcomes.ts` | Five-minute deletion retention and tombstone resolution. |

## Task 1: Persist chat preferences and enforce the native window minimum

**Files:**

- Modify: `packages/shared/types.ts`
- Modify: `packages/desktop/src/views/main/components/ui/ChatAppearancePopover.vue`
- Modify: `packages/desktop/src/views/main/components/ChatList.vue`
- Modify: `packages/desktop/src/views/main/components/ChatInput.vue`
- Modify: `packages/desktop/internal/app/application.go`
- Test: `packages/desktop/tests/chat-appearance-settings.test.ts`
- Test: `packages/desktop/internal/app/application_test.go`

**Interfaces:**

- Produces `AppSettings.showChannelLabel: boolean` and
  `AppSettings.emoteSessionCache: boolean`.
- `ChatInput` consumes `settings: AppSettings` and uses
  `settings.showChannelLabel`.
- `mainWindowOptions()` produces `MinWidth: 720` and `MinHeight: 520`.

- [ ] **Step 1: Write failing settings and window tests**

Create `packages/desktop/tests/chat-appearance-settings.test.ts` with:

```ts
import { expect, test } from 'bun:test'
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'

test('defaults the chat label and session emote cache on', () => {
  expect(DEFAULT_SETTINGS.showChannelLabel).toBe(true)
  expect(DEFAULT_SETTINGS.emoteSessionCache).toBe(true)
})
```

Extend `TestNewConfiguresHostWithoutStartingServices` with:

```go
if got.MinWidth != 720 || got.MinHeight != 520 {
    t.Errorf("minimum window size = %dx%d, want 720x520", got.MinWidth, got.MinHeight)
}
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
rtk bash -lc 'cd packages/desktop && bun test tests/chat-appearance-settings.test.ts'
rtk bash -lc 'cd packages/desktop && go test ./internal/app -run TestNewConfiguresHostWithoutStartingServices'
```

Expected: the TypeScript test fails because the fields are missing, and the Go
test fails because the minimum dimensions are zero.

- [ ] **Step 3: Implement defaults, controls, and propagation**

Add the fields to `AppSettings` and `DEFAULT_SETTINGS`:

```ts
showChannelLabel: boolean
emoteSessionCache: boolean

// DEFAULT_SETTINGS
showChannelLabel: true,
emoteSessionCache: true,
```

Add two labelled checkbox controls to `ChatAppearancePopover` that call its
existing `patch` function:

```vue
<label class="appearance-toggle">
  <input
    type="checkbox"
    :checked="settings.showChannelLabel"
    @change="patch({ showChannelLabel: ($event.target as HTMLInputElement).checked })"
  />
  Show channel label
</label>
```

Use the same pattern for `emoteSessionCache`. Pass the non-null settings from
`ChatList` to `ChatInput`; `ChatInput` renders the channel target row only when
`settings.showChannelLabel` is true. Keep the compact status indicator outside
that condition so a disconnected chat is still visible.

Set the Wails option in `mainWindowOptions`:

```go
MinWidth:  720,
MinHeight: 520,
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
rtk bash -lc 'cd packages/desktop && bun test tests/chat-appearance-settings.test.ts'
rtk bash -lc 'cd packages/desktop && go test ./internal/app'
rtk bash -lc 'cd packages/desktop && bun run typecheck'
```

Expected: all commands exit zero.

- [ ] **Step 5: Format, verify, and commit**

Run:

```bash
rtk bun run fix
rtk bun run lint
rtk bun run typecheck
rtk git add packages/shared/types.ts packages/desktop/src/views/main/components/ui/ChatAppearancePopover.vue packages/desktop/src/views/main/components/ChatList.vue packages/desktop/src/views/main/components/ChatInput.vue packages/desktop/internal/app/application.go packages/desktop/tests/chat-appearance-settings.test.ts packages/desktop/internal/app/application_test.go
rtk git commit -m "feat(desktop): add chat appearance preferences"
```

Expected: formatter, linter, typecheck, and commit all succeed.

## Task 2: Fix virtual-list bottom following and composer sizing

**Files:**

- Create: `packages/desktop/src/views/main/utils/chat-scroll.ts`
- Create: `packages/desktop/src/views/main/utils/chat-textarea.ts`
- Modify: `packages/desktop/src/views/main/components/ChatList.vue`
- Modify: `packages/desktop/src/views/main/components/ChatInput.vue`
- Test: `packages/desktop/tests/chat-scroll.test.ts`
- Test: `packages/desktop/tests/chat-textarea.test.ts`

**Interfaces:**

- Produces `isNearChatBottom(scrollSize, offset, viewportSize): boolean`.
- Produces `nextTextareaHeight(scrollHeight, minimumHeight): number`.
- `ChatList` uses Virtua's documented `onScroll(offset)` and
  `scrollToIndex(lastIndex, { align: 'end' })` APIs.

- [ ] **Step 1: Write failing pure-rule tests**

Create `chat-scroll.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { isNearChatBottom } from '../src/views/main/utils/chat-scroll'

test('only treats the final 64 pixels as the chat bottom', () => {
  expect(isNearChatBottom(1_000, 700, 240)).toBe(true)
  expect(isNearChatBottom(1_000, 695, 240)).toBe(false)
})
```

Create `chat-textarea.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { nextTextareaHeight } from '../src/views/main/utils/chat-textarea'

test('preserves a one-line minimum and caps growth at 120 pixels', () => {
  expect(nextTextareaHeight(12, 36)).toBe(36)
  expect(nextTextareaHeight(72, 36)).toBe(72)
  expect(nextTextareaHeight(240, 36)).toBe(120)
})
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
rtk bash -lc 'cd packages/desktop && bun test tests/chat-scroll.test.ts tests/chat-textarea.test.ts'
```

Expected: both fail because their utilities do not exist.

- [ ] **Step 3: Implement the pure rules and integrate them**

Implement `chat-scroll.ts` exactly:

```ts
export const CHAT_BOTTOM_TOLERANCE = 64

export function isNearChatBottom(
  scrollSize: number,
  offset: number,
  viewportSize: number,
): boolean {
  return scrollSize - offset - viewportSize <= CHAT_BOTTOM_TOLERANCE
}
```

Implement `chat-textarea.ts` exactly:

```ts
export const CHAT_TEXTAREA_MAX_HEIGHT = 120

export function nextTextareaHeight(scrollHeight: number, minimumHeight: number): number {
  return Math.min(CHAT_TEXTAREA_MAX_HEIGHT, Math.max(minimumHeight, scrollHeight))
}
```

In `ChatList`, replace the hard-coded 40px calculation with
`isNearChatBottom`. On each appended message, capture whether the list was at
the bottom before mutation, wait for Vue's post-render flush and one animation
frame, then call `scrollToIndex(lastIndex, { align: 'end' })` only when that
captured value is true. Re-run the same end-aligned scroll from the VList item
resize/range callback while follow mode is true. The latest control derives
solely from `!isAtBottom` and calls the same end-aligned helper.

In `ChatInput.resizeTextarea`, set `height` to `0px`, obtain the one-line
minimum from `getComputedStyle(el).lineHeight` plus vertical padding and
borders, and assign `nextTextareaHeight(el.scrollHeight, minimum) + 'px'`.
Set `box-sizing: border-box`, `min-height: 36px`, and `align-self: stretch` on
the textarea; use fixed `36px` controls in `.input-row`.

- [ ] **Step 4: Run focused tests and chat checks**

Run:

```bash
rtk bash -lc 'cd packages/desktop && bun test tests/chat-scroll.test.ts tests/chat-textarea.test.ts tests/chat-moderation-outcome-render.test.ts'
rtk bash -lc 'cd packages/desktop && bun run typecheck'
```

Expected: all commands exit zero and the existing moderation render test still
passes with the adjusted layout.

- [ ] **Step 5: Format, verify, and commit**

Run:

```bash
rtk bun run fix
rtk bun run lint
rtk git add packages/desktop/src/views/main/utils/chat-scroll.ts packages/desktop/src/views/main/utils/chat-textarea.ts packages/desktop/src/views/main/components/ChatList.vue packages/desktop/src/views/main/components/ChatInput.vue packages/desktop/tests/chat-scroll.test.ts packages/desktop/tests/chat-textarea.test.ts
rtk git commit -m "fix(desktop): stabilize chat scrolling and composer sizing"
```

Expected: no whitespace errors and a successful commit.

## Task 3: Surface channel connection transitions

**Files:**

- Create: `packages/desktop/src/views/main/composables/useConnectionNotice.ts`
- Create: `packages/desktop/src/views/main/composables/useTransientNotice.ts`
- Create: `packages/desktop/src/views/main/components/ChatNotice.vue`
- Modify: `packages/desktop/src/views/main/App.vue`
- Modify: `packages/desktop/src/views/main/components/ChatInput.vue`
- Test: `packages/desktop/tests/connection-notice.test.ts`

**Interfaces:**

- Produces `createConnectionNoticeStore(now, schedule)` with
  `observe(channelKey, status)` and `notice`.
- `notice` is `{ kind: 'info' | 'success' | 'error'; text: string } | null`.
- Produces `useTransientNotice().show(notice, durationMs)`, rendered once by
  `ChatNotice` at the application root.
- Consumes existing `PlatformStatusInfo` events supplied through `ChatList` and
  `ChatInput` props.

- [ ] **Step 1: Write failing transition tests**

Create `connection-notice.test.ts` using injected time and scheduler:

```ts
test('deduplicates identical status within five seconds', () => {
  const notices = createConnectionNoticeStore(
    () => 1_000,
    () => 1,
  )
  expect(notices.observe('kick:channel', { status: 'connecting' })).toMatchObject({
    text: 'Connecting to channel…',
  })
  expect(notices.observe('kick:channel', { status: 'connecting' })).toBeNull()
})
```

Add cases for `connected`, `disconnected`, and `error`, asserting 3,000ms for
informational/success notices and 6,000ms for error notices.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `rtk bash -lc 'cd packages/desktop && bun test tests/connection-notice.test.ts'`

Expected: failure because the notice composable is absent.

- [ ] **Step 3: Implement transition state and compact UI**

Use the following public shape:

```ts
export interface ConnectionNoticeStore {
  observe(channelKey: string, status: PlatformStatusInfo): ConnectionNotice | null
}
```

Store the previous `status.status` and its timestamp per channel key. Emit
`Connecting to ${name}…`, `Connected to ${name}`, `${name} disconnected`, or
the safe `status.error` fallback. Do not suppress a changed state. Implement
the app-wide notice composable as a ref plus one replacement timer; its `show`
method clears the old timer, replaces the visible notice, and clears it after
the supplied duration. Render it once from `App.vue` via an aria-live
`ChatNotice` component. Feed both existing `platform_status` and
`watched_channel_status` listeners through the connection store before they
update their status maps. Keep a small state dot and text in `ChatInput`'s
channel-label row whenever the active status is not `connected`.

- [ ] **Step 4: Run focused test and typecheck**

Run:

```bash
rtk bash -lc 'cd packages/desktop && bun test tests/connection-notice.test.ts tests/channel-connections.test.ts'
rtk bash -lc 'cd packages/desktop && bun run typecheck'
```

Expected: all commands exit zero.

- [ ] **Step 5: Format, verify, and commit**

Run:

```bash
rtk bun run fix
rtk bun run lint
rtk git add packages/desktop/src/views/main/composables/useConnectionNotice.ts packages/desktop/src/views/main/composables/useTransientNotice.ts packages/desktop/src/views/main/components/ChatNotice.vue packages/desktop/src/views/main/App.vue packages/desktop/src/views/main/components/ChatInput.vue packages/desktop/tests/connection-notice.test.ts
rtk git commit -m "feat(desktop): show chat connection transitions"
```

Expected: the commit contains no unrelated files.

## Task 4: Define source-tagged emote catalogs at the Wails boundary

**Files:**

- Modify: `packages/shared/protocol.ts`
- Modify: `packages/desktop/internal/contracts/models.go`
- Modify: `packages/desktop/internal/bridge/seventv_handlers.go`
- Modify: `packages/desktop/internal/bridge/seventv_handlers_test.go`
- Modify: `packages/desktop/src/views/main/services/desktop-api.ts`
- Test: `packages/desktop/tests/desktop-api.test.ts`

**Interfaces:**

- Produces `EmoteSource = 'channel' | 'seventv' | 'collectibles' | 'global'`.
- Produces `EmoteCatalogEntry { id, alias, name, imageUrl, animated,
zeroWidth, aspectRatio, source }`.
- `getChannelEmotes` returns `EmoteCatalogEntry[]`; the native 7TV runtime maps
  every current item to source `seventv`.

- [ ] **Step 1: Write failing bridge and facade expectations**

Change `TestRegisterSevenTVHandlersReturnsChannelScopedEmotesToVue` to expect:

```go
[]contracts.EmoteCatalogEntry{{
    ID: "7tv-1", Alias: "чё", Name: "чё", ImageURL: "https://cdn.test/7tv.webp",
    AspectRatio: 1, Source: contracts.EmoteSourceSevenTV,
}}
```

Add a `desktop-api.test.ts` assertion that `getChannelEmotes` deserializes an
entry with `source: 'seventv'` without altering the existing gateway method.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
rtk bash -lc 'cd packages/desktop && go test ./internal/bridge -run TestRegisterSevenTVHandlersReturnsChannelScopedEmotesToVue'
rtk bash -lc 'cd packages/desktop && bun test tests/desktop-api.test.ts'
```

Expected: Go fails because the catalog DTO is absent; TypeScript fails because
the facade still returns `SevenTVEmote[]`.

- [ ] **Step 3: Implement the common DTO and 7TV adapter**

Define matching Go and TypeScript entries. The Go conversion is explicit:

```go
func catalogEntry(emote contracts.SevenTVEmote) contracts.EmoteCatalogEntry {
    return contracts.EmoteCatalogEntry{
        ID: emote.ID, Alias: emote.Alias, Name: emote.Name, ImageURL: emote.ImageURL,
        Animated: emote.Animated, ZeroWidth: emote.ZeroWidth,
        AspectRatio: emote.AspectRatio, Source: contracts.EmoteSourceSevenTV,
    }
}
```

Map the result of `runtime.Emotes` with that helper in
`RegisterSevenTVHandlers`. Update only the response types of
`getChannelEmotes` in the shared protocol and current Wails desktop facade. Do
not change the retired Electrobun RPC schema, add a second gateway method, or
add any disk cache.

- [ ] **Step 4: Run focused bridge, facade, and type tests**

Run:

```bash
rtk bash -lc 'cd packages/desktop && go test ./internal/bridge'
rtk bash -lc 'cd packages/desktop && bun test tests/desktop-api.test.ts tests/desktop-events.test.ts'
rtk bash -lc 'cd packages/desktop && bun run typecheck'
```

Expected: all commands exit zero.

- [ ] **Step 5: Format, verify, and commit**

Run:

```bash
rtk bun run fix
rtk bun run lint
rtk git add packages/shared/protocol.ts packages/desktop/internal/contracts/models.go packages/desktop/internal/bridge/seventv_handlers.go packages/desktop/internal/bridge/seventv_handlers_test.go packages/desktop/src/views/main/services/desktop-api.ts packages/desktop/tests/desktop-api.test.ts
rtk git commit -m "feat(desktop): expose categorized emote catalogs"
```

Expected: no generated Wails binding edits are needed because the desktop
gateway response is dynamically decoded by the existing binding.

## Task 5: Categorize the picker and keep 7TV changes session-local

**Files:**

- Create: `packages/desktop/src/views/main/utils/emote-catalog.ts`
- Modify: `packages/desktop/src/views/main/stores/emoteStore.ts`
- Modify: `packages/desktop/src/views/main/components/EmotePicker.vue`
- Modify: `packages/desktop/src/views/main/App.vue`
- Test: `packages/desktop/tests/emote-catalog.test.ts`
- Test: `packages/desktop/tests/emote-store.test.ts`

**Interfaces:**

- Produces `groupEmoteCatalog(entries, query): EmoteGroup[]` in the approved
  fixed source order.
- `useEmoteStore.loadEmotes(platform, channelId, useSessionCache)` reloads when
  the flag is false.
- Existing `channel_emote_*` messages mutate only the `seventv` entries and
  report an event payload to the app-level transient-notice listener.

- [ ] **Step 1: Write failing group and cache tests**

Create `emote-catalog.test.ts` with one entry for every source and assert:

```ts
expect(groupEmoteCatalog(entries, '')).toEqual([
  expect.objectContaining({ source: 'channel' }),
  expect.objectContaining({ source: 'seventv' }),
  expect.objectContaining({ source: 'collectibles' }),
  expect.objectContaining({ source: 'global' }),
])
```

Also assert a search removes empty groups and retains source order. In
`emote-store.test.ts`, stub `rpc.request.getChannelEmotes`, load twice with
`true`, then once with `false`, and expect call counts `1` then `2`. Assert a
7TV removal cannot remove a same-ID entry from source `channel`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
rtk bash -lc 'cd packages/desktop && bun test tests/emote-catalog.test.ts tests/emote-store.test.ts'
```

Expected: failures because catalog grouping and cache-mode parameters are not
implemented.

- [ ] **Step 3: Implement grouping, reactive mutation, and picker sections**

Implement a source rank map and pure grouping:

```ts
const SOURCES: EmoteSource[] = ['channel', 'seventv', 'collectibles', 'global']
export function groupEmoteCatalog(entries: EmoteCatalogEntry[], query: string): EmoteGroup[] {
  return SOURCES.map((source) => ({
    source,
    entries: filterAndSort(entries, source, query),
  })).filter((group) => group.entries.length > 0)
}
```

Keep `emoteMap` keyed by `platform:channelId`, but store
`EmoteCatalogEntry[]`. Preserve the existing inflight map. When cache is
disabled, skip only the completed-cache short circuit; still coalesce a
simultaneous request. Add/remove/update handlers select entries where
`source === 'seventv'`.

Pass `settings.emoteSessionCache` from `ChatList` through `ChatInput` to the
picker. Render each `EmoteGroup` with a visible heading and a virtualized grid;
reset the virtual list to index zero after a query or group change. Render no
category tab/button for absent sources. Replace the inert PC placeholder with
no element or asset reference.

In `App.vue`, subscribe once to the existing `channel_emote_added`,
`channel_emote_removed`, and `channel_emote_updated` events and feed their
human-readable text into the same transient notice surface used for connection
state. Do not append to `messages` or `events`.

- [ ] **Step 4: Run focused picker and event tests**

Run:

```bash
rtk bash -lc 'cd packages/desktop && bun test tests/emote-catalog.test.ts tests/emote-store.test.ts tests/desktop-events.test.ts'
rtk bash -lc 'cd packages/desktop && bun run typecheck'
```

Expected: all commands exit zero.

- [ ] **Step 5: Format, verify, and commit**

Run:

```bash
rtk bun run fix
rtk bun run lint
rtk git add packages/desktop/src/views/main/utils/emote-catalog.ts packages/desktop/src/views/main/stores/emoteStore.ts packages/desktop/src/views/main/components/EmotePicker.vue packages/desktop/src/views/main/App.vue packages/desktop/tests/emote-catalog.test.ts packages/desktop/tests/emote-store.test.ts
rtk git commit -m "feat(desktop): group session-cached emotes by source"
```

Expected: 7TV remains the only currently populated external group until a
platform integration supplies channel, collectible, or global entries.

## Task 6: Preserve deleted-message context and moderation actions

**Files:**

- Modify: `packages/desktop/src/views/main/composables/useModerationOutcomes.ts`
- Modify: `packages/desktop/src/views/main/components/ChatMessage.vue`
- Modify: `packages/desktop/src/views/main/components/UserContextMenu.vue`
- Modify: `packages/desktop/src/views/main/components/UserCardDialog.vue`
- Modify: `packages/desktop/src/views/main/services/desktop-api.ts`
- Test: `packages/desktop/tests/moderation-outcomes.test.ts`
- Test: `packages/desktop/tests/chat-moderation-outcome-render.test.ts`

**Interfaces:**

- `ResolvedModerationOutcome` exposes `action`, `label`, and `isTombstone`.
- `UserCardDialog` consumes optional `messageId` so an explicit card action can
  use the existing `moderateMessage` request.
- A tombstone retains the original `NormalizedChatMessage` author, platform,
  channel, and ID; only the body is hidden.

- [ ] **Step 1: Write failing tombstone and expiry tests**

Extend `moderation-outcomes.test.ts` with an injectable clock:

```ts
const outcomes = createModerationOutcomeStore(() => now)
outcomes.apply({
  action: 'delete_message',
  channelId: 'streamer',
  messageId: 'message-1',
  platform: 'twitch',
})
expect(outcomes.outcomeFor(message())).toMatchObject({
  action: 'delete_message',
  isTombstone: true,
})
now += 300_001
expect(outcomes.outcomeFor(message())).toBeUndefined()
```

Extend the render test to assert that both compact and modern branches render
`Message deleted` instead of `messageParts` for a deletion and still include
`UserContextMenu` plus `MessageModerationRail` for that outcome.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
rtk bash -lc 'cd packages/desktop && bun test tests/moderation-outcomes.test.ts tests/chat-moderation-outcome-render.test.ts'
```

Expected: tests fail because resolved outcomes lack tombstone state and never
expire.

- [ ] **Step 3: Implement context-preserving tombstones and card payloads**

Change the store factory to accept `now = Date.now`. Store each deletion as
`{ resolved, expiresAt: now() + 300_000 }`; prune expired entries in `apply`
and `outcomeFor`. Return:

```ts
{ action: 'delete_message', label: '(message deleted)', isTombstone: true }
```

Pass `:message-id="message.id"` from both `ChatMessage` branches through
`UserContextMenu` to `UserCardDialog`. In both chat themes, render a
`.deleted-message-body` text node when `isTombstone` is true, otherwise render
the existing parsed body. Keep the moderation rail visible for deletion
outcomes; continue hiding it for completed timeout and ban outcomes.

Add user-card buttons `Timeout 10m` and `Ban` that first call
`getModerationCapabilities({ platform, channelSlug })`. Disable them with the
existing explanatory text when the platform, channel slug, or message ID is
missing. On click call:

```ts
desktopApi.request.moderateMessage({
  platform,
  channelSlug,
  messageId,
  targetUserId: props.platformUserId,
  action: 'timeout',
  durationSeconds: 600,
})
```

Use `action: 'ban'` without `durationSeconds` for the second button. On success
apply the same local moderation outcome that `ChatList.onModerate` uses; on
failure retain enabled actions and show the returned error.

- [ ] **Step 4: Run focused moderation tests and typecheck**

Run:

```bash
rtk bash -lc 'cd packages/desktop && bun test tests/moderation-outcomes.test.ts tests/chat-moderation-outcome-render.test.ts tests/user-card-trigger.test.ts'
rtk bash -lc 'cd packages/desktop && bun run typecheck'
```

Expected: all commands exit zero.

- [ ] **Step 5: Format, verify, and commit**

Run:

```bash
rtk bun run fix
rtk bun run lint
rtk git add packages/desktop/src/views/main/composables/useModerationOutcomes.ts packages/desktop/src/views/main/components/ChatMessage.vue packages/desktop/src/views/main/components/UserContextMenu.vue packages/desktop/src/views/main/components/UserCardDialog.vue packages/desktop/src/views/main/services/desktop-api.ts packages/desktop/tests/moderation-outcomes.test.ts packages/desktop/tests/chat-moderation-outcome-render.test.ts
rtk git commit -m "feat(desktop): moderate users from deleted messages"
```

Expected: tombstones contain no deleted message body and retain valid actions.

## Task 7: Add safe user-card channel links and perform release verification

**Files:**

- Create: `packages/desktop/src/views/main/utils/public-channel-url.ts`
- Modify: `packages/desktop/src/views/main/components/UserCardDialog.vue`
- Test: `packages/desktop/tests/public-channel-url.test.ts`
- Test: `packages/desktop/tests/external-url.test.ts`

**Interfaces:**

- Produces `publicChannelURL(platform, username): string | undefined`.
- `UserCardDialog` calls existing `openExternalUrl` only when the pure resolver
  returns an HTTPS URL.

- [ ] **Step 1: Write failing URL resolver tests**

Create `public-channel-url.test.ts`:

```ts
expect(publicChannelURL('twitch', 'Satont')).toBe('https://www.twitch.tv/Satont')
expect(publicChannelURL('kick', 'satont')).toBe('https://kick.com/satont')
expect(publicChannelURL('youtube', '@TwirChat')).toBe('https://www.youtube.com/@TwirChat')
expect(publicChannelURL('twitch', '../unsafe')).toBeUndefined()
expect(publicChannelURL('youtube', 'not-a-handle')).toBeUndefined()
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `rtk bash -lc 'cd packages/desktop && bun test tests/public-channel-url.test.ts'`

Expected: failure because the resolver module does not exist.

- [ ] **Step 3: Implement URL validation and card action**

Use an ASCII login pattern `^[A-Za-z0-9_]{1,25}$` for Twitch and Kick, and
`^@[A-Za-z0-9._-]{3,30}$` for YouTube. Return only the exact HTTPS origins
below:

```ts
return platform === 'twitch'
  ? `https://www.twitch.tv/${username}`
  : platform === 'kick'
    ? `https://kick.com/${username}`
    : `https://www.youtube.com/${username}`
```

Render `Open channel` in the user-card action row only when the resolver
returns a URL. Call the existing external URL service, disable the button while
the request is pending, and display a retryable inline error when it rejects.

- [ ] **Step 4: Run focused tests and all required verification**

Run:

```bash
rtk bash -lc 'cd packages/desktop && bun test tests/public-channel-url.test.ts tests/external-url.test.ts'
rtk bun run fix
rtk bun run lint
rtk bun run typecheck
rtk bash -lc 'cd packages/desktop && bun test tests/'
rtk bash -lc 'cd packages/desktop && go test ./...'
rtk git diff --check
```

Expected: each command exits zero and `git diff --check` produces no output.

- [ ] **Step 5: Manually validate and commit**

Manually verify all of the following in a 720x520 window:

1. Send a message containing a tall emote and confirm the last rendered row is
   fully visible with no latest button.
2. Scroll away, receive a message, and confirm the button appears; click it and
   confirm it disappears at the real bottom.
3. Enter five composer lines, then send; confirm the bar resets to one line.
4. Toggle channel label and emote session cache, restart the app, and confirm
   only settings persist.
5. Observe reconnect and live 7TV add/remove notices; confirm neither becomes
   chat history.
6. Open a deleted message's user card, timeout or ban the author when allowed,
   and open a valid public channel URL.

Then run:

```bash
rtk git add packages/desktop/src/views/main/utils/public-channel-url.ts packages/desktop/src/views/main/components/UserCardDialog.vue packages/desktop/tests/public-channel-url.test.ts packages/desktop/tests/external-url.test.ts
rtk git commit -m "feat(desktop): link user cards to public channels"
rtk git status --short
```

Expected: the working tree is clean after the final commit.

## Plan self-review

- **Spec coverage:** Task 1 covers settings, the optional channel label, and
  Wails dimensions. Task 2 handles exact bottom-follow and composer behavior.
  Task 3 covers transition notices and persistent non-connected state. Tasks
  4–5 cover source ordering, session cache behavior, 7TV update notices, and
  removal of the inert placeholder. Task 6 covers context-preserving deleted
  messages and user-card moderation. Task 7 covers safe public channel links
  and end-to-end verification.
- **Scope boundary:** Channel, collectible, and global picker groups are fully
  represented by the catalog contract but hidden until a platform integration
  supplies entries. The current native runtime supplies the live 7TV group;
  this avoids adding an unapproved OAuth scope and provider-fetch subsystem.
- **Type consistency:** `EmoteCatalogEntry` is returned by the native handler,
  typed in the frontend RPC facade, stored in Pinia, and consumed by picker
  grouping. `messageId` flows from `ChatMessage` through `UserContextMenu` to
  `UserCardDialog`, which uses the existing moderation request type.
- **Placeholder scan:** all tasks define their files, interfaces, test cases,
  commands, error paths, and commit boundaries.
