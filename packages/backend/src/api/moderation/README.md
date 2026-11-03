# Moderation API Client

Unified TypeScript client for implementing chat moderation actions across Twitch and Kick platforms.

## Features

- **Ban/Timeout**: Permanent bans or temporary timeouts
- **Message Deletion**: Remove individual chat messages
- **Moderator Checks**: Verify moderator status (Twitch only)
- **Error Handling**: Detailed error codes and messages
- **Logging**: Built-in debug and error logging

## Installation

Already included in `@twirchat/backend`. Import from `src/api/moderation`:

```typescript
import * as Kick from './src/api/moderation/kick.ts'
import * as Twitch from './src/api/moderation/twitch.ts'
import { ModerationException } from './src/api/moderation/types.ts'
```

## Usage

### Twitch Ban/Timeout

```typescript
// Ban permanently
const result = await Twitch.banUser(broadcasterToken, broadcasterUserId, moderatorUserId, {
  user_id: '123456',
  reason: 'Spam',
  duration: null, // null = permanent ban
})

// Timeout for 10 minutes (600 seconds)
const result = await Twitch.banUser(broadcasterToken, broadcasterUserId, moderatorUserId, {
  user_id: '123456',
  reason: 'Warning',
  duration: 600, // in seconds (1-604800)
})

// Check result
if (result.success) {
  console.log(`Banned user ${result.userId}`)
} else {
  console.error(`Ban failed: ${result.error?.code} - ${result.error?.message}`)
}
```

### Twitch Delete Message

```typescript
const result = await Twitch.deleteMessage(
  broadcasterToken,
  broadcasterUserId,
  moderatorUserId,
  'message-id-12345',
)

if (!result.success) {
  console.error(`Delete failed: ${result.error?.code}`)
}
```

### Twitch Moderator Check

```typescript
const result = await Twitch.isModerator(broadcasterToken, broadcasterUserId, userIdToCheck)

if (result.isModerator) {
  console.log('User is a moderator')
} else if (result.error) {
  console.error(`Check failed: ${result.error.code}`)
}
```

### Kick Ban/Timeout

```typescript
// Ban permanently
const result = await Kick.banUser(kickToken, channelId, {
  banned_user_id: 999,
  reason: 'Harassment',
  // No duration = permanent
})

// Timeout for 5 minutes
const result = await Kick.banUser(kickToken, channelId, {
  banned_user_id: 999,
  duration_minutes: 5, // in minutes
  reason: 'Warning',
})
```

### Kick Delete Message

```typescript
const result = await Kick.deleteMessage(kickToken, channelId, 'message-id')
```

### Kick Unban User

```typescript
const result = await Kick.unbanUser(
  kickToken,
  channelId,
  999, // user ID to unban
)
```

## Error Handling

All functions return result objects with `success` flag and optional `error`:

```typescript
interface BanResult {
  success: boolean
  platform: 'twitch' | 'kick'
  userId: string
  isPermanent: boolean
  durationSeconds?: number
  error?: ModerationError
}

interface ModerationError {
  code: string // Platform-specific: TWITCH_* or KICK_*
  status: number // HTTP status code
  message: string
  details?: Record<string, unknown>
}
```

### Error Codes

**Twitch Error Codes:**

- `TWITCH_BAD_REQUEST` - 400: Invalid request
- `TWITCH_UNAUTHORIZED` - 401: Invalid token
- `TWITCH_NOT_MODERATOR` - 403: User is not a moderator
- `TWITCH_INSUFFICIENT_PERMISSIONS` - 403: Missing scopes
- `TWITCH_NOT_FOUND` - 404: Message/user not found
- `TWITCH_CONFLICT` - 409: User already banned (when trying to timeout)
- `TWITCH_UNPROCESSABLE` - 422: Invalid parameters
- `TWITCH_RATE_LIMITED` - 429: Rate limit exceeded
- `TWITCH_SERVER_ERROR` - 500: Twitch server error

**Kick Error Codes:**

- `KICK_BAD_REQUEST` - 400: Invalid request
- `KICK_UNAUTHORIZED` - 401: Invalid token
- `KICK_FORBIDDEN` - 403: No permission
- `KICK_NOT_FOUND` - 404: Resource not found
- `KICK_CONFLICT` - 409: Conflict
- `KICK_UNPROCESSABLE` - 422: Invalid parameters
- `KICK_RATE_LIMITED` - 429: Rate limit exceeded
- `KICK_SERVER_ERROR` - 500: Kick server error

## Special Cases

### Ban vs Timeout

**Twitch**: Uses `duration` field:

- `null` or `undefined` = permanent ban
- `1-604800` (seconds) = timeout

**Kick**: Uses `duration_minutes` field:

- Omitted or `null` = permanent ban
- `number` = timeout in minutes

### Moderator Status

**Twitch**: Use `Twitch.isModerator()` to check if user is a moderator:

```typescript
const result = await Twitch.isModerator(token, broadcasterUserId, userId)
// result.isModerator: boolean
```

**Kick**: No official moderator check endpoint. Workarounds:

1. Cache moderator list from chat join (badge data)
2. Attempt ban and check for "is moderator" error message

### Permission Checks

**Important**: Before attempting to ban/timeout, verify:

1. **Token has correct scope**:
   - Twitch: `moderator:manage:banned_users`
   - Kick: `moderation:ban`
2. **User is a moderator** in the channel
3. **Target is not broadcaster**: Cannot ban channel owner
4. **Target is not a Twitch staff member**: Cannot ban staff accounts

All of these will result in 403 Forbidden error.

## Token Scope Requirements

### Twitch

For ban/timeout operations, token needs `moderator:manage:banned_users` scope:

```typescript
const TWITCH_SCOPES = [
  'chat:read',
  'chat:edit',
  'channel:read:subscriptions',
  'channel:read:redemptions',
  'moderator:read:followers',
  'moderator:manage:banned_users', // ← Required for ban/timeout
  'bits:read',
  'channel:manage:broadcast',
]
```

### Kick

For ban operations, token needs `moderation:ban` scope:

```typescript
const KICK_SCOPES = [
  'user:read',
  'channel:read',
  'chat:write',
  'events:subscribe',
  'moderation:ban', // ← Required for ban/timeout
]
```

## Rate Limiting

### Twitch

- General Helix rate limit: ~60-120 requests per minute depending on token type
- Moderation endpoints follow standard rate limits
- No specific moderation endpoint rate limit documented

Recommended: Exponential backoff + 429 handling

### Kick

- Rate limits not documented
- Recommended: Exponential backoff (start 1s, max 60s) + 429 handling

## Implementation Notes

### Token Refresh

Tokens expire periodically. Handle refresh transparently:

```typescript
try {
  result = await Twitch.banUser(token, ...)
} catch (error) {
  if (error.status === 401) {
    // Token expired, refresh it
    const newToken = await refreshToken(oldToken)
    result = await Twitch.banUser(newToken, ...)
  }
}
```

### Duplicate Prevention

**Twitch Timeout on Already-Banned User**: Returns 409 Conflict

```typescript
const result = await Twitch.banUser(token, broadcaster, mod, {
  user_id: '123',
  duration: 300, // timeout
})

if (!result.success && result.error?.code === 'TWITCH_CONFLICT') {
  // User already permanently banned
  console.log('User already banned')
}
```

### Logging

All operations log debug/info/warn messages:

```
[DEBUG] twitch-moderation: Banning user broadcasterUserId=123 userId=456 isPermanent=false duration=600
[INFO]  twitch-moderation: User banned userId=456 isPermanent=false duration=600
```

## Testing

Run tests with:

```bash
cd packages/backend
bun test tests/moderation.test.ts
```

Tests cover:

- Successful ban/timeout operations
- Error handling (403, 409, etc.)
- Message deletion
- Moderator status checks
- Platform-specific behavior

## Known Issues

### Kick API Gaps

1. **No Moderator Check Endpoint**: GitHub issue KickEngineering/KickDevDocs#339
   - Workaround: Check badge data or attempt ban and catch error

2. **DELETE Message Semantics Unclear**: GitHub issue #338
   - Current implementation tries DELETE without body first, then with body if needed

3. **Bot Account Ban Behavior Inconsistent**: GitHub issue #217
   - Banning bot accounts may behave differently via API vs web UI

4. **Unban Endpoint Not Documented**: GitHub issue #345
   - Implementation inferred from patterns; test thoroughly before production

### Twitch API Limitations

1. **Cannot ban staff accounts**: Will return 403 Forbidden
2. **Cannot ban broadcaster**: Will return 403 Forbidden
3. **Cannot ban moderators**: Will return 403 Forbidden (unless you're checking pre-ban)

## Future Improvements

1. **Caching layer**: 5-15 min cache for moderator lists
2. **Batch operations**: Ban multiple users in single request (if platform supports)
3. **Unban wrapper**: Unified unban interface for both platforms
4. **Rate limit handling**: Automatic exponential backoff + queue

## References

- [Twitch Helix Moderation API](https://dev.twitch.tv/docs/api/reference#ban-user)
- [Twitch Delete Chat Messages](https://dev.twitch.tv/docs/api/reference#delete-chat-messages)
- [Twitch Get Moderators](https://dev.twitch.tv/docs/api/reference#get-moderators)
- [Kick Moderation Guide](https://help.kick.com/en/articles/10162074-moderation-features-guide)
- [Kick Dev Docs GitHub Issues](https://github.com/KickEngineering/KickDevDocs/issues)
