# Platform-specific chat replies

## Goal

Replies in the desktop home chat must stay on the platform of the message being replied to. A reply
to a Kick message must only be sent to Kick; a reply to a Twitch message must only be sent to
Twitch. Standard messages without a reply target retain the existing multi-platform delivery.

## Current cause

`ChatInput.vue` builds a send target for every enabled authenticated platform and assigns the same
`replyToMessageId` to each target. In a combined chat, a Kick message ID is therefore also passed
to Twitch, which rejects it as an unknown reply parent.

## Design

The home-chat composer will derive its targets from the reply state:

- Without a reply target, retain the existing set of enabled authenticated platform targets.
- With a reply target, retain only the enabled target whose platform equals
  `replyTarget.platform`.
- Attach `replyToMessageId` only to that platform-specific target.
- Watched-channel sending remains unchanged because it is already scoped to one channel and
  platform.

The existing RPC and adapter interfaces already receive one platform and one optional reply ID per
send operation, so no protocol change is required.

## Error handling

If the replied-to platform has no enabled authenticated target, the composer produces no targets
and does not send the message. This follows the current behavior for an empty target set and
avoids silently posting a non-reply on another platform.

## Tests

Extract the home-chat target selection into the existing chat send-target utility and add unit
tests proving that:

1. a normal message targets all enabled authenticated platforms;
2. a Kick reply targets only Kick and carries its reply ID; and
3. a Twitch reply targets only Twitch and carries its reply ID.

The test guards both the API-level reply ID isolation and the user-visible single-platform
delivery rule.
