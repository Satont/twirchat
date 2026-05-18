# Chat Moderation Plan — Issues / Gotchas

## Known Gotchas (pre-research from plan)
- Twitch `broadcaster_id` is NUMERIC but `channelId` is a login string → must fetch from `/helix/users?login=`
- Kick timeout uses MINUTES, not seconds — convert: `Math.round(durationSeconds / 60)`
- OAuth scopes are in `packages/backend/src/auth/` NOT `packages/desktop/src/auth/`
- `BasePlatformAdapter` moderation methods MUST be optional (`?`) — not abstract
- `refreshTokenIfNeeded()` must be called before EVERY moderation API request
- Do NOT use Twurple IRC commands — use Helix REST API with `fetch()` directly
- Kick delete uses `DELETE /public/v1/chat/{message_id}` — returns 204 No Content
