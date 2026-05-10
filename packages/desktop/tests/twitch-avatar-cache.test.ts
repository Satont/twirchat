import { describe, expect, mock, test } from 'bun:test'

import { createTwitchAvatarResolver } from '../src/platforms/twitch/avatar-cache'

describe('createTwitchAvatarResolver', () => {
  test('fetches avatar from backend twitch user endpoint and caches it', async () => {
    const calls: string[] = []
    const resolver = createTwitchAvatarResolver({
      fetchFn: mock(async (input: string | URL | Request) => {
        const url = String(input)
        calls.push(url)

        return Response.json({
          user: {
            profile_image_url: 'https://example.com/avatar.png',
          },
        })
      }) as unknown as typeof fetch,
    })

    const first = await resolver({ authorId: '12345' })
    const second = await resolver({ authorId: '12345' })

    expect(first).toBe('https://example.com/avatar.png')
    expect(second).toBe('https://example.com/avatar.png')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/api/twitch/user?userId=12345')
  })
})
