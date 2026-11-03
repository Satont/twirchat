import type { DesktopToBackendMessage } from '@twirchat/shared'
import { z } from 'zod'
const platform = z.enum(['twitch', 'kick', 'youtube'])
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
    z.object({ type: z.literal('auth_start'), platform: z.enum(['kick', 'youtube']) }),
    z.object({
      type: z.literal('auth_start_twitch'),
      codeChallenge: z.string(),
      state: z.string(),
    }),
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
