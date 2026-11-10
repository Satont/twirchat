import type { Emote, NormalizedChatMessage } from '@twirchat/shared/types'
import { z } from 'zod'

const badgeSchema = z.object({
  id: z.string(),
  largeUrl: z.string().optional(),
  mediumUrl: z.string().optional(),
  name: z.string().optional(),
  smallUrl: z.string().optional(),
})

const roleSchema = z.object({
  id: z.string(),
  largeUrl: z.string().optional(),
  mediumUrl: z.string().optional(),
  name: z.string(),
  smallUrl: z.string().optional(),
})

export const vkPlayUserSchema = z.object({
  avatarUrl: z.string().optional(),
  badges: z.array(badgeSchema).optional(),
  displayName: z.string().optional(),
  hasAvatar: z.boolean().optional(),
  id: z.number().int(),
  isChatModerator: z.boolean().optional(),
  isOwner: z.boolean().optional(),
  nick: z.string(),
  nickColor: z.number().int().optional(),
  roles: z.array(roleSchema).optional(),
})

const textPartSchema = z.object({
  content: z.string(),
  modificator: z.string().optional(),
  type: z.literal('text'),
})

const linkPartSchema = z.object({
  content: z.string().optional(),
  explicit: z.boolean().optional(),
  type: z.literal('link'),
  url: z.string(),
})

const mentionPartSchema = z.object({
  displayName: z.string().optional(),
  id: z.number().int(),
  nick: z.string().optional(),
  type: z.literal('mention'),
})

const smilePartSchema = z.object({
  animated: z.boolean().optional(),
  id: z.string(),
  largeUrl: z.string().optional(),
  mediumUrl: z.string().optional(),
  name: z.string(),
  smallUrl: z.string().optional(),
  type: z.literal('smile'),
})

export const vkPlayPartSchema = z.discriminatedUnion('type', [
  textPartSchema,
  linkPartSchema,
  mentionPartSchema,
  smilePartSchema,
])

const parentMessageSchema = z.object({
  author: vkPlayUserSchema,
  createdAt: z.number(),
  data: z.array(vkPlayPartSchema),
  id: z.number().int(),
  isPrivate: z.boolean().optional(),
})

export const vkPlayMessageSchema = z.object({
  author: vkPlayUserSchema,
  createdAt: z.number(),
  data: z.array(vkPlayPartSchema),
  flags: z.object({ isFirstMessage: z.boolean().optional() }).optional(),
  id: z.number().int(),
  isPrivate: z.boolean().optional(),
  parent: parentMessageSchema.optional(),
  threadId: z.string().nullable().optional(),
  user: vkPlayUserSchema.optional(),
})

export type VkPlayMessage = z.infer<typeof vkPlayMessageSchema>
export type VkPlayPart = z.infer<typeof vkPlayPartSchema>
export type VkPlayUser = z.infer<typeof vkPlayUserSchema>

export function vkPlayTimestamp(value: number): Date {
  return new Date(value < 1_000_000_000_000 ? value * 1000 : value)
}

function partText(part: VkPlayPart): string {
  if (part.type === 'text') return part.content
  if (part.type === 'link') return part.content || part.url
  if (part.type === 'mention') return `@${part.nick ?? part.displayName ?? String(part.id)}`
  return part.name
}

function messageText(parts: readonly VkPlayPart[]): string {
  return parts.map(partText).join('')
}

export function normalizeVkPlayMessage(
  message: VkPlayMessage,
  channelId: string,
): NormalizedChatMessage {
  let text = ''
  const emotes: Emote[] = []
  for (const part of message.data) {
    if (part.type === 'smile') {
      const start = text.length
      text += part.name
      emotes.push({
        animated: part.animated,
        id: part.id,
        imageUrl: part.mediumUrl ?? part.largeUrl ?? part.smallUrl ?? '',
        name: part.name,
        positions: [{ end: text.length - 1, start }],
        source: 'channel',
      })
      continue
    }
    text += partText(part)
  }

  const badges = [
    ...(message.author.badges ?? []).map((badge) => ({
      id: badge.id,
      imageUrl: badge.smallUrl ?? badge.mediumUrl ?? badge.largeUrl,
      text: badge.name ?? badge.id,
      type: 'vkplay',
    })),
    ...(message.author.roles ?? []).map((role) => ({
      id: role.id,
      imageUrl: role.smallUrl ?? role.mediumUrl ?? role.largeUrl,
      text: role.name,
      type: 'vkplay-role',
    })),
  ]
  const authorId = String(message.author.id)
  const displayName = message.author.displayName ?? message.author.nick
  const parent = message.parent

  return {
    author: {
      avatarUrl: message.author.hasAvatar === false ? undefined : message.author.avatarUrl,
      badges,
      displayName,
      id: authorId,
      username: message.author.nick,
    },
    channelId,
    emotes,
    id: String(message.id),
    ...(message.flags?.isFirstMessage ? { metadata: { firstMessage: true } } : {}),
    platform: 'vkplay',
    ...(parent
      ? {
          reply: {
            parentAuthor: {
              displayName: parent.author.displayName ?? parent.author.nick,
              id: String(parent.author.id),
              username: parent.author.nick,
            },
            parentMessageId: String(parent.id),
            parentMessageText: messageText(parent.data),
          },
        }
      : {}),
    text,
    timestamp: vkPlayTimestamp(message.createdAt),
    type: 'message',
  }
}
