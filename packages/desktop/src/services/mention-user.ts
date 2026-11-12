import type { Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { backendFetch } from '../runtime-config'
import type { UserCardTarget } from '../views/main/utils/chatCommands'

export type MentionUser = Pick<
  UserCardTarget,
  'platformUserId' | 'displayName' | 'username' | 'avatarUrl' | 'color' | 'badges'
>

export interface MentionUserRequest {
  platform: Platform
  username: string
}

export async function resolveMentionUser(
  { platform, username }: MentionUserRequest,
  request: (path: string) => Promise<Response> = backendFetch,
): Promise<MentionUser | null> {
  const path =
    platform === 'youtube'
      ? `/api/youtube/resolve?handle=${encodeURIComponent(username)}`
      : platform === 'twitch'
        ? `/api/twitch/user?login=${encodeURIComponent(username)}`
        : `/api/kick/chatroom?slug=${encodeURIComponent(username)}`
  const response = await request(path)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Could not look up @${username} (${response.status}).`)
  if (platform === 'youtube') {
    const { channelId } = z
      .object({
        channelId: z
          .string()
          .regex(/^UC[A-Za-z0-9_-]{22}$/)
          .nullable(),
      })
      .parse(await response.json())
    return channelId
      ? {
          platformUserId: channelId,
          username: `@${username}`,
          displayName: username,
        }
      : null
  }
  if (platform === 'twitch') {
    const { user } = z
      .object({
        user: z
          .object({
            id: z.string().regex(/^\d+$/),
            login: z.string().min(1),
            display_name: z.string().optional(),
            profile_image_url: z.string().optional(),
          })
          .nullable(),
      })
      .parse(await response.json())
    return user
      ? {
          platformUserId: user.id,
          username: user.login,
          displayName: user.display_name || user.login,
          avatarUrl: user.profile_image_url,
        }
      : null
  }
  const user = z
    .object({
      broadcasterUserId: z.number().int().positive(),
      avatarUrl: z.string().optional(),
    })
    .parse(await response.json())
  return {
    platformUserId: String(user.broadcasterUserId),
    username,
    displayName: username,
    avatarUrl: user.avatarUrl,
  }
}
