import { z } from 'zod'

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
