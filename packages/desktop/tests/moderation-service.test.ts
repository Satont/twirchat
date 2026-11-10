import { describe, expect, mock, test } from 'bun:test'

import { createModerationService } from '../src/services/moderation/service.ts'
import { literal } from './fixture-values'

const baseInput = literal({
  accessToken: 'token',
  clientId: 'public-client',
  channelSlug: 'streamer',
  platformUserId: '42',
  scopes: [
    'user:read:moderated_channels',
    'moderator:manage:chat_messages',
    'moderator:manage:banned_users',
  ],
})

function createService() {
  const twitch = {
    banUser: mock(async () => ({
      createdAt: new Date(),
      isPermanent: false,
      platform: literal('twitch'),
      success: true,
      userId: '77',
    })),
    deleteMessage: mock(async () => ({
      messageId: 'message-id',
      platform: literal('twitch'),
      success: true,
    })),
    isModerator: mock(async () => ({
      isModerator: true,
      platform: literal('twitch'),
      userId: '42',
    })),
  }
  return {
    service: createModerationService({
      resolveTwitchBroadcasterUserId: async () => '100',
      twitch,
    }),
    twitch,
  }
}

describe('desktop moderation service', () => {
  test('confirms Twitch moderation only for a moderator with all rail scopes', async () => {
    const { service, twitch } = createService()

    await expect(service.getCapabilities(baseInput)).resolves.toEqual({
      canModerate: true,
    })
    expect(twitch.isModerator).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token', clientId: 'public-client' }),
      '100',
      '42',
    )
  })

  test('keeps broadcaster moderation available without the moderated-channels read scope', async () => {
    const { service, twitch } = createService()
    expect(
      await service.getCapabilities({
        ...baseInput,
        platformUserId: '100',
        scopes: ['moderator:manage:chat_messages', 'moderator:manage:banned_users'],
      }),
    ).toEqual({ canModerate: true })
    expect(twitch.isModerator).not.toHaveBeenCalled()
  })

  test('requires the actual moderated-channels scope for a watched moderator check', async () => {
    const { service, twitch } = createService()
    expect(
      await service.getCapabilities({
        ...baseInput,
        scopes: [
          'moderator:read:moderators',
          'moderator:manage:chat_messages',
          'moderator:manage:banned_users',
        ],
      }),
    ).toEqual({ canModerate: false })
    expect(twitch.isModerator).not.toHaveBeenCalled()
  })

  test('requires only the relevant identity for each action and permits one-second Twitch timeouts', async () => {
    const { service, twitch } = createService()
    await service.execute({
      ...baseInput,
      action: 'delete_message',
      messageId: 'only-message-id',
      scopes: ['moderator:manage:chat_messages'],
    })
    await service.execute({
      ...baseInput,
      action: 'timeout',
      targetUserId: '77',
      durationSeconds: 1,
      scopes: ['moderator:manage:banned_users'],
    })
    expect(twitch.deleteMessage).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token', clientId: 'public-client' }),
      '100',
      '42',
      'only-message-id',
    )
    expect(twitch.banUser).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token', clientId: 'public-client' }),
      '100',
      '42',
      {
        duration: 1,
        user_id: '77',
      },
    )
  })

  test('dispatches delete and timeout to distinct Twitch provider operations', async () => {
    const { service, twitch } = createService()

    await service.execute({
      ...baseInput,
      action: 'delete_message',
      messageId: 'message-id',
      targetUserId: '77',
    })
    await service.execute({
      ...baseInput,
      action: 'timeout',
      durationSeconds: 300,
      messageId: 'message-id',
      targetUserId: '77',
    })

    expect(twitch.deleteMessage).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token', clientId: 'public-client' }),
      '100',
      '42',
      'message-id',
    )
    expect(twitch.banUser).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token', clientId: 'public-client' }),
      '100',
      '42',
      {
        duration: 300,
        user_id: '77',
      },
    )
  })
})
