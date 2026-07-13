# Moderation Outcome Rendering Design

## Goal

Make every successful moderation action visible inline in the chat. Apply the
same presentation when the active Twitch IRC or Kick Pusher transport reports
an action performed outside TwirChat.

## Behaviour

- A deleted message is faded and ends with `(message deleted)`.
- A timeout fades every visible message from the target user in that channel and
  shows `(timed out for <duration>)`.
- A permanent ban does the same and shows `(banned)`.
- A confirmed local request applies the state immediately. A later transport
  event merges idempotently with that state.
- A marked message no longer exposes the moderation rail.

## Transport

`ModerationOutcome` is a native-to-Vue Wails event, not a persisted chat
message. It contains platform, channel, action, target user, optional message
ID, and optional timeout duration.

- Twitch maps `CLEARMSG` to one deleted message and `CLEARCHAT` to a timeout or
  ban. The existing Go IRC client exposes the necessary target IDs and timeout
  seconds.
- Kick maps best-effort Pusher events on the already subscribed
  `chatrooms.{id}.v2` channel: `App\\Events\\MessageDeletedEvent` and
  `App\\Events\\UserBannedEvent`. Unknown or malformed frames do nothing.
  This is intentionally not EventSub and does not rely on undocumented event
  delivery for correctness of local actions.

## Vue state

A session-only moderation-outcome store indexes exact message deletions and
user/channel sanctions. `ChatList` marks successful local requests; `App.vue`
marks transport events. `ChatMessage` receives the resolved visual outcome,
fades the row, renders the label in both themes, and hides the rail.

No history migration is required. The marker is deliberately not persisted:
the feature describes live moderation feedback, while upstream transports are
the source of truth for events received during this app session.

## Validation

Tests cover Pusher parsing for deletion, timeout and ban; malformed Pusher
frames; Twitch transport conversion; outcome state resolution; local request
application; both message themes; and hiding the rail on marked rows.

The user requested work in the current branch with no commit, so this design
document remains uncommitted.
