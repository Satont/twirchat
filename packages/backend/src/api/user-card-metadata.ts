import type {
  UserCardAccountAgeField,
  UserCardMetadataRequest,
  UserCardFollowAgeField,
  UserCardMetadataResponse,
  UserCardSubAgeField,
  UserCardSubscriptionDurationField,
} from '@twirchat/shared'
import { z } from 'zod'

import { fetchTwitchHelixWithAppToken } from './stream-status.ts'

interface KickChannelUserIdentityResponse {
  id?: number | string
  username?: string
  role?: string
  badges?: unknown[]
  following_since?: string | null
  subscribed_since?: string | null
  subscription_since?: string | null
  subscription_started_at?: string | null
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

async function fetchTwitchAccountAge(platformUserId: string): Promise<UserCardAccountAgeField> {
  const response = await fetchTwitchHelixWithAppToken(
    `https://api.twitch.tv/helix/users?id=${encodeURIComponent(platformUserId)}`,
  )

  if (!response.ok) {
    return unavailableAccountAge('unavailable', `Twitch user lookup failed (${response.status}).`)
  }

  const body = z
    .object({ data: z.array(z.object({ id: z.string(), created_at: z.string() })) })
    .parse(await response.json())
  const user = body.data[0]

  if (!user?.created_at) {
    return unavailableAccountAge('unavailable', 'Twitch did not return an account creation date.')
  }

  return availableAccountAge(user.created_at)
}

function emptyKickMetadata(
  platformUserId: string,
  followAge: UserCardFollowAgeField,
  subscriptionDuration: UserCardSubscriptionDurationField,
  subAge: UserCardSubAgeField,
): UserCardMetadataResponse {
  return {
    platform: 'kick',
    platformUserId,
    fetchedAt: Date.now(),
    accountAge: unavailableAccountAge(
      'unsupported',
      'Kick does not expose account age through the available API.',
    ),
    followAge,
    subscriptionDuration,
    subAge,
  }
}

function kickSubscribedSince(body: KickChannelUserIdentityResponse): string | null {
  return body.subscribed_since ?? body.subscription_since ?? body.subscription_started_at ?? null
}

function kickUnableToVerifyFollowMessage(status?: number): string {
  return status
    ? `Unable to verify Kick follow status from identity metadata (${status}).`
    : 'Unable to verify Kick follow status from identity metadata.'
}

async function fetchKickUserMetadata(
  platformUserId: string,
  channelId: string | undefined,
): Promise<UserCardMetadataResponse> {
  if (!channelId || !platformUserId) {
    const message = 'Kick follow/subscription metadata needs channel and user IDs.'

    return emptyKickMetadata(
      platformUserId,
      unavailableFollowAge('unavailable', message),
      unavailableSubscriptionDuration('unavailable', message),
      unavailableSubAge('unavailable', message),
    )
  }

  const response = await fetch(
    `https://kick.com/api/v2/channels/${encodeURIComponent(channelId)}/users/${encodeURIComponent(
      platformUserId,
    )}/identity`,
  )

  if (!response.ok) {
    const message = kickUnableToVerifyFollowMessage(response.status)

    return emptyKickMetadata(
      platformUserId,
      unavailableFollowAge('unavailable', message),
      unavailableSubscriptionDuration('unavailable', message),
      unavailableSubAge('unavailable', message),
    )
  }

  const body = z
    .object({
      id: z.union([z.number(), z.string()]).optional(),
      username: z.string().optional(),
      role: z.string().optional(),
      badges: z.array(z.unknown()).optional(),
      following_since: z.union([z.string(), z.null()]).optional(),
      subscribed_since: z.union([z.string(), z.null()]).optional(),
      subscription_since: z.union([z.string(), z.null()]).optional(),
      subscription_started_at: z.union([z.string(), z.null()]).optional(),
    })
    .parse(await response.json())
  const subscribedSince = kickSubscribedSince(body)

  return emptyKickMetadata(
    platformUserId,
    body.following_since
      ? availableFollowAge(body.following_since)
      : unavailableFollowAge('unavailable', kickUnableToVerifyFollowMessage()),
    subscribedSince
      ? availableSubscriptionDuration(true, {
          message: `Subscribed since ${subscribedSince}.`,
        })
      : availableSubscriptionDuration(false, {
          message: 'Not currently subscribed to this channel.',
        }),
    subscribedSince
      ? unavailableSubAge(
          'unavailable',
          'Kick identity metadata confirms a current subscription, but does not expose sub-age months.',
        )
      : unavailableSubAge('unavailable', 'This user is not currently subscribed to this channel.'),
  )
}

export async function fetchUserCardMetadata(
  params: UserCardMetadataRequest,
): Promise<UserCardMetadataResponse> {
  const { platform, platformUserId, channelId } = params

  if (platform === 'kick') {
    return fetchKickUserMetadata(platformUserId, channelId)
  }

  const accountAge = await fetchTwitchAccountAge(platformUserId)
  return {
    platform: 'twitch',
    platformUserId,
    fetchedAt: Date.now(),
    accountAge,
    followAge: unavailableFollowAge(
      'unavailable',
      'Follow age requires an authenticated Twitch account.',
    ),
    subscriptionDuration: unavailableSubscriptionDuration(
      'unavailable',
      'Subscription status requires an authenticated Twitch account.',
    ),
    subAge: unavailableSubAge(
      'unsupported',
      'Twitch does not expose on-demand sub age through the available broadcaster API.',
    ),
  }
}
