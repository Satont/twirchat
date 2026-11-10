import { expect, test } from 'bun:test'

import { VKPLAY_REDIRECT_URI } from '@twirchat/shared/constants'

import { getVkPlayAuthUrl, handleVkPlayToken, vkPlayCallbackPage } from '../src/auth/vkplay'
import { AccountStore } from '../src/store/account-store'
import { initDb } from '../src/store/db'

test('VK Play Live uses ImplicitFlow with a public client and no secret', () => {
  process.env.TWIRCHAT_VKPLAY_CLIENT_ID = 'vkplay-public-client'
  try {
    const url = new URL(getVkPlayAuthUrl())
    expect(url.origin + url.pathname).toBe('https://auth.live.vkvideo.ru/app/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('vkplay-public-client')
    expect(url.searchParams.get('response_type')).toBe('token')
    expect(url.searchParams.get('scope')).toBe('chat:message:send')
    expect(url.searchParams.get('redirect_uri')).toBe(VKPLAY_REDIRECT_URI)
    expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]{32}$/)
  } finally {
    delete process.env.TWIRCHAT_VKPLAY_CLIENT_ID
  }
})

test('VK Play Live callback reads the token from the URL fragment', () => {
  expect(vkPlayCallbackPage().headers.get('content-type')).toContain('text/html')
})

test('VK Play Live rejects an incomplete implicit token before any request', async () => {
  await expect(handleVkPlayToken(new URLSearchParams())).rejects.toThrow('incomplete token')
  await expect(
    handleVkPlayToken(
      new URLSearchParams({
        access_token: 'token',
        expire_time: String(Math.floor(Date.now() / 1000) + 3600),
        state: 'state',
        token_type: 'Bearer',
      }),
    ),
  ).rejects.toThrow('Unknown or expired VK Play Live OAuth state')
})

test('stores the account from a complete implicit token', async () => {
  initDb(':memory:')
  process.env.TWIRCHAT_VKPLAY_CLIENT_ID = 'vkplay-public-client'
  const originalFetch = globalThis.fetch
  globalThis.fetch = Object.assign(
    async () =>
      Response.json({
        data: {
          channel: { url: 'streamer' },
          user: {
            avatar_url: 'https://images.live.vkvideo.ru/user/1/avatar',
            id: 1,
            nick: 'Streamer',
          },
        },
      }),
    { preconnect: originalFetch.preconnect },
  )
  try {
    const state = new URL(getVkPlayAuthUrl()).searchParams.get('state')
    const result = await handleVkPlayToken(
      new URLSearchParams({
        access_token: 'implicit-token',
        expire_time: String(Math.floor(Date.now() / 1000) + 3600),
        state: state ?? '',
        token_type: 'Bearer',
      }),
    )
    expect(result.channelSlug).toBe('streamer')
    expect(result.user).toEqual({
      displayName: 'Streamer',
      platform: 'vkplay',
      username: 'streamer',
    })
    expect(AccountStore.findByPlatform('vkplay')).toMatchObject({
      displayName: 'Streamer',
      id: 'vkplay:1',
      platform: 'vkplay',
      platformUserId: '1',
      username: 'streamer',
    })
    expect(AccountStore.getTokens('vkplay:1')).toMatchObject({
      accessToken: 'implicit-token',
      refreshToken: undefined,
    })
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.TWIRCHAT_VKPLAY_CLIENT_ID
  }
})
