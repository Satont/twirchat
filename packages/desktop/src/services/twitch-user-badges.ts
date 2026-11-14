import type { Badge } from '@twirchat/shared/types'
import { z } from 'zod'

// Twitch's persisted web operation, also used by Vanity Tester (src/providers/Twitch.js).
const VIEWER_CARD_HASH = '80c53fe04c79a6414484104ea573c28d6a8436e031a235fc6908de63f51c74fd'
const twitchLogin = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{1,25}$/)

const earnedBadgeSchema = z.object({
  setID: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullish(),
  image2x: z.url({ protocol: /^https$/ }),
})

// Unrelated ViewerCard fields can report GraphQL errors for anonymous requests.
const viewerCardSchema = z.tuple([
  z.object({
    data: z.object({ channelViewer: z.object({ earnedBadges: z.array(earnedBadgeSchema) }) }),
  }),
])

export interface TwitchUserBadgesRequest {
  username: string
  channelSlug?: string
  channelId?: string
  signal: AbortSignal
}

function channelLogin(value?: string): string | undefined {
  const login = twitchLogin.safeParse(value).data
  return login && !/^\d+$/.test(login) ? login : undefined
}

export async function getTwitchUserBadges(
  { username, channelSlug, channelId, signal }: TwitchUserBadgesRequest,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<Badge[]> {
  const user = twitchLogin.parse(username)
  const channel = channelLogin(channelSlug) ?? channelLogin(channelId) ?? user
  const response = await request('https://gql.twitch.tv/gql', {
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        operationName: 'ViewerCard',
        variables: {
          channelLogin: channel,
          hasChannelID: false,
          giftRecipientLogin: user,
          isViewerBadgeCollectionEnabled: true,
          withStandardGifting: true,
          badgeSourceChannelLogin: channel,
        },
        extensions: { persistedQuery: { version: 1, sha256Hash: VIEWER_CARD_HASH } },
      },
    ]),
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  })
  if (!response.ok) throw new Error(`Twitch ViewerCard: HTTP ${response.status}`)

  const [{ data }] = viewerCardSchema.parse(await response.json())
  const badges = new Map<string, Badge>()
  for (const { setID, version, title, description, image2x } of data.channelViewer.earnedBadges) {
    const id = `twitch:${setID}/${version}`
    if (badges.has(id)) continue
    badges.set(id, {
      id,
      type: 'twitch',
      text: title,
      ...(description ? { description } : {}),
      imageUrl: image2x,
    })
  }
  return [...badges.values()]
}
