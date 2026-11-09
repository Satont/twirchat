import { SEVENTV_COSMETICS_QUERY } from '@twirchat/shared/emote-proxy'
import type { Badge, Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { sanitizeDisplayText, truncateGraphemes } from '../views/shared/utils/display-text'
import { deleteOldestEntry } from './bounded-cache'
import { COMMUNITY_BADGE_PROVIDERS } from './community-badges'
import { getProviderBadges, type ProviderFetch } from './emote-providers'
import {
  createPaintRenderer,
  PAINT_GLYPH_HORIZONTAL_PADDING,
  PAINT_GLYPH_VERTICAL_PADDING,
} from './paint-renderer'
import { DEFAULT_EMOTE_PREFERENCES, type EmotePreferences } from './provider-emotes'
import { fetchProviderMetadata } from './provider-relay'

const rowSchema = z.record(z.string(), z.unknown())
type Row = z.infer<typeof rowSchema>
const row = (value: unknown): Row => rowSchema.safeParse(value).data ?? {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const number = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const parseColor = (value: unknown): string =>
  /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(str(row(value).hex)) ? str(row(value).hex) : '#ffffff'
const safeUrl = (value: unknown): string | undefined =>
  /^https:\/\/(?:cdn\.7tv\.app|cdn\.7tv\.io)\//i.test(str(value)) ? str(value) : undefined
interface PaintStop {
  at: number
  color: string
}
export type CosmeticPaintLayer = { opacity: number } & (
  | { type: 'color'; color: string }
  | { type: 'linear'; angle: number; repeating: boolean; stops: PaintStop[] }
  | { type: 'radial'; shape: string; repeating: boolean; stops: PaintStop[] }
  | { type: 'image'; imageUrl: string }
)
export interface CosmeticPaint {
  id: string
  name: string
  layers: CosmeticPaintLayer[]
  shadows: Array<{ color: string; offsetX: number; offsetY: number; blur: number }>
}
export interface UserCosmetics {
  sevenTvUserId?: string
  personalEmoteSetId?: string
  badges: Badge[]
  paint?: CosmeticPaint
  lookupStatus: 'available' | 'not-found' | 'unavailable'
}
export type UserCosmeticPreferences = Pick<
  EmotePreferences,
  'badges' | 'paints' | 'communityBadges'
>

function cosmeticsCacheKey(
  platform: Platform,
  userId: string,
  preferences: UserCosmeticPreferences,
): string {
  return JSON.stringify([
    platform,
    userId,
    preferences.badges,
    preferences.paints,
    COMMUNITY_BADGE_PROVIDERS.map((provider) => preferences.communityBadges[provider]),
  ])
}

export function parseCosmetics(value: unknown): UserCosmetics {
  const user = row(row(row(row(value).data).users).userByConnection)
  if (!str(user.id)) return { badges: [], lookupStatus: 'not-found' }
  const style = row(user.style),
    badge = row(style.activeBadge),
    paint = row(style.activePaint)
  const image =
    list(badge.images)
      .map(row)
      .find((item) => number(item.scale) >= 2) ?? row(list(badge.images)[0])
  const badgeUrl = safeUrl(image.url)
  const data = row(paint.data)
  const layers = list(data.layers)
    .slice(0, 16)
    .flatMap((item): CosmeticPaintLayer[] => {
      const layer = row(item),
        ty = row(layer.ty),
        opacity = Math.min(1, Math.max(0, number(layer.opacity, 1)))
      let previous = 0
      const stops = list(ty.stops).map((entry) => {
        const stop = row(entry)
        // CSS moves a descending stop to the previous position, preserving color order.
        previous = Math.min(1, Math.max(previous, number(stop.at)))
        return { at: previous, color: parseColor(stop.color) }
      })
      switch (ty['__typename']) {
        case 'PaintLayerTypeSingleColor':
          return [{ type: 'color', color: parseColor(ty.color), opacity }]
        case 'PaintLayerTypeLinearGradient':
          return stops.length
            ? [
                {
                  type: 'linear',
                  angle: number(ty.angle),
                  repeating: ty.repeating === true,
                  stops,
                  opacity,
                },
              ]
            : []
        case 'PaintLayerTypeRadialGradient':
          return stops.length
            ? [
                {
                  type: 'radial',
                  shape: str(ty.shape),
                  repeating: ty.repeating === true,
                  stops,
                  opacity,
                },
              ]
            : []
        case 'PaintLayerTypeImage': {
          const images = list(ty.images).map(row)
          const preferred =
            images.find((candidate) => number(candidate.frameCount) > 1) ?? images[0]
          const imageUrl = safeUrl(preferred?.url)
          return imageUrl ? [{ type: 'image', imageUrl, opacity }] : []
        }
        default:
          return []
      }
    })
  return {
    sevenTvUserId: str(user.id),
    personalEmoteSetId: str(row(user.personalEmoteSet).id) || undefined,
    badges: badgeUrl
      ? [{ id: `7tv:${str(badge.id)}`, type: 'seventv', text: str(badge.name), imageUrl: badgeUrl }]
      : [],
    ...(str(paint.id) && layers.length
      ? {
          paint: {
            id: str(paint.id),
            name: str(paint.name),
            layers,
            shadows: list(data.shadows)
              .slice(0, 8)
              .map((entry) => {
                const shadow = row(entry)
                return {
                  color: parseColor(shadow.color),
                  offsetX: number(shadow.offsetX),
                  offsetY: number(shadow.offsetY),
                  blur: Math.min(30, Math.max(0, number(shadow.blur))),
                }
              }),
          },
        }
      : {}),
    lookupStatus: 'available',
  }
}

export function createCosmeticsService(
  fetcher: ProviderFetch = fetchProviderMetadata,
  badges = getProviderBadges,
) {
  const cache = new Map<string, { value: UserCosmetics; expires: number }>()
  const pending = new Map<string, Promise<UserCosmetics>>()
  let active = 0
  const waiting: Array<() => void> = []
  const lookup = (
    platform: Platform,
    userId: string,
    username?: string,
    preferences: UserCosmeticPreferences = DEFAULT_EMOTE_PREFERENCES,
  ): Promise<UserCosmetics> => {
    const key = cosmeticsCacheKey(platform, userId, preferences)
    const old = cache.get(key)
    if (old && old.expires > Date.now()) return Promise.resolve(old.value)
    const inflight = pending.get(key)
    if (inflight) return inflight
    if (pending.size >= 500) return Promise.resolve({ badges: [], lookupStatus: 'unavailable' })
    const task = (async () => {
      if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve))
      else active++
      const providerBadges = preferences.badges
        ? badges(platform, userId, username, preferences).catch(() => [])
        : Promise.resolve([])
      try {
        let result: UserCosmetics = { badges: [], lookupStatus: 'not-found' }
        if (platform !== 'youtube' && userId) {
          const response = await fetcher('https://7tv.io/v4/gql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: SEVENTV_COSMETICS_QUERY,
              variables: { platform: platform.toUpperCase(), platformId: userId },
            }),
            signal: AbortSignal.timeout(10_000),
          })
          if (!response.ok) throw new Error(`7TV HTTP ${response.status}`)
          const bytes = await response.arrayBuffer()
          if (bytes.byteLength > 1_000_000) throw new Error('Cosmetics response is too large')
          const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
          if (list(row(json).errors).length)
            throw new Error(str(row(list(row(json).errors)[0]).message))
          result = parseCosmetics(json)
        }
        if (!preferences.badges) result.badges = []
        if (!preferences.paints) delete result.paint
        result.badges.push(...(await providerBadges))
        cache.set(key, { value: result, expires: Date.now() + 600_000 })
        return result
      } catch {
        const value: UserCosmetics = old?.value ?? {
          badges: await providerBadges,
          lookupStatus: 'unavailable',
        }
        cache.set(key, { value, expires: Date.now() + 60_000 })
        return value
      } finally {
        const next = waiting.shift()
        if (next) next()
        else active--
        pending.delete(key)
        while (cache.size > 500) deleteOldestEntry(cache)
      }
    })()
    pending.set(key, task)
    return task
  }
  return {
    getUserCosmetics: lookup,
    cachedUserCosmetics: (
      platform: Platform,
      userId: string,
      preferences: UserCosmeticPreferences = DEFAULT_EMOTE_PREFERENCES,
    ) => cache.get(cosmeticsCacheKey(platform, userId, preferences))?.value,
  }
}

const cosmetics = createCosmeticsService()
export const getUserCosmetics = cosmetics.getUserCosmetics
export const cachedUserCosmetics = cosmetics.cachedUserCosmetics

/** Chatterino's public 7TV presence protocol. Call only after the user opts in. */
export async function updateSevenTvPresence(
  userId: string,
  platform: Platform,
  channelId: string,
): Promise<void> {
  if (platform === 'youtube') return
  const response = await fetchProviderMetadata(
    `https://7tv.io/v3/users/${encodeURIComponent(userId)}/presences`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 1, data: { id: channelId, platform: platform.toUpperCase() } }),
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!response.ok) throw new Error(`7TV presence HTTP ${response.status}`)
}

const xml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char,
  )

type PaintGradient = Extract<CosmeticPaintLayer, { type: 'linear' | 'radial' }>

interface PaintBounds {
  x: number
  y: number
  width: number
  height: number
}

function stopAlpha(color: string): number {
  return color.length === 9 ? Number.parseInt(color.slice(7), 16) / 255 : 1
}

function paintGradient(
  id: string,
  layer: PaintGradient,
  { x, y, width, height }: PaintBounds,
  rect: string,
  defs: string[],
): string {
  const first = layer.stops[0]
  const last = layer.stops.at(-1)
  if (!first || !last) return 'fill="none"'
  if (layer.stops.length === 1 || (layer.repeating && first.at === last.at))
    return `fill="${xml(last.color)}"`

  const start = layer.repeating ? first.at : 0
  const end = layer.repeating ? last.at : 1
  const offset = (at: number) => (at - start) / (end - start)
  const common = `gradientUnits="userSpaceOnUse" spreadMethod="${layer.repeating ? 'repeat' : 'pad'}"`
  const centerX = x + width / 2
  const centerY = y + height / 2
  const tag = layer.type === 'linear' ? 'linearGradient' : 'radialGradient'
  let geometry: string

  if (layer.type === 'linear') {
    const radians = ((layer.angle % 360) * Math.PI) / 180
    const dx = Math.sin(radians)
    const dy = -Math.cos(radians)
    // The CSS gradient line spans the projection of the box's two farthest corners.
    const length = Math.abs(width * dx) + Math.abs(height * dy)
    const from = (start - 0.5) * length
    const to = (end - 0.5) * length
    geometry = `x1="${centerX + dx * from}" y1="${centerY + dy * from}" x2="${centerX + dx * to}" y2="${centerY + dy * to}"`
  } else if (layer.shape === 'ELLIPSE') {
    geometry = `cx="0" cy="0" fr="${start}" r="${end}" gradientTransform="translate(${centerX} ${centerY}) scale(${width / Math.SQRT2} ${height / Math.SQRT2})"`
  } else {
    const radius = Math.hypot(width, height) / 2
    geometry = `cx="${centerX}" cy="${centerY}" fr="${start * radius}" r="${end * radius}"`
  }

  const define = (name: string, stops: string) =>
    `<${tag} id="${name}" ${common} ${geometry}>${stops}</${tag}>`
  const fill = `fill="url(#${id})"`
  const firstAlpha = stopAlpha(first.color)
  if (layer.stops.every(({ color }) => stopAlpha(color) === firstAlpha)) {
    const stops = layer.stops
      .map(({ at, color }) => `<stop offset="${offset(at)}" stop-color="${xml(color)}"/>`)
      .join('')
    defs.push(define(id, stops))
    return fill
  }

  // SVG interpolates straight RGB. Interpolate premultiplied RGB as opaque,
  // then subtract an inverse-alpha gradient to restore alpha without changing RGB.
  const premultiplied: string[] = []
  const inverse: string[] = []
  for (const { at, color } of layer.stops) {
    const alpha = stopAlpha(color)
    const rgb = Number.parseInt(color.slice(1, 7), 16)
    const red = (rgb >> 16) * alpha
    const green = ((rgb >> 8) & 255) * alpha
    const blue = (rgb & 255) * alpha
    premultiplied.push(`<stop offset="${offset(at)}" stop-color="rgb(${red},${green},${blue})"/>`)
    inverse.push(`<stop offset="${offset(at)}" stop-color="black" stop-opacity="${1 - alpha}"/>`)
  }
  defs.push(
    define(id, premultiplied.join('')),
    define(`${id}-inverse`, inverse.join('')),
    `<rect id="${id}-inverse-rect" ${rect} fill="url(#${id}-inverse)"/>`,
    `<filter id="${id}-alpha" filterUnits="userSpaceOnUse" ${rect} color-interpolation-filters="sRGB"><feImage href="#${id}-inverse-rect" result="inverse"/><feComposite in="SourceGraphic" in2="inverse" operator="arithmetic" k2="1" k3="-1"/></filter>`,
  )
  return `${fill} filter="url(#${id}-alpha)"`
}

function paintShadowFilter(shadows: CosmeticPaint['shadows'], width: number, height: number) {
  const primitives = shadows
    .map(
      ({ color, offsetX, offsetY, blur }, index) =>
        `<feGaussianBlur in="SourceAlpha" stdDeviation="${blur / 2}"/><feOffset dx="${offsetX}" dy="${offsetY}" result="offset${index}"/><feFlood flood-color="${xml(color)}"/><feComposite in2="offset${index}" operator="in" result="shadow${index}"/>`,
    )
    .join('')
  const merged = shadows
    .map((_, index) => `<feMergeNode in="shadow${shadows.length - 1 - index}"/>`)
    .join('')
  return `<filter id="shadow" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" color-interpolation-filters="sRGB">${primitives}<feMerge>${merged}</feMerge></filter>`
}

/** Full-color paint clipped to actual glyphs; `<img>` keeps SVG gradients on GPUI. */
export function paintNameSvg(
  name: string,
  paint: CosmeticPaint,
  fontSize = 14,
  fontFamily = 'Inter',
  mask?: { imageUrl: string; width: number; height: number },
): { svg: string; width: number; height: number } {
  const clean = truncateGraphemes(sanitizeDisplayText(name).trim(), 120)
  const width =
    mask?.width ??
    Math.ceil(
      Array.from(clean).reduce(
        (sum, char) =>
          sum +
          (/[ilI.,!' ]/.test(char)
            ? 0.32
            : /[MW@]/.test(char)
              ? 0.95
              : (char.codePointAt(0) ?? 0) > 255
                ? 0.85
                : 0.64),
        0,
      ) *
        fontSize +
        2 * PAINT_GLYPH_HORIZONTAL_PADDING,
    )
  const height = mask?.height ?? Math.ceil(fontSize * 1.8 + 2 * PAINT_GLYPH_VERTICAL_PADDING)
  const bounds = {
    x: PAINT_GLYPH_HORIZONTAL_PADDING,
    y: PAINT_GLYPH_VERTICAL_PADDING,
    width: width - 2 * PAINT_GLYPH_HORIZONTAL_PADDING,
    height: height - 2 * PAINT_GLYPH_VERTICAL_PADDING,
  }
  const baseline = Math.ceil(fontSize * 1.25 + bounds.y)
  const glyph = mask
    ? `<image href="${xml(mask.imageUrl)}" width="${width}" height="${height}"/>`
    : `<text x="${bounds.x}" y="${baseline}" font-family="${xml(fontFamily)},sans-serif" font-size="${fontSize}" font-weight="700">${xml(clean)}</text>`
  const defs: string[] = [`<mask id="glyph"><g fill="white">${glyph}</g></mask>`]
  const rect = `x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"`
  let shadows = ''
  if (paint.shadows.length) {
    defs.push(paintShadowFilter(paint.shadows, width, height))
    shadows = `<g filter="url(#shadow)"><rect width="${width}" height="${height}" mask="url(#glyph)"/></g>`
  }
  const shapes = paint.layers.map((layer, index) => {
    if (layer.type === 'image') {
      return `<image ${rect} href="${xml(layer.imageUrl)}" opacity="${layer.opacity}" preserveAspectRatio="xMinYMin slice"/>`
    }
    const fill =
      layer.type === 'color'
        ? `fill="${xml(layer.color)}"`
        : paintGradient(`p${index}`, layer, bounds, rect, defs)
    return `<rect ${rect} ${fill} opacity="${layer.opacity}"/>`
  })
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${defs.join('')}</defs>${shadows}<g mask="url(#glyph)">${shapes.join('')}</g></svg>`,
  }
}

const paintRenderer = createPaintRenderer()

export function getPaintNameImage(
  name: string,
  paint: CosmeticPaint,
  fontSize = 14,
  fontFamily = 'Inter',
): Promise<{ path: string; width: number; height: number }> {
  return paintRenderer.render(name, paint, fontSize, fontFamily, paintNameSvg)
}

export const cosmeticPaintSchema = z.toZod<CosmeticPaint>()(
  z.object({
    id: z.string(),
    name: z.string(),
    layers: z.array(
      z.intersection(
        z.object({ opacity: z.number() }),
        z.union([
          z.object({ type: z.literal('color'), color: z.string() }),
          z.object({
            type: z.literal('linear'),
            angle: z.number(),
            repeating: z.boolean(),
            stops: z.array(z.object({ at: z.number(), color: z.string() })),
          }),
          z.object({
            type: z.literal('radial'),
            shape: z.string(),
            repeating: z.boolean(),
            stops: z.array(z.object({ at: z.number(), color: z.string() })),
          }),
          z.object({ type: z.literal('image'), imageUrl: z.string() }),
        ]),
      ),
    ),
    shadows: z.array(
      z.object({ color: z.string(), offsetX: z.number(), offsetY: z.number(), blur: z.number() }),
    ),
  }),
)
