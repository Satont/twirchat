# Chat Moderation Plan — Decisions

## Architecture Decisions (from plan)
- `getModerationRole` is LOCAL ONLY — derives from `AccountStore.findByPlatform()`, no network calls
- Moderation methods are OPTIONAL on `BasePlatformAdapter` (not abstract) — YouTube adapter untouched
- `moderateMessage` uses discriminated union: `ban | timeout | delete` (NOT separate RPCs)
- Timeout duration: always in SECONDS in RPC; Kick adapter converts to minutes internally (÷60)
- `broadcaster_id` (numeric) must be fetched and cached in `TwitchAdapter.connect()` from `/helix/users?login=`
- No moderation on `platform === 'youtube'` or `type === 'system'` messages
- No confirmation dialog before ban
- `moderationRoleCache` module-level Map in `ChatMessage.vue` to avoid repeated RPC calls
