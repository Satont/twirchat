import type { TwitchActivityEvent, TwitchReward } from '@twirchat/shared/twitch-activities'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { z } from 'zod'

const twitchLogin = z
  .string()
  .regex(/^[a-z\d_]{1,25}$/iu)
  .toLowerCase()
const redemptionSchema = z.object({
  id: z.string().min(1),
  broadcaster_user_login: twitchLogin,
  user_id: z.string().min(1),
  user_login: twitchLogin,
  user_name: z.string().trim().min(1),
  user_input: z.literal(''),
  redeemed_at: z.iso.datetime().transform((value) => new Date(value)),
  reward: z.object({
    id: z.string().min(1),
    title: z.string().trim().min(1),
    cost: z.int().positive(),
  }),
})

interface RewardNotice {
  id: string
  channelId: string
  actor: Pick<NormalizedChatMessage['author'], 'id' | 'username' | 'displayName'>
  timestamp: Date
  reward: Pick<TwitchReward, 'id' | 'title' | 'cost'>
}

export function buildTwitchRewardNotice({
  id,
  channelId,
  actor,
  timestamp,
  reward,
}: RewardNotice): NormalizedChatMessage {
  return {
    id: `twitch:reward-redemption:${id}`,
    platform: 'twitch',
    channelId,
    author: { ...actor, badges: [] },
    text: '',
    emotes: [],
    timestamp,
    type: 'system',
    metadata: { rewardId: reward.id, rewardTitle: reward.title, rewardCost: reward.cost },
  }
}

export function parseTwitchRewardNotice(
  event: TwitchActivityEvent,
): NormalizedChatMessage | undefined {
  if (event.eventType !== 'channel.channel_points_custom_reward_redemption.add') return undefined
  const payload = redemptionSchema.safeParse(event.data).data
  if (!payload) return undefined
  return buildTwitchRewardNotice({
    id: payload.id,
    channelId: payload.broadcaster_user_login,
    actor: {
      id: payload.user_id,
      username: payload.user_login,
      displayName: payload.user_name,
    },
    timestamp: payload.redeemed_at,
    reward: payload.reward,
  })
}
