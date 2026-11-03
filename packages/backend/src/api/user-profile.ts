import type { UserProfileRequest, UserProfileSnapshot } from '@twirchat/shared/user-profile'
import { z } from 'zod'

import { config } from '../config'
import { fetchTwitchHelixWithAppToken } from './stream-status'

interface ProfileAuth {
  accessToken: string
  platformUserId: string
  scopes: string[]
}
export interface UserProfileBackendRequest extends UserProfileRequest {
  twitchAuth?: ProfileAuth
}
export interface UserProfileDependencies {
  fetch(url: string, init?: RequestInit): Promise<Response>
  helix(url: string, init?: RequestInit): Promise<Response>
}

export function createUserProfileService(
  deps: UserProfileDependencies = {
    fetch: (...args) => fetch(...args),
    helix: fetchTwitchHelixWithAppToken,
  },
) {
  async function json(url: string, auth?: ProfileAuth, missingAllowed = false): Promise<unknown> {
    const init: RequestInit = { signal: AbortSignal.timeout(12000) }
    if (auth)
      init.headers = {
        Authorization: `Bearer ${auth.accessToken}`,
        'Client-Id': config.TWITCH_CLIENT_ID,
      }
    const response = await (url.startsWith('https://api.twitch.tv/') && !auth
      ? deps.helix(url, init)
      : deps.fetch(url, init))
    if (response.status === 404 && missingAllowed) return null
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`)
    return response.json()
  }
  return async function getProfile(input: UserProfileBackendRequest): Promise<UserProfileSnapshot> {
    if (input.platform !== 'twitch') throw new Error('Extended profiles currently require Twitch.')
    if (!/^\d+$/.test(input.platformUserId))
      throw new Error('A numeric Twitch user ID is required.')
    const id = input.platformUserId
    const result: UserProfileSnapshot = { id, errors: [] }
    const base = 'https://api.twitch.tv/helix/'
    async function section(name: string, run: () => Promise<void>) {
      try {
        await run()
      } catch (error) {
        result.errors.push({
          section: name,
          message: error instanceof Error ? error.message : 'Source unavailable.',
        })
      }
    }
    const userResponse = z
      .object({
        data: z.array(
          z.object({
            id: z.string(),
            login: z.string(),
            display_name: z.string(),
            profile_image_url: z.string(),
            description: z.string(),
            broadcaster_type: z.string(),
          }),
        ),
      })
      .parse(await json(`${base}users?id=${id}`))
    const user = userResponse.data?.[0]
    if (!user) throw new Error('Twitch user was not found.')
    Object.assign(result, {
      login: user.login,
      displayName: user.display_name,
      avatarUrl: user.profile_image_url,
      description: user.description,
      broadcasterType: user.broadcaster_type,
    })
    await Promise.all([
      section('live', async () => {
        const response = z
          .object({
            data: z.array(
              z.object({
                title: z.string(),
                game_name: z.string(),
                viewer_count: z.number(),
                started_at: z.string(),
              }),
            ),
          })
          .parse(await json(`${base}streams?user_id=${id}`))
        const stream = response.data?.[0]
        if (stream)
          result.live = {
            title: stream.title,
            category: stream.game_name,
            viewers: stream.viewer_count,
            startedAt: stream.started_at,
          }
      }),
      section('lastLive', async () => {
        const response = z
          .object({ data: z.array(z.object({ created_at: z.string() })) })
          .parse(await json(`${base}videos?user_id=${id}&type=archive&first=1`))
        result.lastLive = response.data?.[0]?.created_at
      }),
      section('followers', async () => {
        if (!input.twitchAuth) throw new Error('Connect Twitch to read follower count.')
        const response = z
          .object({ total: z.number() })
          .parse(
            await json(`${base}channels/followers?broadcaster_id=${id}&first=1`, input.twitchAuth),
          )
        if (typeof response.total === 'number') result.followers = response.total
      }),
      section('color', async () => {
        const response = z
          .object({ data: z.array(z.object({ color: z.string() })) })
          .parse(await json(`${base}chat/color?user_id=${id}`))
        result.color = response.data?.[0]?.color
      }),
      section('pronouns', async () => {
        const profile = z
          .object({ pronoun_id: z.string().optional(), alt_pronoun_id: z.string().optional() })
          .nullable()
          .parse(
            await json(
              `https://api.pronouns.alejo.io/v1/users/${encodeURIComponent(user.login)}`,
              undefined,
              true,
            ),
          )
        if (!profile?.pronoun_id) return
        const definitions = z
          .record(z.string(), z.object({ subject: z.string(), object: z.string() }))
          .parse(await json('https://api.pronouns.alejo.io/v1/pronouns'))
        result.pronouns = [profile.pronoun_id, profile.alt_pronoun_id]
          .filter((key): key is string => !!key)
          .map((key) => {
            const definition = definitions[key]
            return definition ? `${definition.subject}/${definition.object}` : key
          })
          .join(' / ')
      }),
      section('nameHistory', async () => {
        const history = await json(`https://logs.zonian.dev/namehistory/${id}`)
        if (!Array.isArray(history)) throw new Error('Name history returned an invalid response.')
        result.nameHistory = history
          .filter((entry) => typeof entry?.user_login === 'string')
          .slice(-50)
          .reverse()
          .map(
            (entry: { user_login: string; first_timestamp?: string; last_timestamp?: string }) => ({
              login: entry.user_login,
              firstSeen: entry.first_timestamp,
              lastSeen: entry.last_timestamp,
            }),
          )
      }),
      section('roles', async () => {
        if (!input.channelSlug) return
        const channel = z
          .object({ data: z.array(z.object({ id: z.string() })) })
          .parse(
            await json(
              `${base}users?${/^\d+$/.test(input.channelSlug) ? 'id' : 'login'}=${encodeURIComponent(input.channelSlug.replace(/^#/, ''))}`,
            ),
          )
        const broadcaster = channel.data?.[0]?.id
        if (!broadcaster) throw new Error('Channel not found.')
        const roles: NonNullable<UserProfileSnapshot['roles']> = { broadcaster: id === broadcaster }
        result.roles = roles
        const auth = input.twitchAuth
        if (!auth || auth.platformUserId !== broadcaster)
          throw new Error('Moderator, VIP and editor roles require the channel owner account.')
        await Promise.all([
          section('moderatorRole', async () => {
            if (
              !auth.scopes.some((scope) =>
                ['moderation:read', 'channel:manage:moderators'].includes(scope),
              )
            )
              throw new Error('Reconnect Twitch with moderation:read.')
            const response = z
              .object({ data: z.array(z.unknown()) })
              .parse(
                await json(
                  `${base}moderation/moderators?broadcaster_id=${broadcaster}&user_id=${id}`,
                  auth,
                ),
              )
            roles.moderator = response.data.length > 0
          }),
          section('vipRole', async () => {
            if (
              !auth.scopes.some((scope) =>
                ['channel:read:vips', 'channel:manage:vips'].includes(scope),
              )
            )
              throw new Error('Reconnect Twitch with channel:read:vips.')
            const response = z
              .object({ data: z.array(z.unknown()) })
              .parse(
                await json(
                  `${base}channels/vips?broadcaster_id=${broadcaster}&user_id=${id}`,
                  auth,
                ),
              )
            roles.vip = response.data.length > 0
          }),
          section('editorRole', async () => {
            if (!auth.scopes.includes('channel:read:editors'))
              throw new Error('Reconnect Twitch with channel:read:editors.')
            const response = z
              .object({ data: z.array(z.object({ user_id: z.string() })) })
              .parse(await json(`${base}channels/editors?broadcaster_id=${broadcaster}`, auth))
            roles.editor = response.data.some((editor) => editor.user_id === id)
          }),
        ])
      }),
    ])
    return result
  }
}
