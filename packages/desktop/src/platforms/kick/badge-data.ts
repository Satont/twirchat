import type { Badge } from '@twirchat/shared/types'
import { z } from 'zod'

import { getKickBadgeSvg } from './badges'

export const kickLegacyBadgeSchema = z.object({
  type: z.string().min(1),
  text: z.string(),
  count: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
  sort_order: z.number().finite().optional(),
})

export const kickImageBadgeSchema = z.object({
  name: z.string().min(1),
  badge_type: z.string().min(1),
  image_url: z.url().refine((value) => new URL(value).protocol === 'https:'),
  selected: z.boolean().optional(),
  sort_order: z.number().finite().optional(),
})

export const kickBadgeIdentitySchema = z.object({
  color: z.string(),
  badges: z
    .array(z.unknown())
    .optional()
    .transform((values) =>
      (values ?? []).flatMap((value) => {
        const badge = kickLegacyBadgeSchema.safeParse(value)
        return badge.success ? [badge.data] : []
      }),
    ),
  badges_v2: z
    .array(z.unknown())
    .optional()
    .transform((values) =>
      (values ?? []).flatMap((value) => {
        const badge = kickImageBadgeSchema.safeParse(value)
        return badge.success ? [badge.data] : []
      }),
    ),
})

export const kickSubscriberBadgeSchema = z.object({
  months: z.number().int().positive(),
  badge_image: z.object({
    src: z.url().refine((value) => new URL(value).protocol === 'https:'),
  }),
})

export type KickLegacyBadge = z.infer<typeof kickLegacyBadgeSchema>
export type KickImageBadge = z.infer<typeof kickImageBadgeSchema>
export type KickSubscriberBadge = z.infer<typeof kickSubscriberBadgeSchema>

export interface KickBadgeIdentity {
  badges?: readonly KickLegacyBadge[]
  badges_v2?: readonly KickImageBadge[]
}

function subscriberImage(
  count: number,
  subscriberBadges: readonly KickSubscriberBadge[],
): string | undefined {
  let selected: KickSubscriberBadge | undefined
  for (const badge of subscriberBadges) {
    if (badge.months <= count && (!selected || badge.months > selected.months)) selected = badge
  }
  return selected?.badge_image.src
}

export function normalizeKickBadges(
  identity: KickBadgeIdentity,
  subscriberBadges: readonly KickSubscriberBadge[] = [],
): Badge[] {
  const badges = new Map<string, { badge: Badge; order: number }>()
  for (const legacy of identity.badges ?? []) {
    if (legacy.active === false) continue
    const embeddedType =
      (legacy.type === 'subgifter' || legacy.type === 'sub_gifter') && legacy.count
        ? `${legacy.type}:${legacy.count}`
        : legacy.type
    const embeddedImage = getKickBadgeSvg(embeddedType)
      ? `embedded:kick:${embeddedType}`
      : undefined
    const imageUrl =
      legacy.type === 'subscriber'
        ? (subscriberImage(legacy.count ?? 1, subscriberBadges) ?? embeddedImage)
        : embeddedImage
    badges.set(legacy.type, {
      badge: { id: legacy.type, type: legacy.type, text: legacy.text, imageUrl },
      order: legacy.sort_order ?? Number.POSITIVE_INFINITY,
    })
  }
  for (const image of identity.badges_v2 ?? []) {
    if (image.selected === false) continue
    badges.set(image.name, {
      badge: {
        id: `${image.badge_type}:${image.name}`,
        type: image.name,
        text: image.name,
        imageUrl: image.image_url,
      },
      order: image.sort_order ?? Number.POSITIVE_INFINITY,
    })
  }
  return [...badges.values()]
    .sort((left, right) => left.order - right.order)
    .slice(0, 4)
    .map(({ badge }) => badge)
}
