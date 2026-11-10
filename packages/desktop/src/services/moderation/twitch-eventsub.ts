const channelModerationScopeGroups = [
  ['moderator:read:blocked_terms', 'moderator:manage:blocked_terms'],
  ['moderator:read:chat_settings', 'moderator:manage:chat_settings'],
  ['moderator:read:unban_requests', 'moderator:manage:unban_requests'],
  ['moderator:read:banned_users', 'moderator:manage:banned_users'],
  ['moderator:read:chat_messages', 'moderator:manage:chat_messages'],
  ['moderator:read:warnings', 'moderator:manage:warnings'],
  ['moderator:read:moderators'],
  ['moderator:read:vips'],
]

export function hasChannelModerationScopes(scopes: readonly string[]): boolean {
  return channelModerationScopeGroups.every((group) =>
    group.some((scope) => scopes.includes(scope)),
  )
}
