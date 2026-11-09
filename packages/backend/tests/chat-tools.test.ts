import { describe, expect, test } from 'bun:test'

import { createChatToolsService, type ChatToolsInput } from '../src/api/chat-tools'
import { chatToolsRoutes } from '../src/routes/chat-tools'
import { textBody } from './literal'
import { literal, required } from './literal'

const input: ChatToolsInput = {
  platform: 'kick',
  channelSlug: 'creator',
  accessToken: 'token',
  platformUserId: '42',
  scopes: ['moderation:ban', 'moderation:chat_message:manage'],
}

function fixture(response: () => Response = () => Response.json({ data: [] })) {
  const calls: { url: URL; init: RequestInit }[] = []
  const service = createChatToolsService({
    async fetch(url, init) {
      calls.push({ url: new URL(url), init: init ?? {} })
      return response()
    },
    async resolveKickUserId(identifier) {
      return identifier === 'creator' ? 100 : 200
    },
  })
  return { service, calls }
}

describe('Kick commands', () => {
  for (const text of ['/unban target', '/untimeout target'])
    test(text, async () => {
      const { service, calls } = fixture()
      await service.execute({ ...input, platform: 'kick', scopes: ['moderation:ban'], text })
      expect(required(calls[0]).url.toString()).toBe(
        'https://api.kick.com/public/v1/moderation/bans',
      )
      expect(required(calls[0]).init.method).toBe('DELETE')
      expect(JSON.parse(textBody(required(calls[0]).init.body))).toEqual({
        broadcaster_user_id: 100,
        user_id: 200,
      })
    })
  test('sends timeouts in whole minutes and omits duration for permanent bans', async () => {
    const { service, calls } = fixture()
    const kick = { ...input, platform: literal('kick'), scopes: ['moderation:ban'] }
    await service.execute({ ...kick, text: '/timeout target 90 reason' })
    await service.execute({ ...kick, text: '/ban target reason' })
    expect(JSON.parse(textBody(required(calls[0]).init.body))).toEqual({
      broadcaster_user_id: 100,
      user_id: 200,
      duration: 2,
      reason: 'reason',
    })
    expect(JSON.parse(textBody(required(calls[1]).init.body))).toEqual({
      broadcaster_user_id: 100,
      user_id: 200,
      reason: 'reason',
    })
  })
  test('deletes a message with its own scope and rejects unavailable commands', async () => {
    const { service, calls } = fixture()
    const kick = { ...input, platform: literal('kick'), scopes: ['moderation:chat_message:manage'] }
    await service.execute({ ...kick, text: '/delete msg-id' })
    expect(required(calls[0]).url.toString()).toBe('https://api.kick.com/public/v1/chat/msg-id')
    expect(required(calls[0]).init.method).toBe('DELETE')
    await expect(service.execute({ ...kick, text: '/slow 20' })).rejects.toThrow('unavailable')
    await expect(service.execute({ ...kick, text: '/ban target' })).rejects.toThrow(
      'moderation:ban',
    )
    await expect(
      service.execute({ ...kick, scopes: ['moderation:ban'], text: '/timeout target -5' }),
    ).rejects.toThrow('Invalid timeout duration')
    expect(calls).toHaveLength(1)
  })
})

test('platform command endpoints require a desktop client', async () => {
  for (const handlers of Object.values(chatToolsRoutes)) {
    const response = await handlers.POST(
      new Request('http://localhost/api/chat-tools/command', { method: 'POST', body: '{}' }),
    )
    expect(response.status).toBe(401)
  }
})
