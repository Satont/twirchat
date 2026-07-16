# Chat reliability, emotes, and moderation design

**Date:** 2026-07-16

## Goal

Make the chat dependable in a compact window while improving the most frequent
moderation, profile, emote, and connection-state workflows. The work ships as
one cohesive desktop release, with shared state kept narrowly scoped to the
feature that owns it.

## Scope and decisions

- The main window may not be resized below **720 x 520 CSS pixels**.
- The channel label above the composer is globally configurable and shown by
  default.
- The emote catalog can be retained only for the current desktop session. It
  is enabled by default, can be disabled in settings, and never writes catalog
  data to disk.
- 7TV catalog mutations produce short-lived notifications, never chat-history
  rows.
- Empty emote categories are not rendered.
- Moderation actions are available on deleted-message tombstones and in user
  cards only when the selected account can moderate that platform/channel.

## 1. Chat list and composer

### Scroll following

`ChatList` owns one explicit `isNearBottom` state. It is true when the last
rendered message is within 64 CSS pixels of the viewport end. A new message:

1. scrolls to the final list item after Vue and the virtual list have rendered
   when `isNearBottom` was true before the append; or
2. leaves the current viewport unchanged and reveals the scroll-to-latest
   control when it was false.

The virtual-list resize/range signal rechecks the final item after emotes,
images, or wrapped text change a row height. This prevents a late measurement
from leaving the newest message partially below the viewport. The latest
control scrolls the last item into its end alignment and disappears once the
bottom threshold is reached. It is never displayed while the final message is
fully visible.

### Composer layout and keyboard behavior

The composer uses a stable grid/flex layout with a textarea that has:

- one visible line as its minimum block size;
- `border-box` sizing and an explicit reset before measuring `scrollHeight`;
- a maximum of five lines or 120 CSS pixels, whichever is smaller; and
- internal vertical scrolling after that maximum.

`Enter` sends a non-empty message, while `Shift+Enter` inserts a newline. The
autocomplete keyboard contract keeps precedence while its menu is open. The
emote trigger and send control have fixed alignment in the composer bar and do
not grow or shrink with textarea height.

### Channel label and connection state

Add `showChannelLabel: boolean` to persisted desktop appearance settings,
defaulting to `true`. It controls the label immediately above the composer for
both home and watched-channel chat views.

Connection events are normalized by channel key in a small frontend composable.
State transitions show one toast: connecting and connected for three seconds,
and disconnected/error for six seconds. Repeated identical transitions within
five seconds are deduplicated. The current non-connected state remains visible
beside the composer as a compact status indicator, so a toast is not the only
evidence after a connection problem.

The native window configuration enforces the 720 x 520 minimum independently
of the frontend layout.

## 2. Emote catalog and 7TV notifications

### Catalog contract

Introduce a desktop emote-catalog entry with an explicit source:

```ts
type EmoteSource = 'channel' | 'seventv' | 'collectibles' | 'global'

type EmoteCatalogEntry = {
  id: string
  alias: string
  imageUrl: string
  animated: boolean
  source: EmoteSource
}
```

Platform integrations supply the sources they can resolve. The UI remains
correct when a platform does not expose a source: that source is simply absent,
not substituted with a misleading placeholder.

The picker displays source groups in this fixed order:

1. Channel
2. 7TV
3. Collectibles
4. Global

Within a group, aliases sort case-insensitively. Search filters entries in each
group while preserving this group order. If aliases collide, the user sees the
entries in their respective groups and selection continues to insert the alias
text; the existing parser resolves the message consistently with the active
catalog.

### Caching and mutation handling

`useEmoteCatalog` is the sole frontend session cache, keyed by
`platform:channelId`. With the cache setting enabled it reuses a loaded catalog
for the app lifetime. With it disabled it asks the native service for its
current catalog each time the picker opens. Native services may retain their
live provider state in memory to process updates, but neither layer persists
catalog data. Image HTTP caching is outside this setting; no image files or
catalog records are persisted by TwirChat.

Existing 7TV catalog events update the matching cached group immediately.
Add, remove, and rename changes show a transient toast naming the affected
emote and channel. They are not transformed into `NormalizedChatMessage`
system rows.

Remove the non-functional PC-emote/placeholder entry and its dead UI wiring.

## 3. Deleted-message moderation and user cards

When an AutoMod or moderator deletion event targets a displayed message, the
message becomes a tombstone instead of losing its context. The tombstone hides
the deleted message body and retains the original platform, channel, author ID,
author name, and message ID. It therefore remains a valid moderation target.

The moderation rail stays available on tombstones. The user card also exposes
explicit **Timeout** and **Ban** actions. Before rendering either action, the
card loads the existing moderation capabilities for its selected account and
channel. It shows a disabled explanation for missing channel context,
unsupported platforms, or insufficient authorization. A failed request leaves
the action available for retry and reports the failure; only a successful
response applies the local moderation outcome.

Add an **Open channel** user-card action. It delegates to the existing external
URL service and uses a platform-specific, validated public channel URL built
from the resolved user/channel identity. If no safe URL can be resolved, the
action is omitted.

## 4. Component boundaries

| Unit | Responsibility |
| --- | --- |
| `ChatList` / scroll composable | Virtual-list follow state and scroll-to-latest visibility. |
| `ChatInput` | Composer display, keyboard handling, label/status rendering. |
| Connection-status composable | Per-channel transition normalization and notification de-duplication. |
| `EmotePicker` | Categorized, virtualized rendering and search. |
| `useEmoteCatalog` | Session cache, source grouping, native fetches, and 7TV event updates. |
| Native platform/emote services | Resolve platform catalog entries and forward 7TV mutations. |
| Moderation outcome store | Convert a deletion into a context-preserving tombstone. |
| `UserCardDialog` | Capability-gated moderation and external channel actions. |

The frontend continues to communicate with native services through the current
Wails bridge. No Bun, filesystem, or provider client is imported into Vue
components.

## 5. Error handling

- A failed catalog load leaves previously cached session data visible when it
  exists and shows a retryable picker error otherwise.
- A malformed or stale 7TV mutation is ignored after logging; it cannot erase
  another channel's catalog.
- Connection error text is safe for display and a later connected transition
  replaces the error indicator.
- A deletion event without a matching rendered message is retained by the
  moderation-outcome store for five minutes, so it can apply if that message
  arrives late; it cannot target an unrelated user.
- URL construction only opens known HTTPS Twitch, Kick, or YouTube channel
  destinations.

## 6. Verification and acceptance criteria

Add focused tests for:

- bottom detection, late virtual-row measurement, and latest-button visibility;
- textarea growth, reset after send, Enter/Shift+Enter, and narrow composer
  alignment;
- persisted channel-label and session-cache settings;
- category order, group search, disabled cache reloads, and live 7TV cache
  updates;
- temporary 7TV and connection-state notifications with de-duplication;
- deleted-message tombstone metadata, capability-gated moderation, retry after
  failure, and platform channel URLs; and
- native minimum-window configuration and platform catalog/event contracts.

Acceptance requires the relevant frontend and native test suites to pass,
followed by the project's formatter, linter, and desktop typecheck. Manual
validation covers a narrow window, multi-line composer input, an emote-driven
row resize, offline/reconnect transitions, a live 7TV mutation, and a deleted
AutoMod message.

## Non-goals

- No disk-backed emote catalog or image cache.
- No persistent chat-history rows for connection or 7TV catalog events.
- No per-channel variations of the appearance settings in this release.
- No moderation action without a channel-specific capability check.
