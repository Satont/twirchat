import { config } from '../config.ts'
import { fetchTwitchHelixWithAppToken } from './stream-status.ts'
import { resolveTwitchUserId } from './twitch-users.ts'
import type {
  UserCardAccountAgeField,
  UserCardMetadataBackendRequest,
  UserCardFollowAgeField,
  UserCardMetadataResponse,
  UserCardSubAgeField,
  UserCardSubscriptionDurationField,
} from '@twirchat/shared'

interface TwitchAuthContext {
  accessToken: string
  platformUserId: string
  scopes: string[]
}

interface TwitchUserResponse {
  data: Array<{
    id: string
    created_at: string
  }>
}

interface TwitchFollowerResponse {
  data: Array<{
    followed_at: string
  }>
}

interface TwitchSubscriptionResponse {
  data: Array<{
    tier?: string
    is_gift?: boolean
    gifter_name?: string
  }>
}

interface KickChannelUserResponse {
  username: string
  slug: string
  profile_pic?: string | null
  following_since?: string | null
  subscribed_for?: number | null
}

function unavailableAccountAge(
  status: UserCardAccountAgeField['status'],
  message: string,
): UserCardAccountAgeField {
  return { status, createdAt: null, message }
}

function availableAccountAge(createdAt: string): UserCardAccountAgeField {
  return { status: 'available', createdAt }
}

function unavailableFollowAge(
  status: UserCardFollowAgeField['status'],
  message: string,
): UserCardFollowAgeField {
  return { status, followedAt: null, message }
}

function availableFollowAge(followedAt: string): UserCardFollowAgeField {
  return { status: 'available', followedAt }
}

function unavailableSubscriptionDuration(
  status: UserCardSubscriptionDurationField['status'],
  message: string,
): UserCardSubscriptionDurationField {
  return {
    status,
    currentlySubscribed: null,
    message,
  }
}

function availableSubscriptionDuration(
  currentlySubscribed: boolean,
  extras: Omit<UserCardSubscriptionDurationField, 'status' | 'currentlySubscribed'> = {},
): UserCardSubscriptionDurationField {
  return {
    status: 'available',
    currentlySubscribed,
    ...extras,
  }
}

function unavailableSubAge(
  status: UserCardSubAgeField['status'],
  message: string,
): UserCardSubAgeField {
  return { status, months: null, message }
}

function availableSubAge(months: number, message?: string): UserCardSubAgeField {
  return { status: 'available', months, message }
}

async function resolveTwitchBroadcasterId(
  channelId: string | undefined,
  auth: TwitchAuthContext | undefined,
): Promise<string | null> {
  if (!channelId || !auth) {
    return null
  }

  return resolveTwitchUserId(channelId, auth.accessToken)
}

async function fetchTwitchAccountAge(platformUserId: string): Promise<UserCardAccountAgeField> {
  const response = await fetchTwitchHelixWithAppToken(
    `https://api.twitch.tv/helix/users?id=${encodeURIComponent(platformUserId)}`,
  )

  if (!response.ok) {
    return unavailableAccountAge('unavailable', `Twitch user lookup failed (${response.status}).`)
  }

  const body = (await response.json()) as TwitchUserResponse
  const user = body.data[0]

  if (!user?.created_at) {
    return unavailableAccountAge('unavailable', 'Twitch did not return an account creation date.')
  }

  return availableAccountAge(user.created_at)
}

async function fetchTwitchFollowAge(
  targetUserId: string,
  channelId: string | undefined,
  auth: TwitchAuthContext | undefined,
): Promise<UserCardFollowAgeField> {
  if (!auth) {
    return unavailableFollowAge(
      'unavailable',
      'Follow age requires an authenticated Twitch account.',
    )
  }

  if (!auth.scopes.includes('moderator:read:followers')) {
    return unavailableFollowAge(
      'missing_permission',
      'Follow age requires Twitch broadcaster auth with moderator:read:followers.',
    )
  }

  const broadcasterId = await resolveTwitchBroadcasterId(channelId, auth)
  if (!broadcasterId) {
    return unavailableFollowAge(
      'unavailable',
      'Could not resolve the Twitch channel for this message.',
    )
  }

  const response = await fetch(
    `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${encodeURIComponent(
      broadcasterId,
    )}&user_id=${encodeURIComponent(targetUserId)}`,
    {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Client-Id': config.TWITCH_CLIENT_ID,
      },
    },
  )

  if (response.status === 401 || response.status === 403) {
    return unavailableFollowAge(
      'missing_permission',
      'Twitch denied follow lookup for this broadcaster token.',
    )
  }

  if (!response.ok) {
    return unavailableFollowAge('unavailable', `Twitch follow lookup failed (${response.status}).`)
  }

  const body = (await response.json()) as TwitchFollowerResponse
  const follow = body.data[0]

  if (!follow?.followed_at) {
    return unavailableFollowAge('unavailable', 'This user is not currently following this channel.')
  }

  return availableFollowAge(follow.followed_at)
}

async function fetchTwitchSubscriptionDuration(
  targetUserId: string,
  channelId: string | undefined,
  auth: TwitchAuthContext | undefined,
): Promise<UserCardSubscriptionDurationField> {
  if (!auth) {
    return unavailableSubscriptionDuration(
      'unavailable',
      'Subscription status requires an authenticated Twitch account.',
    )
  }

  if (!auth.scopes.includes('channel:read:subscriptions')) {
    return unavailableSubscriptionDuration(
      'missing_permission',
      'Subscription status requires Twitch broadcaster auth with channel:read:subscriptions.',
    )
  }

  const broadcasterId = await resolveTwitchBroadcasterId(channelId, auth)
  if (!broadcasterId) {
    return unavailableSubscriptionDuration(
      'unavailable',
      'Could not resolve the Twitch channel for this message.',
    )
  }

  if (broadcasterId !== auth.platformUserId) {
    return unavailableSubscriptionDuration(
      'unavailable',
      'Subscription status is only available for your authenticated Twitch channel.',
    )
  }

  const response = await fetch(
    `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${encodeURIComponent(
      broadcasterId,
    )}&user_id=${encodeURIComponent(targetUserId)}`,
    {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Client-Id': config.TWITCH_CLIENT_ID,
      },
    },
  )

  if (response.status === 401 || response.status === 403) {
    return unavailableSubscriptionDuration(
      'missing_permission',
      'Twitch denied subscription lookup for this broadcaster token.',
    )
  }

  if (!response.ok) {
    return unavailableSubscriptionDuration(
      'unavailable',
      `Twitch subscription lookup failed (${response.status}).`,
    )
  }

  const body = (await response.json()) as TwitchSubscriptionResponse
  const subscription = body.data[0]

  if (!subscription) {
    return availableSubscriptionDuration(false, {
      message: 'Not currently subscribed to this channel.',
    })
  }

  return availableSubscriptionDuration(true, {
    tier: subscription.tier,
    isGift: subscription.is_gift,
    gifterDisplayName: subscription.gifter_name,
    message: 'Current subscription status is available, but on-demand tenure is not.',
  })
}

async function fetchKickUserMetadata(
  platformUserId: string,
  username: string | undefined,
  channelSlug: string | undefined,
): Promise<UserCardMetadataResponse> {
  if (!username || !channelSlug) {
    return {
      platform: 'kick',
      platformUserId,
      fetchedAt: Date.now(),
      accountAge: unavailableAccountAge(
        'unsupported',
        'Kick does not expose account age through the available API.',
      ),
      followAge: unavailableFollowAge(
        'unavailable',
        'Kick follow/subscription metadata needs the channel slug and chatter username.',
      ),
      subscriptionDuration: unavailableSubscriptionDuration(
        'unavailable',
        'Kick follow/subscription metadata needs the channel slug and chatter username.',
      ),
      subAge: unavailableSubAge(
        'unavailable',
        'Kick follow/subscription metadata needs the channel slug and chatter username.',
      ),
    }
  }

  const response = await fetch(
    `https://kick.com/api/v2/channels/${encodeURIComponent(channelSlug)}/users/${encodeURIComponent(username)}`,
  )

  if (!response.ok) {
    return {
      platform: 'kick',
      platformUserId,
      fetchedAt: Date.now(),
      accountAge: unavailableAccountAge(
        'unsupported',
        'Kick does not expose account age through the available API.',
      ),
      followAge: unavailableFollowAge(
        'unavailable',
        `Kick user metadata lookup failed (${response.status}).`,
      ),
      subscriptionDuration: unavailableSubscriptionDuration(
        'unavailable',
        `Kick user metadata lookup failed (${response.status}).`,
      ),
      subAge: unavailableSubAge(
        'unavailable',
        `Kick user metadata lookup failed (${response.status}).`,
      ),
    }
  }

  const body = (await response.json()) as KickChannelUserResponse
  const subscribedFor = body.subscribed_for ?? 0
  const isSubscribed = subscribedFor > 0

  return {
    platform: 'kick',
    platformUserId,
    fetchedAt: Date.now(),
    accountAge: unavailableAccountAge(
      'unsupported',
      'Kick does not expose account age through the available API.',
    ),
    followAge: body.following_since
      ? availableFollowAge(body.following_since)
      : unavailableFollowAge('unavailable', 'This user is not currently following this channel.'),
    subscriptionDuration: isSubscribed
      ? availableSubscriptionDuration(true, {
          message: `Subscribed for ${subscribedFor} month${subscribedFor === 1 ? '' : 's'}.`,
        })
      : availableSubscriptionDuration(false, {
          message: 'Not currently subscribed to this channel.',
        }),
    subAge: isSubscribed
      ? availableSubAge(
          subscribedFor,
          `Subscribed for ${subscribedFor} month${subscribedFor === 1 ? '' : 's'}.`,
        )
      : unavailableSubAge('unavailable', 'This user is not currently subscribed to this channel.'),
  }
}

export async function fetchUserCardMetadata(
  params: UserCardMetadataBackendRequest,
): Promise<UserCardMetadataResponse> {
  const { platform, platformUserId, channelId, channelSlug, username, twitchAuth } = params

  if (platform === 'kick') {
    return fetchKickUserMetadata(platformUserId, username, channelSlug)
  }

  const [accountAge, followAge, subscriptionDuration] = await Promise.all([
    fetchTwitchAccountAge(platformUserId),
    fetchTwitchFollowAge(platformUserId, channelId, twitchAuth),
    fetchTwitchSubscriptionDuration(platformUserId, channelId, twitchAuth),
  ])

  return {
    platform: 'twitch',
    platformUserId,
    fetchedAt: Date.now(),
    accountAge,
    followAge,
    subscriptionDuration,
    subAge: unavailableSubAge(
      'unsupported',
      'Twitch does not expose on-demand sub age through the available broadcaster API.',
    ),
  }
}
