export interface InlineEmoteImageOptions {
  height: number
  scale: number
  backendUrl?: string
}

const SEVENTV_HOSTS = new Set(['cdn.7tv.app', 'cdn.7tv.io'])
const SEVENTV_IMAGE = /^(\/emote\/[A-Za-z0-9_-]{1,100}\/)[1-4]x(_static)?\.(webp|avif|gif|png)$/u
const SEVENTV_PROXY_ID = /^[A-Za-z0-9_-]{1,100}$/u
const SEVENTV_FORMATS = new Set(['webp', 'avif', 'gif', 'png'])

function parseUrl(source: string, base?: URL): URL | undefined {
  try {
    return new URL(source.startsWith('//') ? `https:${source}` : source, base)
  } catch {
    return undefined
  }
}

function sizedSevenTvUrl(source: string, variant: number): string {
  const url = parseUrl(source)
  if (
    !url ||
    !SEVENTV_HOSTS.has(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !SEVENTV_IMAGE.test(url.pathname)
  )
    return source
  const pathname = url.pathname.replace(/\/[1-4]x(?=_static\.|\.)/u, `/${variant}x`)
  if (pathname === url.pathname) return source
  url.pathname = pathname
  return source.startsWith('//') ? url.href.slice('https:'.length) : url.href
}

/** Select only the inline raster; callers retain the catalog URL for previews. */
export function inlineEmoteImageSource(source: string, options: InlineEmoteImageOptions): string {
  const physicalHeight = options.height * options.scale
  if (!Number.isFinite(physicalHeight) || physicalHeight <= 0) return source
  const variant = Math.max(1, Math.min(4, Math.ceil(physicalHeight / 32)))
  const direct = sizedSevenTvUrl(source, variant)
  if (direct !== source) return direct

  const relative = source.startsWith('/') && !source.startsWith('//')
  const base = parseUrl(
    options.backendUrl ? `${options.backendUrl.replace(/\/$/u, '')}/` : 'https://twirchat.invalid/',
  )
  const url = parseUrl(source, relative ? base : undefined)
  if (!url || !base || (!relative && (!options.backendUrl || url.origin !== base.origin)))
    return source
  const proxyRoot = `${base.pathname.replace(/\/$/u, '')}/proxy/`
  if (url.pathname === `${proxyRoot}provider-image`) {
    const original = url.searchParams.get('url')
    if (!original) return source
    const image = sizedSevenTvUrl(original, variant)
    if (image === original) return source
    url.searchParams.set('url', image)
  } else if (url.pathname.startsWith(`${proxyRoot}7tv/`)) {
    const id = url.pathname.slice(`${proxyRoot}7tv/`.length)
    if (
      !SEVENTV_PROXY_ID.test(id) ||
      !/^[1-4]x$/u.test(url.searchParams.get('size') ?? '4x') ||
      !SEVENTV_FORMATS.has(url.searchParams.get('format') ?? 'webp')
    )
      return source
    const size = `${variant}x`
    if (url.searchParams.get('size') === size) return source
    url.searchParams.set('size', size)
  } else return source
  return relative ? `${url.pathname}${url.search}${url.hash}` : url.href
}
