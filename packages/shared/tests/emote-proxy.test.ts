import { expect, test } from 'bun:test'

import {
  providerImageProxyPath,
  providerImageSource,
  providerMetadataTarget,
  proxiedProviderImage,
} from '../emote-proxy'

test('provider relay preserves exact emote formats, variant queries and provider paths', () => {
  for (const url of [
    'https://cdn.7tv.app/emote/01GBFAYKGR000FWWN7MDZZ8XQN/4x.gif',
    'https://cdn.7tv.io/paint/abc/layer/2x.avif',
    'https://cdn.betterttv.net/emote/abc/3x.webp',
    'https://cdn.betterttv.net/assets/badges/developer.svg',
    'https://cdn.betterttv.net/badges/developer.svg',
    'https://cdn.frankerfacez.com/room/123/mod/4',
    'https://cdn.frankerfacez.com/mod.png',
    'https://cdn.frankerfacez.com/emoticon/123/animated/4',
    'https://cdn.frankerfacez.com/animated/123/4',
    'https://cdn.frankerfacez.com/badge/1/4?variant=dark',
  ]) {
    expect(providerImageSource(url)?.href).toBe(url)
    const path = providerImageProxyPath(url)
    expect(path).not.toBeNull()
    expect(new URL('https://backend.invalid' + path).searchParams.get('url')).toBe(url)
    expect(proxiedProviderImage(url, 'https://backend.invalid/')).toBe(
      'https://backend.invalid' + path,
    )
  }
  expect(providerImageSource('//cdn.7tv.app/emote/abc/2x.webp')?.protocol).toBe('https:')
  expect(
    new URL(
      'https://backend.invalid' + providerImageProxyPath('http://cdn.7tv.app/emote/abc/2x.webp'),
    ).searchParams.get('url'),
  ).toBe('https://cdn.7tv.app/emote/abc/2x.webp')
  expect(providerImageProxyPath('https://cdn.7tv.app/unsupported')).toContain(
    '/proxy/provider-image?url=',
  )
})

test('proxy URL conversion leaves unrelated assets and already proxied URLs untouched', () => {
  for (const url of [
    'https://static-cdn.jtvnw.net/emoticons/v2/1/default/dark/3.0',
    'https://backend.invalid/proxy/provider-image?url=example',
    '/tmp/cache/emote.gif',
    'data:image/png;base64,abc',
  ]) {
    expect(providerImageProxyPath(url)).toBeNull()
    expect(proxiedProviderImage(url, 'https://backend.invalid')).toBe(url)
  }
})

test('image and metadata boundaries reject untrusted hosts and unrelated endpoints', () => {
  for (const url of [
    'https://cdn.7tv.app.evil.invalid/emote/abc/2x.webp',
    'https://cdn.7tv.app@evil.invalid/emote/abc/2x.webp',
    'https://name:secret@cdn.7tv.app/emote/abc/2x.webp',
    'http://cdn.7tv.app/emote/abc/2x.webp',
    'https://cdn.7tv.app:3000/emote/abc/2x.webp',
    'https://cdn.7tv.app/emote/abc/2x.webp#fragment',
    'https://cdn.7tv.app/emote/abc/%2fetc',
    'https://cdn.7tv.app/private',
  ])
    expect(providerImageSource(url)).toBeNull()
  expect(providerMetadataTarget('https://7tv.io/v3/emote-sets/global')?.kind).toBe('catalog')
  expect(providerMetadataTarget('https://7tv.io/v4/gql')?.kind).toBe('cosmetics')
  expect(providerMetadataTarget('https://7tv.io/v3/users/abc/presences')?.kind).toBe('presence')
  for (const url of [
    'https://7tv.io/v3/auth',
    'https://7tv.io/v3/emote-sets/global?redirect=evil',
    'https://api.betterttv.net/3/cached/users/twitch/not-numeric',
    'https://api.frankerfacez.com/v1/room/id/../../private',
  ])
    expect(providerMetadataTarget(url)).toBeNull()
})
