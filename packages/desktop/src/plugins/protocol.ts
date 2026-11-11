import { z } from 'zod'

import type {
  PluginChannel,
  PluginCommandContext,
  PluginEventMap,
  PluginTransportEmote,
  PluginTransportMessage,
  PluginTransportStatus,
} from './api'

export const MAX_PLUGINS = 32
export const MAX_COMMANDS = 64
export const MAX_TRANSPORTS = 8
export const MAX_CONNECTIONS = 64
export const MAX_PENDING_REQUESTS = 32
export const MAX_BATCH = 32
export const MAX_EVENT_QUEUE = 512
export const REQUEST_TIMEOUT_MS = 8_000

export const pluginIdSchema = z
  .string()
  .regex(/^[a-z][a-z\d-]{0,47}$/u, 'Use lowercase letters, numbers and hyphens for the plugin ID.')
  .refine((id) => !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(id), 'Reserved plugin ID.')
export const commandNameSchema = z.string().regex(/^[a-z][a-z\d_-]{0,31}$/u)
export const transportIdSchema = z.string().regex(/^[a-z][a-z\d-]{0,31}$/u)
const id = z.string().min(1).max(256)
const name = z.string().trim().min(1).max(256)
const text = z.string().max(16_384)
const MAX_EMOTE_POSITIONS = 64
const timestamp = z.number().min(0).max(8.64e15)
const requestId = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const failure = z.string().min(1).max(1000)

export const pluginChannelSchema = z.object({
  platform: z.string().min(1).max(96),
  id,
  name,
  watchedChannelId: id.optional(),
}) satisfies z.ZodType<PluginChannel>
const commandContext = z.object({
  text,
  args: z.array(text).max(512),
  channel: pluginChannelSchema.nullable(),
}) satisfies z.ZodType<PluginCommandContext>
const author = z.object({
  id,
  name,
  username: name.optional(),
  color: z
    .string()
    .regex(/^#[\da-f]{6}$/iu)
    .optional()
    .catch(undefined),
})
const status = z.enum(['connecting', 'connected', 'disconnected', 'error'])
export const transportStatusSchema = z.object({
  status,
  error: failure.optional(),
}) satisfies z.ZodType<PluginTransportStatus>
const transportEmoteSchema = z.object({
  id,
  name,
  imageUrl: z
    .string()
    .max(2048)
    .refine((value) => {
      const url = URL.parse(value)
      return (
        value.startsWith('https://') && url?.protocol === 'https:' && !url.username && !url.password
      )
    }),
  positions: z
    .array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }))
    .min(1)
    .max(MAX_EMOTE_POSITIONS),
  aspectRatio: z.number().positive().optional(),
}) satisfies z.ZodType<PluginTransportEmote>
export const transportMessageSchema = z
  .object({
    id,
    author,
    text: text.min(1),
    emotes: z.array(transportEmoteSchema).max(MAX_EMOTE_POSITIONS).optional(),
    timestamp: timestamp.optional(),
    historical: z.boolean().optional(),
  })
  .refine(
    ({ text: messageText, emotes }) => {
      if (!emotes) return true
      let count = 0
      for (const { positions } of emotes) {
        count += positions.length
        if (count > MAX_EMOTE_POSITIONS) return false
        if (positions.some(({ start, end }) => start > end || end >= messageText.length))
          return false
      }
      return true
    },
    { path: ['emotes'], message: 'Invalid emote positions.' },
  ) satisfies z.ZodType<PluginTransportMessage>
export const eventNameSchema = z.enum([
  'message',
  'channelStatus',
  'chatEvent',
  'roomState',
  'moderation',
  'chatCleared',
])
const eventPayloads = {
  message: z.object({
    channel: pluginChannelSchema,
    id,
    author,
    text,
    timestamp,
    type: z.enum(['message', 'action', 'system']),
  }),
  channelStatus: transportStatusSchema.extend({ channel: pluginChannelSchema }),
  roomState: z.object({
    channel: pluginChannelSchema,
    slowSeconds: z.number().nonnegative().optional(),
    followersOnlyMinutes: z.number().nonnegative().nullable().optional(),
    subscribersOnly: z.boolean().optional(),
    emoteOnly: z.boolean().optional(),
    uniqueChat: z.boolean().optional(),
  }),
  moderation: z.object({
    channel: pluginChannelSchema,
    action: z.enum(['delete_message', 'timeout', 'ban']),
    messageId: id.optional(),
    targetUserId: id.optional(),
    durationSeconds: z.number().nonnegative().optional(),
  }),
  chatCleared: z.object({ channel: pluginChannelSchema }),
  chatEvent: z.object({
    channel: pluginChannelSchema.nullable(),
    id,
    type: name,
    user: author.pick({ id: true, name: true }),
    timestamp,
  }),
} satisfies { [Event in keyof PluginEventMap]: z.ZodType<PluginEventMap[Event]> }
const eventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('message'), payload: eventPayloads.message }),
  z.object({ event: z.literal('channelStatus'), payload: eventPayloads.channelStatus }),
  z.object({ event: z.literal('chatEvent'), payload: eventPayloads.chatEvent }),
  z.object({ event: z.literal('roomState'), payload: eventPayloads.roomState }),
  z.object({ event: z.literal('moderation'), payload: eventPayloads.moderation }),
  z.object({ event: z.literal('chatCleared'), payload: eventPayloads.chatCleared }),
])
export type PluginEvent = z.input<typeof eventSchema>

const transportDescriptorSchema = z.object({
  id: transportIdSchema,
  name: name.max(100),
  canSend: z.boolean(),
})
const registrationSchema = z.object({
  commands: z.array(commandNameSchema).max(MAX_COMMANDS),
  events: z.array(eventNameSchema).max(eventNameSchema.options.length),
  transports: z.array(transportDescriptorSchema).max(MAX_TRANSPORTS),
})
export type PluginRegistration = z.infer<typeof registrationSchema>

const transportUpdate = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    connectionId: requestId,
    message: transportMessageSchema,
  }),
  z.object({ kind: z.literal('status'), connectionId: requestId, status: transportStatusSchema }),
])
export type TransportUpdate = z.infer<typeof transportUpdate>

export const hostActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('getChannels') }),
  z.object({ action: z.literal('sendMessage'), channel: pluginChannelSchema, text: text.min(1) }),
  z.object({
    action: z.literal('addSystemMessage'),
    channel: pluginChannelSchema,
    text: text.min(1),
  }),
])
export type HostAction = z.infer<typeof hostActionSchema>
const hostResult = z.array(pluginChannelSchema).max(4096).nullable()
export type HostResult = z.infer<typeof hostResult>

const workerAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('command'), name: commandNameSchema, input: commandContext }),
  z.object({ action: z.literal('events'), events: z.array(eventSchema).max(MAX_BATCH) }),
  z.object({ action: z.literal('ping') }),
  z.object({
    action: z.literal('connect'),
    connectionId: requestId,
    transportId: transportIdSchema,
    channelId: id,
  }),
  z.object({ action: z.literal('disconnect'), connectionId: requestId }),
  z.object({ action: z.literal('send'), connectionId: requestId, text: text.min(1) }),
])
export type WorkerAction = z.infer<typeof workerAction>

const errorResult = z.object({ ok: z.literal(false), error: failure })
export const workerInboundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stop') }),
  z.object({ kind: z.literal('request'), id: requestId, value: workerAction }),
  z.object({
    kind: z.literal('hostResult'),
    id: requestId,
    reply: z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), value: hostResult }),
      errorResult,
    ]),
  }),
  z.object({ kind: z.literal('transportAck'), id: requestId }),
])
export type WorkerInbound = z.infer<typeof workerInboundSchema>

export const workerOutboundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready'), registration: registrationSchema }),
  z.object({ kind: z.literal('fatal'), error: failure }),
  z.object({
    kind: z.literal('result'),
    id: requestId,
    reply: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true) }), errorResult]),
  }),
  z.object({ kind: z.literal('hostRequest'), id: requestId, value: hostActionSchema }),
  z.object({
    kind: z.literal('transportUpdates'),
    id: requestId,
    updates: z.array(transportUpdate).max(MAX_BATCH),
  }),
])
export type WorkerOutbound = z.infer<typeof workerOutboundSchema>

export function pluginError(error: unknown): string {
  return (
    (error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown plugin error.'
    ).slice(0, 1000) || 'Unknown plugin error.'
  )
}
