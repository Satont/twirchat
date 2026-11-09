import {
  createTwitchEmoteCatalog,
  EmoteCatalogError,
  parseTwitchEmoteResponse,
} from '@twirchat/shared/twitch-emote-catalog'
import { z } from 'zod'

import { fetchTwitchHelixWithAppToken } from './stream-status'

export function createEmoteCatalogService(
  appFetch: (url: string) => Promise<Response> = fetchTwitchHelixWithAppToken,
) {
  const getCatalog = createTwitchEmoteCatalog()
  const getTwitchEmotes = (input: { channelSlug: string; force?: boolean }) =>
    getCatalog({
      channelSlug: input.channelSlug,
      force: input.force,
      source: { kind: 'app', fetch: (path) => appFetch(`https://api.twitch.tv/helix/${path}`) },
    })
  const channelIdentities = new Map<
    string,
    { value: { platformUserId: string; login: string }; expires: number }
  >()
  const identityPending = new Map<string, Promise<{ platformUserId: string; login: string }>>()
  const resolveChannel = (channel: string): Promise<{ platformUserId: string; login: string }> => {
    const slug = channel.trim().replace(/^#/, '').toLowerCase()
    if (!/^[a-z0-9_]{1,25}$/.test(slug))
      return Promise.reject(new EmoteCatalogError('Invalid Twitch channel.'))
    const cached = channelIdentities.get(slug)
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value)
    const inflight = identityPending.get(slug)
    if (inflight) return inflight
    if (identityPending.size >= 100)
      return Promise.reject(new EmoteCatalogError('Too many pending Twitch channel lookups.', 429))
    const task = (async () => {
      const body = await parseTwitchEmoteResponse(
        await appFetch(
          `https://api.twitch.tv/helix/users?${/^\d+$/.test(slug) ? 'id' : 'login'}=${encodeURIComponent(slug)}`,
        ),
      )
      const user = z
        .object({ data: z.array(z.object({ id: z.string(), login: z.string() })) })
        .parse(body).data[0]
      const value = { platformUserId: user?.id ?? '', login: user?.login ?? '' }
      if (!value.platformUserId || !value.login)
        throw new EmoteCatalogError('Twitch channel not found.', 404)
      const entry = { value, expires: Date.now() + 3600000 }
      channelIdentities.set(slug, entry)
      channelIdentities.set(value.platformUserId, entry)
      channelIdentities.set(value.login, entry)
      while (channelIdentities.size > 500) {
        const oldest = channelIdentities.keys().next()
        if (oldest.done) break
        channelIdentities.delete(oldest.value)
      }
      return value
    })().finally(() => identityPending.delete(slug))
    identityPending.set(slug, task)
    return task
  }
  return { getTwitchEmotes, resolveTwitchChannel: resolveChannel }
}
