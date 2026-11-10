import type { UserProfileRequest, UserProfileSnapshot } from '@twirchat/shared/user-profile'
import { z } from 'zod'

import { fetchTwitchHelixWithAppToken } from './stream-status'

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
  async function json(url: string, missingAllowed = false): Promise<unknown> {
    const init: RequestInit = { signal: AbortSignal.timeout(12000) }
    const response = await (url.startsWith('https://api.twitch.tv/')
      ? deps.helix(url, init)
      : deps.fetch(url, init))
    if (response.status === 404 && missingAllowed) return null
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`)
    return response.json()
  }
  return async function getProfile(input: UserProfileRequest): Promise<UserProfileSnapshot> {
    if (input.platform !== 'twitch') throw new Error('Extended profiles currently require Twitch.')
    if (!/^\d+$/.test(input.platformUserId))
      throw new Error('A numeric Twitch user ID is required.')
    const id = input.platformUserId
    const result: UserProfileSnapshot = {
      id,
      errors: [{ section: 'followers', message: 'Connect Twitch to read follower count.' }],
    }
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
        result.roles = { broadcaster: id === broadcaster }
        result.errors.push({
          section: 'roles',
          message: 'Moderator, VIP and editor roles require the channel owner account.',
        })
      }),
    ])
    return result
  }
}
