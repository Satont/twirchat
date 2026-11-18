/* eslint-disable no-await-in-loop -- Keep the policy matrix deterministic and isolated. */
import { expect, test } from 'bun:test'

import { createChatImageFetcher } from '../src/services/chat-image-preview'

const PNG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82)
const IMAGE_URL = 'https://images.example.com/image'
const PUBLIC_V4 = '93.184.216.34'
const PUBLIC_V6 = '2606:4700::1111'

function imageResponse(): Response {
  return new Response(PNG, { headers: { 'Content-Type': 'Image/PNG; a=b' } })
}

function fixture(
  options: {
    addresses?: (hostname: string, signal: AbortSignal) => Promise<string[]>
    respond?: (index: number, signal?: AbortSignal | null) => Promise<Response> | Response
  } = {},
) {
  const queries: string[] = []
  const requests: Array<{ url: string; options: RequestInit }> = []
  const fetchImage = createChatImageFetcher({
    resolveAddresses: async (hostname, signal) => {
      queries.push(hostname)
      return options.addresses?.(hostname, signal) ?? [PUBLIC_V4]
    },
    fetch: async (url, init) => {
      requests.push({ url: url.href, options: init })
      return options.respond?.(requests.length - 1, init.signal) ?? imageResponse()
    },
  })
  return { fetchImage, queries, requests }
}

function trackedBody(headers: HeadersInit, status = 200) {
  let canceled = false
  let reads = 0
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        reads++
      },
      cancel() {
        canceled = true
      },
    },
    { highWaterMark: 0 },
  )
  return {
    response: new Response(body, { headers, status }),
    state: () => ({ canceled, reads }),
  }
}

test('validates and pins every hop, preserving the HTTP host and TLS identity only', async () => {
  const first = trackedBody({ Location: '/abc?v=1#fragment', 'Set-Cookie': 'x=1' }, 302)
  const second = trackedBody({ Location: 'https://cdn.example.com/final' }, 308)
  const { fetchImage, queries, requests } = fixture({
    addresses: async (hostname) => [hostname === 'cdn.example.com' ? PUBLIC_V6 : PUBLIC_V4],
    respond: (index) => [first.response, second.response][index] ?? imageResponse(),
  })
  expect(await fetchImage(IMAGE_URL, new AbortController().signal)).toEqual(PNG)
  expect(queries).toEqual(['images.example.com', 'images.example.com', 'cdn.example.com'])
  expect(first.state()).toEqual({ canceled: true, reads: 0 })
  expect(second.state()).toEqual({ canceled: true, reads: 0 })
  expect(requests.map((request) => request.url)).toEqual([
    `https://${PUBLIC_V4}/image`,
    `https://${PUBLIC_V4}/abc?v=1`,
    `https://[${PUBLIC_V6}]/final`,
  ])
  for (const [index, request] of requests.entries()) {
    const host = index === 2 ? 'cdn.example.com' : 'images.example.com'
    expect(request.options).toMatchObject({
      method: 'GET',
      proxy: false,
      redirect: 'manual',
      credentials: 'omit',
      decompress: false,
      keepalive: false,
      tls: { serverName: host, rejectUnauthorized: true },
    })
    const headers = new Headers(request.options?.headers)
    expect(headers.get('host')).toBe(host)
    expect(headers.get('accept-encoding')).toBe('identity')
    expect(headers.has('cookie')).toBe(false)
    expect(headers.has('authorization')).toBe(false)
  }
})

test('rejects unsafe URL schemes, credentials, ports, local names and nonpublic IP literals', async () => {
  const { fetchImage, queries, requests } = fixture()
  for (const input of [
    'not a URL',
    'file:///tmp/image.png',
    'ftp://images.example.com/image.png',
    'https://user:password@images.example.com/image.png',
    'http://images.example.com:8000/image.png',
    'http://printer.local/image.png',
    'http://localhost./image.png',
    'http://127.1/image.png',
    'http://2130706433/image.png',
    'http://0xa9fea9fe/image.png',
    'http://[::ffff:7f00:1]/image.png',
    'http://[::1]/image.png',
    `https://images.example.com/${'a'.repeat(4096)}`,
  ]) {
    expect(await fetchImage(input, new AbortController().signal)).toBeUndefined()
  }
  expect(queries).toEqual([])
  expect(requests).toEqual([])
})

test('fails closed for DNS answer sets containing any nonpublic or malformed address', async () => {
  for (const rejected of [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '168.63.129.16',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '198.18.0.1',
    '203.0.113.1',
    '239.0.0.1',
    '240.0.0.1',
    '::',
    '::ffff:192.168.1.1',
    '64:ff9b::a00:1',
    '2001::1',
    '2001:db8::1',
    '2002:a00:1::',
    'fc00::1',
    'fe80::1',
    'ff00::1',
    'invalid',
  ]) {
    const { fetchImage, requests } = fixture({ addresses: async () => [PUBLIC_V4, rejected] })
    expect(await fetchImage(IMAGE_URL, new AbortController().signal)).toBeUndefined()
    expect(requests).toEqual([])
  }
})

test('revalidates DNS after a same-origin redirect', async () => {
  const rebound = fixture({
    addresses: async () => [rebound.queries.length === 1 ? PUBLIC_V4 : '127.0.0.1'],
    respond: () => new Response(null, { status: 302, headers: { Location: '/new' } }),
  })
  expect(await rebound.fetchImage(IMAGE_URL, new AbortController().signal)).toBeUndefined()
  expect(rebound.queries).toHaveLength(2)
  expect(rebound.requests).toHaveLength(1)
})

test('caps redirect chains and cancels a response with an unusable Location', async () => {
  const loop = fixture({
    respond: () => new Response(null, { status: 302, headers: { Location: '/loop' } }),
  })
  expect(await loop.fetchImage(IMAGE_URL, new AbortController().signal)).toBeUndefined()
  expect(loop.requests).toHaveLength(4)

  const redirect = trackedBody({ Location: 'http://127.0.0.1' }, 302)
  const unsafe = fixture({ respond: () => redirect.response })
  expect(
    await unsafe.fetchImage('http://images.example.com', new AbortController().signal),
  ).toBeUndefined()
  expect(unsafe.requests).toHaveLength(1)
  expect(redirect.state()).toEqual({ canceled: true, reads: 0 })
})

test('cancels unsupported MIME, status, encoding and length without reading the body', async () => {
  for (const body of [
    trackedBody({}),
    trackedBody({ 'Content-Type': 'text/html' }),
    trackedBody({ 'Content-Type': 'image/svg+xml' }),
    trackedBody({ 'Content-Type': 'image/png', 'Content-Length': '5242881' }),
    trackedBody({ 'Content-Type': 'image/png', 'Content-Length': '1e2' }),
    trackedBody({ 'Content-Type': 'image/png', 'Content-Encoding': 'gzip' }),
    trackedBody({ 'Content-Type': 'image/png' }, 206),
  ]) {
    const { fetchImage } = fixture({ respond: () => body.response })
    expect(await fetchImage(IMAGE_URL, new AbortController().signal)).toBeUndefined()
    expect(body.state()).toEqual({ canceled: true, reads: 0 })
  }
})

test('rejects mismatched image content before further reads', async () => {
  let reads = 0
  let canceled = false
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads++
        controller.enqueue(new TextEncoder().encode('<html>Not an image</html>'))
      },
      cancel() {
        canceled = true
      },
    },
    { highWaterMark: 0 },
  )
  const { fetchImage } = fixture({
    respond: () => new Response(body, { headers: { 'Content-Type': 'image/png' } }),
  })
  expect(await fetchImage(IMAGE_URL, new AbortController().signal)).toBeUndefined()
  expect(reads).toBe(1)
  expect(canceled).toBe(true)
})

test('enforces the streaming byte budget without Content-Length', async () => {
  let canceled = false
  const chunk = new Uint8Array(1024 * 1024)
  chunk.set(PNG)
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk)
    },
    cancel() {
      canceled = true
    },
  })
  const { fetchImage } = fixture({
    respond: () => new Response(body, { headers: { 'Content-Type': 'image/png' } }),
  })
  expect(await fetchImage(IMAGE_URL, new AbortController().signal)).toBeUndefined()
  expect(canceled).toBe(true)
})

test('returns no image after abort, DNS failure or transport failure', async () => {
  const failedDns = fixture({ addresses: () => Promise.reject(new Error('DNS failed')) })
  expect(await failedDns.fetchImage(IMAGE_URL, new AbortController().signal)).toBeUndefined()
  expect(failedDns.requests).toEqual([])
  const failedTransport = fixture({ respond: () => Promise.reject(new Error('HTTP failed')) })
  expect(await failedTransport.fetchImage(IMAGE_URL, new AbortController().signal)).toBeUndefined()
  expect(failedTransport.requests).toHaveLength(1)

  const caller = new AbortController()
  const canceledDns = fixture({
    addresses: async (_hostname, signal) => {
      caller.abort()
      expect(signal.aborted).toBe(true)
      return [PUBLIC_V4]
    },
  })
  expect(await canceledDns.fetchImage(IMAGE_URL, caller.signal)).toBeUndefined()
  expect(canceledDns.requests).toEqual([])
  expect(await canceledDns.fetchImage(IMAGE_URL, caller.signal)).toBeUndefined()
  expect(canceledDns.queries).toHaveLength(1)
})
