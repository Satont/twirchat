import type { UserChatHistoryProps } from './types'
import { UserChatHistoryContent } from './UserChatHistoryContent'

/** Remounts on a different user so history state never leaks between cards. */
export function UserChatHistoryPanel({
  platform,
  platformUserId,
  channelId,
  username,
  onViewport,
}: UserChatHistoryProps) {
  return (
    <UserChatHistoryContent
      key={`${platform}:${platformUserId}:${channelId ?? ''}:${username ?? ''}`}
      platform={platform}
      platformUserId={platformUserId}
      channelId={channelId}
      username={username}
      onViewport={onViewport}
    />
  )
}
