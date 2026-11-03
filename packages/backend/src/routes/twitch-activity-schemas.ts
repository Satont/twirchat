import type { TwitchActivityAction } from '@twirchat/shared/twitch-activities'
import { z } from 'zod'

export const twitchWebSessionSchema = z.object({
  token: z.string(),
  userId: z.string(),
  username: z.string(),
  clientId: z.string(),
})
export const twitchCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  platformUserId: z.string().min(1),
  scopes: z.array(z.string()),
  webSession: twitchWebSessionSchema.nullish().transform((value) => value ?? undefined),
})
export const snapshotPartsSchema = z.array(
  z.enum(['polls', 'predictions', 'rewards', 'pinnedMessage', 'pointsBalance']),
)
export const twitchActivityActionSchema = z.toZod<TwitchActivityAction>()(
  z.intersection(
    z.object({ channelSlug: z.string() }),
    z.union([
      z.object({
        action: z.literal('create_poll'),
        title: z.string(),
        choices: z.array(z.string()),
        duration: z.number(),
        pointsPerVote: z.number().optional(),
      }),
      z.object({ action: z.enum(['end_poll', 'archive_poll']), pollId: z.string() }),
      z.object({
        action: z.literal('vote_poll'),
        pollId: z.string(),
        choiceId: z.string(),
        votes: z.number().optional(),
        pointsPerVote: z.number().optional(),
      }),
      z.object({
        action: z.literal('create_prediction'),
        title: z.string(),
        outcomes: z.array(z.string()),
        duration: z.number(),
      }),
      z.object({
        action: z.enum(['lock_prediction', 'cancel_prediction']),
        predictionId: z.string(),
      }),
      z.object({
        action: z.literal('resolve_prediction'),
        predictionId: z.string(),
        outcomeId: z.string(),
      }),
      z.object({
        action: z.literal('place_bet'),
        predictionId: z.string(),
        outcomeId: z.string(),
        points: z.number(),
      }),
      z.object({
        action: z.literal('pin_message'),
        messageId: z.string(),
        duration: z.number().optional(),
      }),
      z.object({
        action: z.literal('update_pin'),
        messageId: z.string(),
        duration: z.number().optional(),
      }),
      z.object({ action: z.literal('unpin_message'), messageId: z.string() }),
      z.object({
        action: z.literal('update_reward'),
        rewardId: z.string(),
        patch: z.object({
          title: z.string().optional(),
          cost: z.number().optional(),
          prompt: z.string().optional(),
          isEnabled: z.boolean().optional(),
          isPaused: z.boolean().optional(),
        }),
      }),
      z.object({
        action: z.literal('update_redemptions'),
        rewardId: z.string(),
        ids: z.array(z.string()),
        status: z.enum(['FULFILLED', 'CANCELED']),
      }),
      z.object({
        action: z.literal('redeem_reward'),
        rewardId: z.string(),
        rewardTitle: z.string(),
        cost: z.number(),
        input: z.string().optional(),
      }),
      z.object({ action: z.enum(['follow', 'unfollow']) }),
      z.object({ action: z.enum(['add_editor', 'remove_editor']), username: z.string() }),
      z.object({
        action: z.enum(['assign_lead_moderator', 'unassign_lead_moderator']),
        userId: z.string(),
      }),
      z.object({ action: z.literal('send_whisper'), username: z.string(), text: z.string() }),
    ]),
  ),
)
