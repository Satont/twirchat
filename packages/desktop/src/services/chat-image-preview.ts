/* eslint-disable no-await-in-loop -- Redirects and bounded stream reads are sequential. */
import { Resolver } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

import { decodeHTMLAttribute } from 'entities'

const MAX_URL_LENGTH = 4096
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_PAGE_BYTES = 512 * 1024
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 5000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const PAGE_TYPE = 'text/html'
const IMAGE_METADATA = [
  'og:image:secure_url',
  'og:image',
  'og:image:url',
  'twitter:image',
  'twitter:image:src',
]
const IMAGE_ACCEPT = [...IMAGE_TYPES].join(', ')
const PAGE_ACCEPT = `${IMAGE_ACCEPT}, ${PAGE_TYPE};q=0.9`
const DNS_NAME =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
const LOCAL_SUFFIX = /\.(?:localhost|local|internal|home\.arpa|onion|invalid|test|example)$/u

interface ChatImageNetwork {
  resolveAddresses: (hostname: string, signal: AbortSignal) => Promise<readonly string[]>
  fetch: (url: URL, options: BunFetchRequestInit) => Promise<Response>
}

const blocked = new BlockList()
// IPv4 special-purpose networks, multicast, reserved space, and Azure platform services.
const blockedV4: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['168.63.129.16', 32],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
]
for (const [address, prefix] of blockedV4) blocked.addSubnet(address, prefix, 'ipv4')

const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
// Exclude special assignments even inside global unicast (including Teredo and 6to4).
const blockedV6: ReadonlyArray<[string, number]> = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['2620:4f:8000::', 48],
  ['3fff::', 20],
]
for (const [address, prefix] of blockedV6) blocked.addSubnet(address, prefix, 'ipv6')

function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (family !== 6 || address.includes('%')) return false
  return globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}

function addressHost(url: URL): string {
  return url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
}

function parseTarget(input: string, base?: URL): URL | undefined {
  if (input.length > MAX_URL_LENGTH) return undefined
  const url = URL.parse(input, base)
  if (
    !url ||
    url.href.length > MAX_URL_LENGTH ||
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.port
  )
    return undefined

  if (!isIP(addressHost(url))) {
    const hostname = url.hostname.replace(/\.$/u, '')
    if (hostname.length > 253 || !DNS_NAME.test(hostname) || LOCAL_SUFFIX.test(`.${hostname}`))
      return undefined
    url.hostname = hostname
  }
  url.hash = ''
  return url
}

function emptyOnNoData(error: unknown): string[] {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENODATA' || error.code === 'ENOTFOUND')
  )
    return []
  throw error
}

async function resolveAddresses(hostname: string, signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted()
  const resolver = new Resolver()
  const cancel = () => resolver.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const fqdn = `${hostname}.`
    const [ipv4, ipv6] = await Promise.all([
      resolver.resolve4(fqdn).catch(emptyOnNoData),
      resolver.resolve6(fqdn).catch(emptyOnNoData),
    ])
    return [...ipv4, ...ipv6]
  } finally {
    resolver.cancel()
    signal.removeEventListener('abort', cancel)
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

function matchesImageType(bytes: Uint8Array, type: string): boolean {
  switch (type) {
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case 'image/gif':
      return (
        startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) &&
        bytes[5] === 0x61
      )
    case 'image/webp':
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      )
    default:
      return false
  }
}

async function readBody(
  response: Response,
  signal: AbortSignal,
  limit: number,
  imageType?: string,
): Promise<Uint8Array | undefined> {
  const minBytes = imageType === undefined ? 1 : 12
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase()
  const contentLength = response.headers.get('content-length')
  const expected = contentLength === null ? undefined : Number(contentLength)
  if (
    response.status !== 200 ||
    !response.body ||
    (encoding && encoding !== 'identity') ||
    (contentLength !== null && !/^\d+$/u.test(contentLength)) ||
    (expected !== undefined && (expected < minBytes || expected > limit))
  )
    return undefined

  const reader = response.body.getReader()
  let bytes = new Uint8Array(0)
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      const end = length + value.byteLength
      if (end > (expected ?? limit)) return undefined
      if (end > bytes.length) {
        const expanded = new Uint8Array(
          Math.min(expected ?? limit, Math.max(end, bytes.length * 2, 16 * 1024)),
        )
        expanded.set(bytes)
        bytes = expanded
      }
      bytes.set(value, length)
      if (
        imageType !== undefined &&
        length < 12 &&
        end >= 12 &&
        !matchesImageType(bytes, imageType)
      )
        return undefined
      length = end
    }
    if (length < minBytes || (expected !== undefined && length !== expected)) return undefined
    return bytes.subarray(0, length)
  } finally {
    reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function readImageTarget(bytes: Uint8Array, pageUrl: URL): URL | undefined {
  const candidates = new Map<string, URL>()
  let cardType: string | undefined
  new HTMLRewriter()
    .on('head meta', {
      element(meta) {
        const key = decodeHTMLAttribute(
          meta.getAttribute('property') ?? meta.getAttribute('name') ?? '',
        )
          .trim()
          .toLowerCase()
        const content = meta.getAttribute('content')
        if (!content) return
        if (key === 'twitter:card') {
          cardType ??= decodeHTMLAttribute(content).trim().toLowerCase() || undefined
          return
        }
        if (!IMAGE_METADATA.includes(key) || candidates.has(key)) return
        const value = decodeHTMLAttribute(content).trim()
        const target = value ? parseTarget(value, pageUrl) : undefined
        if (target && target.href !== pageUrl.href) candidates.set(key, target)
      },
    })
    .transform(new TextDecoder().decode(bytes))
  // Compact link cards often use avatars or site logos rather than attached media.
  if (cardType === 'summary') return undefined
  for (const key of IMAGE_METADATA) {
    const target = candidates.get(key)
    if (target) return target
  }
  return undefined
}

export function createChatImageFetcher(network: ChatImageNetwork) {
  return async (input: string, callerSignal: AbortSignal): Promise<Uint8Array | undefined> => {
    const requestLifetime = new AbortController()
    const signal = AbortSignal.any([
      callerSignal,
      requestLifetime.signal,
      AbortSignal.timeout(TIMEOUT_MS),
    ])
    try {
      let url = parseTarget(input)
      let redirects = 0
      let allowPage = true
      while (url) {
        signal.throwIfAborted()
        const hostname = addressHost(url)
        const addresses = isIP(hostname)
          ? [hostname]
          : await network.resolveAddresses(hostname, signal)
        const address = addresses[0]
        if (!address || !addresses.every(isPublicAddress)) return undefined
        signal.throwIfAborted()

        // Dial the checked IP, but preserve the origin for HTTP routing and TLS verification.
        const pinned = new URL(url)
        pinned.hostname = isIP(address) === 6 ? `[${address}]` : address
        const response = await network.fetch(pinned, {
          method: 'GET',
          headers: {
            Host: url.host,
            Accept: allowPage ? PAGE_ACCEPT : IMAGE_ACCEPT,
            'Accept-Encoding': 'identity',
          },
          tls: { serverName: isIP(hostname) ? undefined : hostname, rejectUnauthorized: true },
          proxy: false,
          credentials: 'omit',
          redirect: 'manual',
          decompress: false,
          keepalive: false,
          signal,
        })
        try {
          if (REDIRECT_STATUSES.has(response.status)) {
            const location = response.headers.get('location')
            if (!location || redirects >= MAX_REDIRECTS) return undefined
            redirects++
            url = parseTarget(location, url)
            continue
          }

          const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
          if (type && IMAGE_TYPES.has(type))
            return await readBody(response, signal, MAX_IMAGE_BYTES, type)
          if (!allowPage || type !== PAGE_TYPE) return undefined

          const bytes = await readBody(response, signal, MAX_PAGE_BYTES)
          url = bytes ? readImageTarget(bytes, url) : undefined
          allowPage = false
        } finally {
          response.body?.cancel().catch(() => {})
        }
      }
    } catch {
      // Invalid DNS, TLS, HTTP responses, network failures and cancellation mean no preview.
    } finally {
      requestLifetime.abort()
    }
    return undefined
  }
}

const fetchImage = createChatImageFetcher({ fetch, resolveAddresses })

export async function fetchChatImage(
  url: string,
  signal: AbortSignal,
): Promise<Uint8Array | undefined> {
  return fetchImage(url, signal)
}
