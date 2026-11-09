import type {
  UserCardFollowAgeField,
  UserCardMetadataRequest,
  UserCardSubscriptionDurationField,
} from '@twirchat/shared/protocol'
import { z } from 'zod'

import { type TwitchUserHelix, createTwitchUserHelix } from '../auth/twitch-user-token'
import { resolveTwitchChannel } from './native-emotes'

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

async function fetchTwitchFollowAge(
  targetUserId: string,
  broadcasterId: string,
  auth: TwitchUserHelix,
): Promise<UserCardFollowAgeField> {
  if (!auth.scopes.includes('moderator:read:followers')) {
    return unavailableFollowAge(
      'missing_permission',
      'Follow age requires Twitch broadcaster auth with moderator:read:followers.',
    )
  }

  const query = new URLSearchParams({ broadcaster_id: broadcasterId, user_id: targetUserId })
  const response = await auth.fetch(`channels/followers?${query}`)

  if (response.status === 401 || response.status === 403) {
    return unavailableFollowAge(
      'missing_permission',
      'Twitch denied follow lookup for this broadcaster token.',
    )
  }

  if (!response.ok) {
    return unavailableFollowAge('unavailable', `Twitch follow lookup failed (${response.status}).`)
  }

  const body = z
    .object({ data: z.array(z.object({ followed_at: z.string() })) })
    .parse(await response.json())
  const follow = body.data[0]

  if (!follow?.followed_at) {
    return unavailableFollowAge('unavailable', 'This user is not currently following this channel.')
  }

  return availableFollowAge(follow.followed_at)
}

async function fetchTwitchSubscriptionDuration(
  targetUserId: string,
  broadcasterId: string,
  auth: TwitchUserHelix,
): Promise<UserCardSubscriptionDurationField> {
  if (!auth.scopes.includes('channel:read:subscriptions')) {
    return unavailableSubscriptionDuration(
      'missing_permission',
      'Subscription status requires Twitch broadcaster auth with channel:read:subscriptions.',
    )
  }

  if (broadcasterId !== auth.userId) {
    return unavailableSubscriptionDuration(
      'unavailable',
      'Subscription status is only available for your authenticated Twitch channel.',
    )
  }

  const query = new URLSearchParams({ broadcaster_id: broadcasterId, user_id: targetUserId })
  const response = await auth.fetch(`subscriptions?${query}`)

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

  const body = z
    .object({
      data: z.array(
        z.object({
          tier: z.string().optional(),
          is_gift: z.boolean().optional(),
          gifter_name: z.string().optional(),
        }),
      ),
    })
    .parse(await response.json())
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

export async function loadTwitchUserCardDetails(
  request: UserCardMetadataRequest,
  accessToken: string,
) {
  const channel = request.channelId
  if (!channel)
    return {
      followAge: unavailableFollowAge(
        'unavailable',
        'Could not resolve the Twitch channel for this message.',
      ),
      subscriptionDuration: unavailableSubscriptionDuration(
        'unavailable',
        'Could not resolve the Twitch channel for this message.',
      ),
    }
  const [auth, broadcasterId] = await Promise.all([
    createTwitchUserHelix(accessToken),
    /^\d+$/.test(channel)
      ? Promise.resolve(channel)
      : resolveTwitchChannel(channel).then((value) => value.platformUserId),
  ])
  const [followAge, subscriptionDuration] = await Promise.all([
    fetchTwitchFollowAge(request.platformUserId, broadcasterId, auth),
    fetchTwitchSubscriptionDuration(request.platformUserId, broadcasterId, auth),
  ])
  return { followAge, subscriptionDuration }
}
