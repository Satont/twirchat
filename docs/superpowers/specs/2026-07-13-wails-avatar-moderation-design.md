# Wails: avatars and message moderation

## Purpose

Restore two desktop-chat capabilities while completing the move from the Rust
client to the Wails application:

1. Twitch and Kick author avatars that never delay message rendering.
2. A drag-based per-message moderation control for Twitch and Kick.

The changes are limited to `packages/desktop`. They do not change the
legacy Rust desktop package and will not be committed as part of this task.

## Avatar delivery

Every message row renders an immediate visual fallback: the author's initial
on a colour derived from the existing author colour (or the default fallback
colour). The fallback is used while an avatar URL is unavailable, loading, or
failed.

`ChatMessage` will use a shared reactive avatar cache instead of treating the
message payload's `author.avatarUrl` as the only source. When a Twitch or Kick
message has no usable URL, a background request is started once per
`platform + author id`. The row remains responsive; no rendering path awaits
the request. When the cache resolves the URL, all mounted rows for that author
reactively replace their fallback image.

The Go platform services own a bounded in-memory resolver cache with
in-flight request deduplication and separate short negative-cache entries.
Twitch resolves through the existing backend user endpoint. Kick first uses
the `profile_picture` included in the event, and only resolves missing values
through the existing backend channel/user lookup. This cache is reused by
later messages in the running desktop session.

Avatar display is added to both `modern` and `compact` message layouts. The
existing persisted `showAvatars` preference remains the sole display toggle:
turning it off hides both network images and fallbacks, without clearing the
resolver cache.

## Moderation interaction

Each eligible Twitch or Kick message receives a compact draggable rail along
its left edge. Pulling it horizontally previews the action and executes only
when released:

| Drag extent          | Action                     |
| -------------------- | -------------------------- |
| Short                | Delete the message         |
| Increasing distances | Escalating timeout presets |
| Furthest extent      | Permanent ban              |

The preview is colour-coded and labelled. Releasing before the activation
threshold cancels without contacting a platform. This interaction is present
in both compact and modern layouts without blocking normal scrolling or hover
actions.

On the combined **My Channels** (home) view, the rail is shown for all Twitch
and Kick messages. On watched-channel tabs, it is shown only when the local
account for the platform holds the appropriate moderation capability. The
server still validates credentials and scopes before every action; a missing
or stale scope produces a visible failure toast instead of a silent no-op.

## Moderation service boundary

The Vue frontend sends one typed Wails request containing platform, channel,
target user, message id, moderation action, and optional duration. A Go
moderation service performs the provider request off the UI path and returns a
success or an actionable error for a frontend toast.

Twitch delete-message requests and Twitch timeout/ban requests use their
correct distinct APIs and scopes. Kick deletion and ban/timeout are likewise
kept distinct where the provider supports them. Unsupported action/platform
combinations are rejected before a network request. This avoids treating a
delete gesture as a permanent ban.

## Testing and verification

Tests will be introduced before production changes for:

- cache keying, in-flight deduplication, negative cache behaviour, and
  immediate fallback selection;
- Twitch and Kick message normalisation with avatar fallback/resolution;
- compact and modern chat source contracts for avatar display and the
  persisted visibility toggle;
- moderation eligibility for home versus watched tabs;
- drag distance-to-action mapping and cancellation;
- provider request construction and error propagation for delete, timeout,
  and ban.

Verification will run the focused Bun and Go tests first, then format the
changed TypeScript/Go code and run the package typecheck, relevant Go tests,
and the project-required lint/format checks where available.
