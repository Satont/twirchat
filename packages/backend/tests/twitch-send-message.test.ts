import { afterEach, expect, mock, test } from 'bun:test'
import { handleTwitchSendMessage } from '../src/api/twitch-send-message.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('returns Twitch delivery rejection text from a successful HTTP response', async () => {
  globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input)
    if (url.includes('/helix/users'))
      return Response.json({ data: [{ id: '42', login: 'stray228' }] })
    return Response.json({
      data: [
        {
          is_sent: false,
          drop_reason: { code: 'msg_followersonly', message: 'Followers-only mode' },
        },
      ],
    })
  }) as unknown as typeof fetch

  await expect(
    handleTwitchSendMessage(
      new Request('http://localhost/api/twitch/send-message', {
        body: JSON.stringify({
          accessToken: 'token',
          channelLogin: 'stray228',
          message: 'hello',
          senderId: '1',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    ),
  ).resolves.toEqual({ code: 'msg_followersonly', message: 'Followers-only mode', sent: false })
})
