import type { PlatformCommandResult, RoomState } from '@twirchat/shared/channel-tools'
import type {
  StreamStatusResponse,
  UpdateStreamResponse,
  CategorySearchResult,
  SearchCategoriesResponse,
  ChannelStatus,
  ChannelsStatusResponse,
  UserCardMetadataPlatform,
  UserCardFieldStatus,
  UserCardAccountAgeField,
  UserCardFollowAgeField,
  UserCardSubscriptionDurationField,
  UserCardSubAgeField,
  UserCardMetadataResponse,
} from '@twirchat/shared/protocol'
import type {
  TwitchPollChoice,
  TwitchPoll,
  TwitchPredictionOutcome,
  TwitchPrediction,
  TwitchReward,
  TwitchPinnedMessage,
  TwitchActivitiesSnapshot,
  TwitchRedemption,
  TwitchRedemptionsPage,
  TwitchFollowedChannel,
  TwitchFollowingPage,
  TwitchRewardQueueSummary,
  TwitchWebSession,
  TwitchEventSubscription,
} from '@twirchat/shared/twitch-activities'
import type { Platform } from '@twirchat/shared/types'
import type { UserProfileSnapshot } from '@twirchat/shared/user-profile'
import { z } from 'zod'

export const twitchChattersSchema = z.object({
  broadcasterId: z.string().optional(),
  chatters: z
    .array(
      z.object({
        userId: z.string().optional(),
        userLogin: z.string().optional(),
        userName: z.string().optional(),
        avatarUrl: z.string().optional(),
      }),
    )
    .optional(),
})
export const kickChatroomSchema = z.object({
  broadcasterUserId: z.number().optional(),
  chatroomId: z.number().optional(),
  avatarUrl: z.string().optional(),
})
const kickChatterSchema = z.object({
  slug: z.string().optional(),
  username: z.string().optional(),
  profilePicture: z.string().optional(),
})
export const kickChattersSchema = z.object({
  data: z
    .object({
      moderators: z.array(kickChatterSchema).optional(),
      vips: z.array(kickChatterSchema).optional(),
      ogs: z.array(kickChatterSchema).optional(),
      bots: z.array(kickChatterSchema).optional(),
      chatters: z.array(kickChatterSchema).optional(),
    })
    .optional(),
})

export const twitchPollChoiceSchema = z.toZod<TwitchPollChoice>()(
  z.object({
    id: z.string(),
    title: z.string(),
    votes: z.number(),
    pointsVotes: z.number().optional(),
  }),
)
export const twitchPollSchema = z.toZod<TwitchPoll>()(
  z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    choices: z.array(twitchPollChoiceSchema),
    startedAt: z.string().optional(),
    endsAt: z.string().optional(),
    duration: z.number().optional(),
  }),
)
export const twitchPredictionOutcomeSchema = z.toZod<TwitchPredictionOutcome>()(
  z.object({
    id: z.string(),
    title: z.string(),
    color: z.string().optional(),
    users: z.number().optional(),
    points: z.number().optional(),
  }),
)
export const twitchPredictionSchema = z.toZod<TwitchPrediction>()(
  z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    outcomes: z.array(twitchPredictionOutcomeSchema),
    startedAt: z.string().optional(),
    locksAt: z.string().optional(),
    winningOutcomeId: z.string().optional(),
  }),
)
export const twitchRewardSchema = z.toZod<TwitchReward>()(
  z.object({
    id: z.string(),
    title: z.string(),
    cost: z.number(),
    prompt: z.string().optional(),
    isEnabled: z.boolean(),
    isPaused: z.boolean(),
    isInputRequired: z.boolean().optional(),
    manageable: z.boolean().optional(),
    imageUrl: z.string().optional(),
  }),
)
export const twitchPinnedMessageSchema = z.toZod<TwitchPinnedMessage>()(
  z.object({
    id: z.string(),
    messageId: z.string(),
    text: z.string(),
    authorName: z.string().optional(),
    pinnedAt: z.string().optional(),
    expiresAt: z.string().optional(),
  }),
)
export const twitchActivitiesSnapshotSchema = z.toZod<TwitchActivitiesSnapshot>()(
  z.object({
    channelId: z.string(),
    channelSlug: z.string(),
    polls: z.array(twitchPollSchema),
    predictions: z.array(twitchPredictionSchema),
    rewards: z.array(twitchRewardSchema),
    pinnedMessage: z.union([twitchPinnedMessageSchema, z.null()]),
    pointsBalance: z.number().optional(),
    errors: z.partialRecord(
      z.union([
        z.literal('polls'),
        z.literal('predictions'),
        z.literal('rewards'),
        z.literal('pinnedMessage'),
        z.literal('pointsBalance'),
      ]),
      z.string(),
    ),
  }),
)
export const twitchRedemptionSchema = z.toZod<TwitchRedemption>()(
  z.object({
    id: z.string(),
    rewardId: z.string(),
    userId: z.string(),
    userName: z.string(),
    input: z.string(),
    status: z.string(),
    redeemedAt: z.string(),
  }),
)
export const twitchRedemptionsPageSchema = z.toZod<TwitchRedemptionsPage>()(
  z.object({ redemptions: z.array(twitchRedemptionSchema), cursor: z.string().optional() }),
)
export const twitchFollowedChannelSchema = z.toZod<TwitchFollowedChannel>()(
  z.object({
    id: z.string(),
    login: z.string(),
    displayName: z.string(),
    isLive: z.boolean(),
    title: z.string().optional(),
    viewerCount: z.number().optional(),
    categoryName: z.string().optional(),
  }),
)
export const twitchFollowingPageSchema = z.toZod<TwitchFollowingPage>()(
  z.object({
    channels: z.array(twitchFollowedChannelSchema),
    cursor: z.string().optional(),
    total: z.number().optional(),
  }),
)
export const twitchRewardQueueSummarySchema = z.toZod<TwitchRewardQueueSummary>()(
  z.object({
    rewards: z.array(z.intersection(twitchRewardSchema, z.object({ pendingCount: z.number() }))),
  }),
)
export const twitchWebSessionSchema = z.toZod<TwitchWebSession>()(
  z.object({ token: z.string(), userId: z.string(), username: z.string(), clientId: z.string() }),
)
export const twitchEventSubscriptionSchema = z.toZod<TwitchEventSubscription>()(
  z.object({ id: z.string(), type: z.string(), condition: z.record(z.string(), z.string()) }),
)
export const platformCommandResultSchema = z.toZod<PlatformCommandResult>()(
  z.object({ message: z.string().optional() }),
)
export const platformSchema = z.toZod<Platform>()(
  z.union([z.literal('twitch'), z.literal('youtube'), z.literal('kick')]),
)
export const roomStateSchema = z.toZod<RoomState>()(
  z.object({
    platform: platformSchema,
    channelId: z.string(),
    slowSeconds: z.number().optional(),
    followersOnlyMinutes: z.union([z.number(), z.null()]).optional(),
    subscribersOnly: z.boolean().optional(),
    emoteOnly: z.boolean().optional(),
    uniqueChat: z.boolean().optional(),
  }),
)
export const streamStatusResponseSchema = z.toZod<StreamStatusResponse>()(
  z.object({
    isLive: z.boolean(),
    title: z.string(),
    categoryId: z.string().optional(),
    categoryName: z.string().optional(),
    viewerCount: z.number().optional(),
  }),
)
export const updateStreamResponseSchema = z.toZod<UpdateStreamResponse>()(
  z.object({ ok: z.boolean() }),
)
export const categorySearchResultSchema = z.toZod<CategorySearchResult>()(
  z.object({ id: z.string(), name: z.string(), thumbnailUrl: z.string().optional() }),
)
export const searchCategoriesResponseSchema = z.toZod<SearchCategoriesResponse>()(
  z.object({ categories: z.array(categorySearchResultSchema) }),
)
export const channelStatusSchema = z.toZod<ChannelStatus>()(
  z.object({
    platform: z.union([z.literal('twitch'), z.literal('kick')]),
    channelLogin: z.string(),
    isLive: z.boolean(),
    title: z.string(),
    categoryName: z.string().optional(),
    viewerCount: z.number().optional(),
  }),
)
export const channelsStatusResponseSchema = z.toZod<ChannelsStatusResponse>()(
  z.object({ channels: z.array(channelStatusSchema) }),
)
export const userProfileSnapshotSchema = z.toZod<UserProfileSnapshot>()(
  z.object({
    id: z.string(),
    login: z.string().optional(),
    displayName: z.string().optional(),
    avatarUrl: z.string().optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    broadcasterType: z.string().optional(),
    live: z
      .object({
        title: z.string(),
        category: z.string(),
        viewers: z.number(),
        startedAt: z.string(),
      })
      .optional(),
    lastLive: z.string().optional(),
    followers: z.number().optional(),
    pronouns: z.string().optional(),
    nameHistory: z
      .array(
        z.object({
          login: z.string(),
          firstSeen: z.string().optional(),
          lastSeen: z.string().optional(),
        }),
      )
      .optional(),
    roles: z
      .object({
        broadcaster: z.boolean().optional(),
        moderator: z.boolean().optional(),
        vip: z.boolean().optional(),
        editor: z.boolean().optional(),
      })
      .optional(),
    errors: z.array(z.object({ section: z.string(), message: z.string() })),
  }),
)
export const userCardMetadataPlatformSchema = z.toZod<UserCardMetadataPlatform>()(
  z.union([z.literal('twitch'), z.literal('kick')]),
)
export const userCardFieldStatusSchema = z.toZod<UserCardFieldStatus>()(
  z.union([
    z.literal('available'),
    z.literal('unavailable'),
    z.literal('unsupported'),
    z.literal('missing_permission'),
  ]),
)
export const userCardAccountAgeFieldSchema = z.toZod<UserCardAccountAgeField>()(
  z.object({
    status: userCardFieldStatusSchema,
    createdAt: z.union([z.string(), z.null()]),
    message: z.string().optional(),
  }),
)
export const userCardFollowAgeFieldSchema = z.toZod<UserCardFollowAgeField>()(
  z.object({
    status: userCardFieldStatusSchema,
    followedAt: z.union([z.string(), z.null()]),
    message: z.string().optional(),
  }),
)
export const userCardSubscriptionDurationFieldSchema = z.toZod<UserCardSubscriptionDurationField>()(
  z.object({
    status: userCardFieldStatusSchema,
    currentlySubscribed: z.union([z.boolean(), z.null()]),
    tier: z.string().optional(),
    isGift: z.boolean().optional(),
    gifterDisplayName: z.string().optional(),
    message: z.string().optional(),
  }),
)
export const userCardSubAgeFieldSchema = z.toZod<UserCardSubAgeField>()(
  z.object({
    status: userCardFieldStatusSchema,
    months: z.union([z.number(), z.null()]),
    message: z.string().optional(),
  }),
)
export const userCardMetadataResponseSchema = z.toZod<UserCardMetadataResponse>()(
  z.object({
    platform: userCardMetadataPlatformSchema,
    platformUserId: z.string(),
    fetchedAt: z.number(),
    accountAge: userCardAccountAgeFieldSchema,
    followAge: userCardFollowAgeFieldSchema,
    subscriptionDuration: userCardSubscriptionDurationFieldSchema,
    subAge: userCardSubAgeFieldSchema,
  }),
)
