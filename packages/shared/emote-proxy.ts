const IMAGE_HOSTS = new Set([
  'cdn.7tv.app',
  'cdn.7tv.io',
  'cdn.betterttv.net',
  'cdn.frankerfacez.com',
])

function publicHttpsUrl(value: string): URL | null {
  if (value.length > 2048) return null
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
      return null
    if (/%(?:2f|5c|2e|00)/i.test(url.pathname) || url.pathname.includes('\\')) return null
    return url
  } catch {
    return null
  }
}

export function providerImageSource(value: string): URL | null {
  const url = publicHttpsUrl(value)
  if (!url || !IMAGE_HOSTS.has(url.hostname)) return null
  const path = url.pathname
  if (url.hostname === 'cdn.7tv.app' || url.hostname === 'cdn.7tv.io')
    return /^\/(?:emote|badge|paint|user|cosmetic)\/[A-Za-z0-9_./-]+$/.test(path) ? url : null
  if (url.hostname === 'cdn.betterttv.net')
    return /^\/(?:emote|badges|assets\/badges)\/[A-Za-z0-9_./-]+$/.test(path) ? url : null
  return /^\/(?:(?:emoticon|animated|static|badge|room)\/[A-Za-z0-9_./-]+|[A-Za-z0-9_-]+\.(?:png|jpe?g|gif|webp|avif|svg))$/.test(
    path,
  )
    ? url
    : null
}

export function providerImageProxyPath(source: string): string | null {
  try {
    const url = new URL(source.startsWith('//') ? 'https:' + source : source)
    if (!IMAGE_HOSTS.has(url.hostname)) return null
    if (url.protocol === 'http:') url.protocol = 'https:'
    return '/proxy/provider-image?url=' + encodeURIComponent(url.href)
  } catch {
    return null
  }
}

export function proxiedProviderImage(source: string, backendUrl: string): string {
  const path = providerImageProxyPath(source)
  return path ? backendUrl.replace(/\/$/, '') + path : source
}

export type ProviderMetadataTarget = {
  url: URL
  kind: 'catalog' | 'cosmetics' | 'presence'
}

export function providerMetadataTarget(value: string): ProviderMetadataTarget | null {
  const url = publicHttpsUrl(value)
  if (!url || url.search) return null
  if (url.hostname === 'api.betterttv.net')
    return /^\/3\/cached\/(?:emotes\/global|badges|users\/twitch\/\d+)$/.test(url.pathname)
      ? { url, kind: 'catalog' }
      : null
  if (url.hostname === 'api.frankerfacez.com')
    return /^\/v1\/(?:set\/global|badges|room\/(?:id\/\d+|[A-Za-z0-9_]{1,30}))$/.test(url.pathname)
      ? { url, kind: 'catalog' }
      : null
  if (url.hostname !== '7tv.io') return null
  if (url.pathname === '/v4/gql') return { url, kind: 'cosmetics' }
  if (/^\/v3\/users\/[A-Za-z0-9_-]{1,100}\/presences$/.test(url.pathname))
    return { url, kind: 'presence' }
  return /^\/v3\/(?:emote-sets\/[A-Za-z0-9_-]{1,100}|users\/(?:twitch|kick)\/[A-Za-z0-9_-]{1,100})$/.test(
    url.pathname,
  )
    ? { url, kind: 'catalog' }
    : null
}

export const SEVENTV_COSMETICS_QUERY = `query DesktopCosmetics($platform: Platform!, $platformId: String!) {
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
