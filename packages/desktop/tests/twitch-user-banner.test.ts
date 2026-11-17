import { describe, expect, test } from 'bun:test'

import { getTwitchUserBanner } from '../src/services/twitch-user-profile'

const bannerUrl = 'https://static-cdn.jtvnw.net/jtv_user_pictures/fixture-profile_banner-480.jpeg'

function requestBody(init: RequestInit): unknown {
  if (typeof init.body !== 'string') throw new Error('Expected a JSON request body')
  return JSON.parse(init.body)
}

describe('Twitch user banner', () => {
  test('requests the banner anonymously for the lowercased login', async () => {
    const url = await getTwitchUserBanner('Channel_Owner', async (requestUrl, init) => {
      expect(requestUrl).toBe('https://gql.twitch.tv/gql')
      expect(init.method).toBe('POST')
      expect(init.credentials).toBe('omit')
      expect(init.redirect).toBe('error')
      const headers = new Headers(init.headers)
      expect(headers.has('authorization')).toBe(false)
      expect(headers.get('client-id')).toBeTruthy()
      expect(requestBody(init)).toEqual({
        query: 'query UserBanner($login: String!) { user(login: $login) { bannerImageURL } }',
        variables: { login: 'channel_owner' },
      })
      return Response.json({ data: { user: { bannerImageURL: bannerUrl } } })
    })

    expect(url).toBe(bannerUrl)
  })

  test('returns no banner when Twitch has none', async () => {
    const url = await getTwitchUserBanner('viewer', async () =>
      Response.json({ data: { user: { bannerImageURL: null } } }),
    )
    expect(url).toBeUndefined()
  })

  test('skips invalid logins without a request', async () => {
    let requests = 0
    const request = async () => {
      requests++
      return Response.json({ data: { user: null } })
    }
    expect(await getTwitchUserBanner(undefined, request)).toBeUndefined()
    expect(await getTwitchUserBanner('', request)).toBeUndefined()
    expect(await getTwitchUserBanner('not a login', request)).toBeUndefined()
    expect(requests).toBe(0)
  })

  test('rejects transport failures and malformed responses', async () => {
    await expect(
      getTwitchUserBanner('viewer', async () => new Response(null, { status: 500 })),
    ).rejects.toThrow('HTTP 500')
    await expect(
      getTwitchUserBanner('viewer', async () =>
        Response.json({ data: { user: { bannerImageURL: 'file:///tmp/banner.png' } } }),
      ),
    ).rejects.toThrow()
  })
})
