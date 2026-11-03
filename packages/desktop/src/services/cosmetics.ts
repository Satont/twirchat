import type { Badge, Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { sanitizeDisplayText, truncateGraphemes } from '../views/shared/utils/display-text'
import { deleteOldestEntry } from './bounded-cache'
import { getProviderBadges, type ProviderFetch } from './emote-providers'
import { createPaintRenderer } from './paint-renderer'

const rowSchema = z.record(z.string(), z.unknown())
type Row = z.infer<typeof rowSchema>
const row = (value: unknown): Row => rowSchema.safeParse(value).data ?? {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const number = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const color = (value: unknown): string =>
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

const QUERY = `query DesktopCosmetics($platform: Platform!, $platformId: String!) {
  users { userByConnection(platform: $platform, platformId: $platformId) {
    id personalEmoteSet { id }
    style {
      activeBadge { id name images { url scale frameCount } }
      activePaint { id name data {
        layers { opacity ty { __typename
          ... on PaintLayerTypeSingleColor { color { hex } }
          ... on PaintLayerTypeLinearGradient { angle repeating stops { at color { hex } } }
          ... on PaintLayerTypeRadialGradient { shape repeating stops { at color { hex } } }
          ... on PaintLayerTypeImage { images { url scale frameCount } }
        } }
        shadows { color { hex } offsetX offsetY blur }
      } }
    }
  } }
}`

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
      const stops = list(ty.stops)
        .map((entry) => ({
          at: Math.min(1, Math.max(0, number(row(entry).at))),
          color: color(row(entry).color),
        }))
        .sort((a, b) => a.at - b.at)
      switch (ty['__typename']) {
        case 'PaintLayerTypeSingleColor':
          return [{ type: 'color', color: color(ty.color), opacity }]
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
                  color: color(shadow.color),
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
  fetcher: ProviderFetch = (url, init) => fetch(url, init),
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
  ): Promise<UserCosmetics> => {
    const key = `${platform}:${userId}`
    const old = cache.get(key)
    if (old && old.expires > Date.now()) return Promise.resolve(old.value)
    const inflight = pending.get(key)
    if (inflight) return inflight
    if (pending.size >= 500) return Promise.resolve({ badges: [], lookupStatus: 'unavailable' })
    const task = (async () => {
      if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve))
      else active++
      const providerBadges = badges(platform, userId, username).catch(() => [])
      try {
        let result: UserCosmetics = { badges: [], lookupStatus: 'not-found' }
        if (platform !== 'youtube' && userId) {
          const response = await fetcher('https://7tv.io/v4/gql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: QUERY,
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
    cachedUserCosmetics: (platform: Platform, userId: string) =>
      cache.get(`${platform}:${userId}`)?.value,
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
  const response = await fetch(`https://7tv.io/v3/users/${encodeURIComponent(userId)}/presences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 1, data: { id: channelId, platform: platform.toUpperCase() } }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`7TV presence HTTP ${response.status}`)
}

const xml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char,
  )

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
        16,
    )
  const height = mask?.height ?? Math.ceil(fontSize * 1.8 + 8),
    baseline = Math.ceil(fontSize * 1.25 + 4)
  const glyph = mask
    ? `<image href="${xml(mask.imageUrl)}" width="${width}" height="${height}"/>`
    : `<text x="8" y="${baseline}" font-family="${xml(fontFamily)},sans-serif" font-size="${fontSize}" font-weight="700">${xml(clean)}</text>`
  const defs: string[] = [`<mask id="glyph"><g fill="white">${glyph}</g></mask>`]
  const shapes: string[] = []
  if (paint.shadows.length)
    defs.push(
      `<filter id="shadow" x="-50%" y="-100%" width="200%" height="300%">${paint.shadows.map((shadow) => `<feDropShadow dx="${shadow.offsetX}" dy="${shadow.offsetY}" stdDeviation="${shadow.blur / 2}" flood-color="${shadow.color}"/>`).join('')}</filter>`,
    )
  paint.layers.forEach((layer, index) => {
    let fill = 'none'
    if (layer.type === 'color') fill = layer.color
    if (layer.type === 'linear') {
      const radians = (layer.angle * Math.PI) / 180,
        x = Math.sin(radians) / 2,
        y = -Math.cos(radians) / 2
      defs.push(
        `<linearGradient id="p${index}" x1="${0.5 - x}" y1="${0.5 - y}" x2="${0.5 + x}" y2="${0.5 + y}" spreadMethod="${layer.repeating ? 'repeat' : 'pad'}">${layer.stops.map((stop) => `<stop offset="${stop.at}" stop-color="${stop.color}"/>`).join('')}</linearGradient>`,
      )
      fill = `url(#p${index})`
    }
    if (layer.type === 'radial') {
      defs.push(
        `<radialGradient id="p${index}" spreadMethod="${layer.repeating ? 'repeat' : 'pad'}">${layer.stops.map((stop) => `<stop offset="${stop.at}" stop-color="${stop.color}"/>`).join('')}</radialGradient>`,
      )
      fill = `url(#p${index})`
    }
    if (layer.type === 'image')
      shapes.push(
        `<image href="${xml(layer.imageUrl)}" width="${width}" height="${height}" opacity="${layer.opacity}" preserveAspectRatio="xMidYMid slice"/>`,
      )
    else
      shapes.push(
        `<rect width="${width}" height="${height}" fill="${fill}" opacity="${layer.opacity}"/>`,
      )
  })
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${defs.join('')}</defs><g${paint.shadows.length ? ' filter="url(#shadow)"' : ''}><g mask="url(#glyph)">${shapes.join('')}</g></g></svg>`,
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
