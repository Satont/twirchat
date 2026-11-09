import type { PlatformCommandResult } from '@twirchat/shared/channel-tools'
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
import type { UserProfileSnapshot } from '@twirchat/shared/user-profile'
import { z } from 'zod'

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

export const platformCommandResultSchema = z.toZod<PlatformCommandResult>()(
  z.object({ message: z.string().optional() }),
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
