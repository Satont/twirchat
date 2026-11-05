import { z } from 'zod'

import {
  emoteSchema,
  normalizedChatMessageSchema,
  platformSchema,
} from '../../services/persisted-schemas'
import { pluginPlatformSchema } from '../../watched-channels/plugin-channel-types'
import type { MessagePart } from '../shared/utils/messageParts'

const messagePartSchema = z.toZod<MessagePart>()(
  z.object({
    type: z.enum(['text', 'emote']),
    content: z.string().optional(),
    emote: emoteSchema.optional(),
  }),
)
export const overlayMessageSchema = z.object({
  message: normalizedChatMessageSchema.extend({
    platform: z.union([platformSchema, pluginPlatformSchema]),
  }),
  parts: z.array(messagePartSchema),
})
export type OverlayChatMessage = z.infer<typeof overlayMessageSchema>
export const overlayEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat_message'), data: overlayMessageSchema }),
  z.object({ type: z.literal('clear') }),
])
const animationSchema = z.enum(['slide', 'fade', 'none']).catch('slide')
const positionSchema = z.enum(['bottom', 'top']).catch('bottom')
export const parseOverlayAnimation = (value: unknown) => animationSchema.parse(value)
export const parseOverlayPosition = (value: unknown) => positionSchema.parse(value)
