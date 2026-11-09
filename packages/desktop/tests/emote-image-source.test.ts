import { describe, expect, test } from 'bun:test'

import { inlineEmoteImageSource } from '../src/services/emote-image-source'

const backendUrl = 'https://backend.example/base'
const source = 'https://cdn.7tv.app/emote/01GBFAYKGR000FWWN7MDZZ8XQN/4x.webp'

describe('inline 7TV image resolution', () => {
  test('selects a sufficient physical raster at normal, fractional and high display scale', () => {
    const cases: [number, number, string][] = [
      [28, 1, '1x'],
      [28, 1.25, '2x'],
      [28, 2, '2x'],
      [28, 3, '3x'],
      [32, 1, '1x'],
      [32.01, 1, '2x'],
      [64, 1, '2x'],
      [64.01, 1, '3x'],
      [96, 1, '3x'],
      [96.01, 1, '4x'],
      [500, 4, '4x'],
    ]
    for (const [height, scale, expected] of cases) {
      expect(inlineEmoteImageSource(source, { height, scale })).toBe(
        source.replace('4x.webp', `${expected}.webp`),
      )
    }
  })

  test('preserves the emote identity, static/animated format, query and fragment', () => {
    for (const host of ['cdn.7tv.app', 'cdn.7tv.io']) {
      for (const file of ['4x.gif', '3x.webp', '4x_static.png']) {
        const url = `https://${host}/emote/wide-emote_ID/${file}?version=2#artwork`
        expect(inlineEmoteImageSource(url, { height: 28, scale: 1 })).toBe(
          url.replace(/\/[1-4]x/u, '/1x'),
        )
      }
    }
    expect(inlineEmoteImageSource('//cdn.7tv.app/emote/id/4x.webp', { height: 28, scale: 1 })).toBe(
      '//cdn.7tv.app/emote/id/1x.webp',
    )
  })

  test('requests WebP because the native decoder cannot read animated AVIF', () => {
    expect(
      inlineEmoteImageSource('https://cdn.7tv.app/emote/id/4x.avif?version=2', {
        height: 28,
        scale: 1,
      }),
    ).toBe('https://cdn.7tv.app/emote/id/1x.webp?version=2')
  })

  test('sizes only supported backend proxy routes and keeps their other parameters', () => {
    const url = `${backendUrl}/proxy/7tv/emote_ID?size=4x&format=gif&version=2`
    const result = new URL(inlineEmoteImageSource(url, { height: 28, scale: 2, backendUrl }))
    expect(result.pathname).toBe('/base/proxy/7tv/emote_ID')
    expect(result.searchParams.get('size')).toBe('2x')
    expect(result.searchParams.get('format')).toBe('gif')
    expect(result.searchParams.get('version')).toBe('2')
    expect(inlineEmoteImageSource('/proxy/7tv/emote_ID?format=png', { height: 28, scale: 1 })).toBe(
      '/proxy/7tv/emote_ID?format=png&size=1x',
    )
  })

  test('sizes the encoded CDN source inside the backend image relay', () => {
    const url = `${backendUrl}/proxy/provider-image?url=${encodeURIComponent(source)}&v=3`
    const result = new URL(inlineEmoteImageSource(url, { height: 28, scale: 1, backendUrl }))
    expect(result.searchParams.get('url')).toBe(source.replace('4x.webp', '1x.webp'))
    expect(result.searchParams.get('v')).toBe('3')
  })

  test('leaves unrecognized providers, paths, proxy origins and malformed values intact', () => {
    for (const url of [
      'https://cdn.frankerfacez.com/animated/123/4',
      'https://static-cdn.jtvnw.net/emoticons/v2/id/default/dark/3.0',
      'https://cdn.7tv.app/badge/id/4x.webp',
      'https://cdn.7tv.app/emote/id/full.webp',
      'https://cdn.7tv.app/emote/id/4x.jpeg',
      'https://cdn.7tv.app.attacker.example/emote/id/4x.webp',
      'https://user:password@cdn.7tv.app/emote/id/4x.webp',
      'https://elsewhere.example/proxy/7tv/id?size=4x',
      `${backendUrl}/proxy/7tv/id?size=8x`,
      `${backendUrl}/proxy/7tv/id?format=jpeg`,
      '/tmp/emote/4x.webp',
      'data:image/webp;base64,AAAA',
      'not a URL',
    ])
      expect(inlineEmoteImageSource(url, { height: 28, scale: 1, backendUrl })).toBe(url)
    for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(inlineEmoteImageSource(source, { height, scale: 1 })).toBe(source)
  })
})

describe('inline BetterTTV image resolution', () => {
  const source = 'https://cdn.betterttv.net/emote/5e76d338d6581c3724c0f0b2/3x.webp'

  test('selects the physical raster at standard, fractional and high display scale', () => {
    const cases: [number, number, string][] = [
      [28, 1, '1x'],
      [28.01, 1, '2x'],
      [28, 1.25, '2x'],
      [28, 2, '2x'],
      [56, 1, '2x'],
      [56.01, 1, '3x'],
      [28, 3, '3x'],
      [500, 4, '3x'],
    ]
    for (const [height, scale, expected] of cases)
      expect(inlineEmoteImageSource(source, { height, scale })).toBe(
        source.replace('3x.webp', `${expected}.webp`),
      )
    expect(inlineEmoteImageSource(source.replace('3x', '1x'), { height: 28, scale: 2 })).toBe(
      source.replace('3x', '2x'),
    )
  })

  test('preserves animated/static paths, queries, fragments and protocol-relative URLs', () => {
    for (const prefix of ['https:', 'http:', '']) {
      for (const path of ['', 'static/']) {
        const url = `${prefix}//cdn.betterttv.net/emote/id/${path}3x.webp?v=2#artwork`
        expect(inlineEmoteImageSource(url, { height: 28, scale: 1 })).toBe(
          url.replace('3x.webp', '1x.webp'),
        )
      }
    }
  })

  test('sizes only the encoded source inside trusted provider-image proxies', () => {
    const original = source.replace('3x.webp', 'static/3x.webp?v=2#artwork')
    for (const prefix of [backendUrl, '/base']) {
      const url = `${prefix}/proxy/provider-image?url=${encodeURIComponent(original)}&v=3#proxy`
      const result = new URL(
        inlineEmoteImageSource(url, { height: 28, scale: 2, backendUrl }),
        backendUrl,
      )
      expect(result.searchParams.get('url')).toBe(original.replace('3x.webp', '2x.webp'))
      expect(result.searchParams.get('v')).toBe('3')
      expect(result.hash).toBe('#proxy')
    }
  })

  test('leaves unrecognized paths, hosts, credentials, ports and proxy routes unchanged', () => {
    const unsupported = [
      'https://cdn.betterttv.net/emote/id/4x.webp',
      'https://cdn.betterttv.net/emote/id/3x.gif',
      'https://cdn.betterttv.net/emote/id/3x_static.webp',
      'https://cdn.betterttv.net/emote/id/other/3x.webp',
      'https://cdn.betterttv.net/badge/id/3x.webp',
      'https://cdn.betterttv.net.attacker.example/emote/id/3x.webp',
      'https://user:password@cdn.betterttv.net/emote/id/3x.webp',
      'https://cdn.betterttv.net:8080/emote/id/3x.webp',
      'ftp://cdn.betterttv.net/emote/id/3x.webp',
    ]
    for (const url of unsupported) {
      expect(inlineEmoteImageSource(url, { height: 28, scale: 1 })).toBe(url)
      const proxy = `${backendUrl}/proxy/provider-image?url=${encodeURIComponent(url)}`
      expect(inlineEmoteImageSource(proxy, { height: 28, scale: 1, backendUrl })).toBe(proxy)
    }
    for (const prefix of ['https://elsewhere.example/base', `${backendUrl}/other`]) {
      const url = `${prefix}/proxy/provider-image?url=${encodeURIComponent(source)}`
      expect(inlineEmoteImageSource(url, { height: 28, scale: 1, backendUrl })).toBe(url)
    }
    for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(inlineEmoteImageSource(source, { height, scale: 1 })).toBe(source)
  })
})
