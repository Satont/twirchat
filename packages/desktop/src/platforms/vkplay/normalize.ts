import type { Badge, Emote, NormalizedChatMessage } from '@twirchat/shared/types'
import { z } from 'zod'

const badgeObjectSchema = z.object({
  id: z.string().optional(),
  largeUrl: z.string().optional(),
  mediumUrl: z.string().optional(),
  name: z.string().optional(),
  smallUrl: z.string().optional(),
})

export const vkPlayBadgeSchema = z.union([z.string(), badgeObjectSchema])

export const vkPlayUserSchema = z.object({
  avatar_url: z.string().optional(),
  badges: z.array(vkPlayBadgeSchema).optional(),
  id: z.number().int(),
  is_moderator: z.boolean().optional(),
  is_owner: z.boolean().optional(),
  nick: z.string(),
  nick_color: z.number().int().optional(),
  roles: z.array(vkPlayBadgeSchema).optional(),
})

const contentSchema = z.object({ content: z.string().optional() })

const textPartSchema = z.object({ text: contentSchema })
const linkPartSchema = z.object({
  link: z.object({ content: z.string().optional(), url: z.string().optional() }),
})
const mentionPartSchema = z.object({ mention: contentSchema })
const smilePartSchema = z.object({
  smile: z.object({
    animated: z.boolean().optional(),
    content: z.string().optional(),
    id: z.string().optional(),
    largeUrl: z.string().optional(),
    mediumUrl: z.string().optional(),
    name: z.string().optional(),
    smallUrl: z.string().optional(),
  }),
})

export const vkPlayPartSchema = z.union([
  textPartSchema,
  linkPartSchema,
  mentionPartSchema,
  smilePartSchema,
])

export const vkPlayMessageSchema = z.object({
  author: vkPlayUserSchema,
  created_at: z.number(),
  id: z.number().int(),
  parts: z.array(vkPlayPartSchema),
})

export const vkPlayPublicationSchema = z.object({
  data: z.object({ chat_message: vkPlayMessageSchema }),
  type: z.literal('channel_chat_message_send'),
})

export type VkPlayMessage = z.infer<typeof vkPlayMessageSchema>
export type VkPlayPart = z.infer<typeof vkPlayPartSchema>
export type VkPlayUser = z.infer<typeof vkPlayUserSchema>

export function vkPlayTimestamp(value: number): Date {
  return new Date(value < 1_000_000_000_000 ? value * 1000 : value)
}

function partText(part: VkPlayPart): string {
  if ('text' in part) return part.text.content ?? ''
  if ('link' in part) return part.link.content || part.link.url || ''
  if ('mention' in part) return part.mention.content ?? ''
  return part.smile.content || part.smile.name || ''
}

function badgeText(badge: z.infer<typeof vkPlayBadgeSchema>): string {
  return typeof badge === 'string' ? badge : (badge.name ?? badge.id ?? '')
}

function badgeList(
  badges: readonly z.infer<typeof vkPlayBadgeSchema>[] | undefined,
  type: string,
): Badge[] {
  return (badges ?? []).flatMap((badge) => {
    const text = badgeText(badge)
    if (!text) return []
    if (typeof badge === 'string') return [{ id: badge, text, type }]
    const imageUrl = badge.smallUrl ?? badge.mediumUrl ?? badge.largeUrl
    return [
      {
        id: badge.id ?? text,
        text,
        type,
        ...(imageUrl ? { imageUrl } : {}),
      },
    ]
  })
}

export function normalizeVkPlayMessage(
  message: VkPlayMessage,
  channelId: string,
): NormalizedChatMessage {
  let text = ''
  const emotes: Emote[] = []
  for (const part of message.parts) {
    if ('smile' in part) {
      const name = part.smile.content || part.smile.name
      if (!name) continue
      if (part.smile.id) {
        const start = text.length
        text += name
        emotes.push({
          animated: part.smile.animated,
          id: part.smile.id,
          imageUrl: part.smile.mediumUrl ?? part.smile.largeUrl ?? part.smile.smallUrl ?? '',
          name,
          positions: [{ end: text.length - 1, start }],
          source: 'channel',
        })
        continue
      }
      text += name
      continue
    }
    text += partText(part)
  }

  return {
    author: {
      ...(message.author.avatar_url ? { avatarUrl: message.author.avatar_url } : {}),
      badges: [
        ...badgeList(message.author.badges, 'vkplay'),
        ...badgeList(message.author.roles, 'vkplay-role'),
      ],
      displayName: message.author.nick,
      id: String(message.author.id),
      username: message.author.nick,
    },
    channelId,
    emotes,
    id: String(message.id),
    platform: 'vkplay',
    text,
    timestamp: vkPlayTimestamp(message.created_at),
    type: 'message',
  }
}
