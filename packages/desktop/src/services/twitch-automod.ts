import { z } from 'zod'

import { t, type MessageKey } from '../gpuix/i18n'
import { buildTwitchSystemMessage } from './twitch-system-message'

export interface TwitchAutoModHold {
  type: 'hold'
  channelSlug: string
  messageId: string
  displayName: string
  text: string
  blockedTerm?: true
}

type TwitchAutoModNotification =
  | TwitchAutoModHold
  | { type: 'resolve'; channelSlug: string; messageId: string }

export type TwitchAutoModEvent = TwitchAutoModNotification | { type: 'clear'; channelSlug?: string }

const identity = z.object({
  broadcaster_user_login: z.string().regex(/^[a-z0-9_]{1,25}$/iu),
  message_id: z.string().regex(/^[a-z0-9_-]{1,128}$/iu),
})
const hold = identity.extend({
  user_name: z.string().min(1).max(128),
  message: z.object({ text: z.string().min(1).max(4096) }),
  reason: z.string().optional(),
})
const resolution = identity.extend({
  status: z
    .string()
    .toLowerCase()
    .pipe(z.enum(['approved', 'denied', 'expired'])),
})

export type TwitchAutoModSenderEvent =
  | 'channel.chat.user_message_hold'
  | 'channel.chat.user_message_update'

const sender = identity.extend({ user_id: z.string().regex(/^\d+$/u) })
const senderHold = sender.extend({ status: z.literal('held').default('held') })
const senderUpdate = sender.extend({ status: z.enum(['approved', 'denied', 'invalid']) })
const senderNoticeText = {
  held: 'chatMessages.autoMod.senderNotice.held',
  approved: 'chatMessages.autoMod.senderNotice.approved',
  denied: 'chatMessages.autoMod.senderNotice.denied',
  invalid: 'chatMessages.autoMod.senderNotice.invalid',
} satisfies Record<string, MessageKey>

export function buildTwitchAutoModSenderNotice(
  eventType: TwitchAutoModSenderEvent,
  payload: unknown,
  senderUserId: string,
  at?: string,
) {
  const data =
    eventType === 'channel.chat.user_message_hold'
      ? senderHold.safeParse(payload).data
      : senderUpdate.safeParse(payload).data
  if (!data || data.user_id !== senderUserId) return undefined
  const { status } = data
  return buildTwitchSystemMessage({
    id: `automod:${data.user_id}:${data.message_id}:${status}`,
    channelId: data.broadcaster_user_login,
    timestamp: at ? new Date(at) : undefined,
    text: `AutoMod: ${t(senderNoticeText[status])}`,
    notice: { kind: 'moderation' },
  })
}

export function parseTwitchAutoModEvent(
  eventType: 'automod.message.hold' | 'automod.message.update',
  payload: unknown,
): TwitchAutoModNotification | undefined {
  if (eventType === 'automod.message.hold') {
    const { data } = hold.safeParse(payload)
    if (!data) return undefined
    return {
      type: 'hold',
      channelSlug: data.broadcaster_user_login.toLowerCase(),
      messageId: data.message_id,
      displayName: data.user_name,
      text: data.message.text,
      ...(data.reason === 'blocked_term' ? { blockedTerm: true } : {}),
    }
  }
  const { data } = resolution.safeParse(payload)
  if (!data) return undefined
  return {
    type: 'resolve',
    channelSlug: data.broadcaster_user_login.toLowerCase(),
    messageId: data.message_id,
  }
}
