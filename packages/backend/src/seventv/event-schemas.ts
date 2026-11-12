import { z } from 'zod'

export const sevenTVEventMessageSchema = z.object({
  op: z.number(),
  t: z.number().optional(),
  d: z.unknown().optional(),
})
export const sevenTVHelloSchema = z.object({
  heartbeat_interval: z.number(),
  session_id: z.string(),
  subscription_limit: z.number(),
})
export const eventImageFileSchema = z.object({
  url: z.string().nullish(),
  name: z.string().nullish(),
  mime: z.string().nullish(),
  size: z.number().nullish(),
  scale: z.number().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  frameCount: z.number().nullish(),
})
export const sevenTVEventEmoteValueSchema = z.object({
  id: z.string(),
  name: z.string(),
  data: z.object({
    animated: z.boolean(),
    host: z.object({ url: z.string(), files: z.array(eventImageFileSchema) }),
  }),
})
const actorNameSchema = z.string().trim().min(1).optional().catch(undefined)
const actorSchema = z
  .object({ display_name: actorNameSchema, username: actorNameSchema })
  .optional()
  .catch(undefined)
const emoteChangeTypeSchema = z.enum(['object', 'emote'])
export const emoteInsertSchema = z.object({
  key: z.literal('emotes'),
  index: z.number(),
  type: emoteChangeTypeSchema,
  value: sevenTVEventEmoteValueSchema,
})
export const emoteRemoveSchema = z.object({
  key: z.literal('emotes'),
  index: z.number(),
  type: emoteChangeTypeSchema,
  old_value: sevenTVEventEmoteValueSchema,
})
export const emoteUpdateSchema = z.object({
  key: z.literal('emotes'),
  index: z.number().optional(),
  type: emoteChangeTypeSchema.optional(),
  old_value: sevenTVEventEmoteValueSchema,
  value: sevenTVEventEmoteValueSchema,
})
export const fieldUpdateSchema = z.object({
  key: z.string().refine((key) => key !== 'emotes'),
  index: z.number().optional(),
  type: z.string().optional(),
  old_value: z.unknown(),
  value: z.unknown(),
})
export const emoteSetUpdateSchema = z.object({
  id: z.string(),
  actor: actorSchema,
  pushed: z.array(emoteInsertSchema).optional(),
  pulled: z.array(emoteRemoveSchema).optional(),
  updated: z.array(z.union([emoteUpdateSchema, fieldUpdateSchema])).optional(),
})
export const emoteSetDeleteSchema = z.object({ id: z.string(), actor: actorSchema })
export const userUpdateNestedFieldSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  old_value: z.unknown().optional(),
})
export const userUpdateSchema = z.object({
  id: z.string(),
  updated: z
    .array(
      z.object({
        key: z.string(),
        index: z.number().nullish(),
        nested: z.boolean().optional(),
        type: z.string().optional(),
        value: z.unknown().optional(),
        old_value: z.unknown().optional(),
      }),
    )
    .optional(),
})
export const sevenTVEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('emote_set.update'), body: emoteSetUpdateSchema }),
  z.object({ type: z.literal('emote_set.delete'), body: emoteSetDeleteSchema }),
  z.object({ type: z.literal('user.update'), body: userUpdateSchema }),
])
