import type { DesktopToBackendMessage } from '@twirchat/shared'
import { DONATION_PROVIDERS, DONATION_SHARE_LIMITS as limits } from '@twirchat/shared/donations'
import { z } from 'zod'
const platform = z.enum(['twitch', 'kick', 'youtube'])
const sharePlatform = z.enum(['twitch', 'kick'])
const shareChannel = z.object({
  platform: sharePlatform,
  channel: z.string().trim().min(1).max(limits.channel),
})
const donation = z.object({
  id: z.string().min(1).max(limits.id),
  provider: z.enum(DONATION_PROVIDERS),
  username: z.string().max(limits.username),
  amount: z.string().max(limits.amount),
  currency: z.string().max(limits.currency),
  message: z.string().max(limits.message),
  timestamp: z.number().finite(),
})
const subscription = z.object({
  platform,
  channelId: z.string(),
  platformUserId: z.string().optional(),
})
export const desktopMessageSchema = z.toZod<DesktopToBackendMessage>()(
  z.union([
    z.object({
      type: z.literal('youtube_chat_subscribe'),
      subscriptionId: z.string(),
      channelId: z.string(),
      videoId: z.string().optional(),
      pageToken: z.string().optional(),
    }),
    z.object({ type: z.literal('youtube_chat_unsubscribe'), subscriptionId: z.string() }),
    z.object({ type: z.literal('ping') }),
    z.object({
      type: z.literal('donation_share_identities'),
      identities: z
        .array(z.object({ platform: sharePlatform, accessToken: z.string().min(1).max(4096) }))
        .max(limits.identities),
    }),
    z.object({ type: z.literal('donation_share'), donation }),
    z.object({
      type: z.literal('donation_watch'),
      channels: z.array(shareChannel).max(limits.watchedChannels),
    }),
    z.object({ type: z.literal('auth_start'), platform: z.enum(['kick', 'youtube']) }),
    z.object({ type: z.literal('auth_logout'), platform }),
    z.object({
      type: z.literal('send_message'),
      platform,
      channel: z.string(),
      message: z.string(),
    }),
    z.object({ type: z.literal('channel_join'), platform, channel: z.string() }),
    z.object({ type: z.literal('channel_leave'), platform, channel: z.string() }),
    subscription.extend({ type: z.literal('seventv_subscribe') }),
    z.object({ type: z.literal('seventv_unsubscribe'), platform, channelId: z.string() }),
    z.object({ type: z.literal('seventv_resubscribe'), subscriptions: z.array(subscription) }),
  ]),
)
