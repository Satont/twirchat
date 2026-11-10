import type { UserProfileRequest, UserProfileSnapshot } from '@twirchat/shared/user-profile'
import { z } from 'zod'

import { createTwitchUserHelix } from '../auth/twitch-user-token'
import { resolveTwitchChannel } from './native-emotes'

const roleSchema = z.object({ data: z.array(z.unknown()) })
const editorSchema = z.object({ data: z.array(z.object({ user_id: z.string() })) })
const followerSchema = z.object({ total: z.number() })

export async function enrichTwitchUserProfile(
  request: UserProfileRequest,
  publicProfile: UserProfileSnapshot,
  accessToken: string,
): Promise<UserProfileSnapshot> {
  const profile: UserProfileSnapshot = {
    ...publicProfile,
    errors: publicProfile.errors.filter((error) => !['followers', 'roles'].includes(error.section)),
  }
  const id = request.platformUserId
  const auth = await createTwitchUserHelix(accessToken)
  async function json<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await auth.fetch(path)
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`)
    return schema.parse(await response.json())
  }
  async function section(name: string, run: () => Promise<void>) {
    try {
      await run()
    } catch (error) {
      profile.errors.push({
        section: name,
        message: error instanceof Error ? error.message : 'Source unavailable.',
      })
    }
  }

  await Promise.all([
    section('followers', async () => {
      const query = new URLSearchParams({ broadcaster_id: id, first: '1' })
      const response = await json(`channels/followers?${query}`, followerSchema)
      profile.followers = response.total
    }),
    section('roles', async () => {
      if (!request.channelSlug) return
      const { platformUserId: broadcaster } = await resolveTwitchChannel(request.channelSlug)
      const roles: NonNullable<UserProfileSnapshot['roles']> = { broadcaster: id === broadcaster }
      profile.roles = roles
      if (auth.userId !== broadcaster)
        throw new Error('Moderator, VIP and editor roles require the channel owner account.')
      const query = new URLSearchParams({ broadcaster_id: broadcaster, user_id: id })
      await Promise.all([
        section('moderatorRole', async () => {
          if (
            !auth.scopes.some((scope) =>
              ['moderation:read', 'channel:manage:moderators'].includes(scope),
            )
          )
            throw new Error('Reconnect Twitch with moderation:read.')
          const response = await json(`moderation/moderators?${query}`, roleSchema)
          roles.moderator = response.data.length > 0
        }),
        section('vipRole', async () => {
          if (
            !auth.scopes.some((scope) =>
              ['channel:read:vips', 'channel:manage:vips'].includes(scope),
            )
          )
            throw new Error('Reconnect Twitch with channel:read:vips.')
          const response = await json(`channels/vips?${query}`, roleSchema)
          roles.vip = response.data.length > 0
        }),
        section('editorRole', async () => {
          if (!auth.scopes.includes('channel:read:editors'))
            throw new Error('Reconnect Twitch with channel:read:editors.')
          const response = await json(
            `channels/editors?broadcaster_id=${encodeURIComponent(broadcaster)}`,
            editorSchema,
          )
          roles.editor = response.data.some((editor) => editor.user_id === id)
        }),
      ])
    }),
  ])
  return profile
}
