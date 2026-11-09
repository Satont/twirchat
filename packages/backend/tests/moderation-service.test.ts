import { describe, expect, mock, test } from 'bun:test'

import { createModerationService } from '../src/api/moderation/service.ts'
import { literal } from './literal'

const baseInput = literal({
  accessToken: 'token',
  channelSlug: 'streamer',
  platformUserId: '42',
  scopes: [
    'user:read:moderated_channels',
    'moderator:manage:chat_messages',
    'moderator:manage:banned_users',
  ],
})

function createService() {
  const kick = {
    banUser: mock(async () => ({
      createdAt: new Date(),
      isPermanent: false,
      platform: literal('kick'),
      success: true,
      userId: '77',
    })),
    deleteMessage: mock(async () => ({
      messageId: 'message-id',
      platform: literal('kick'),
      success: true,
    })),
  }

  return {
    kick,
    service: createModerationService({
      kick,
      resolveKickBroadcasterUserId: async () => 99,
    }),
  }
}

describe('Kick moderation service', () => {
  test('does not enable a watched Kick rail without both action scopes', async () => {
    const { service } = createService()

    await expect(
      service.getCapabilities({
        ...baseInput,
        platform: 'kick',
        scopes: ['moderation:ban'],
      }),
    ).resolves.toEqual({ canModerate: false })
  })

  test('converts rail seconds to valid Kick minutes and preserves a permanent ban', async () => {
    const { kick, service } = createService()
    const kickInput = {
      accessToken: 'token',
      channelSlug: 'creator',
      platform: literal('kick'),
      platformUserId: '42',
      scopes: ['moderation:chat_message:manage', 'moderation:ban'],
    }

    await service.execute({
      ...kickInput,
      action: 'timeout',
      durationSeconds: 300,
      messageId: 'message-id',
      targetUserId: '77',
    })
    await service.execute({
      ...kickInput,
      action: 'ban',
      messageId: 'message-id',
      targetUserId: '77',
    })

    expect(kick.banUser).toHaveBeenNthCalledWith(1, 'token', {
      broadcaster_user_id: 99,
      duration: 5,
      user_id: 77,
    })
    expect(kick.banUser).toHaveBeenNthCalledWith(2, 'token', {
      broadcaster_user_id: 99,
      user_id: 77,
    })
  })

  test('rejects a timeout that exceeds the platform maximum before a provider call', async () => {
    const { kick, service } = createService()

    await expect(
      service.execute({
        accessToken: 'token',
        action: 'timeout',
        channelSlug: 'creator',
        durationSeconds: 604_860,
        messageId: 'message-id',
        platform: 'kick',
        platformUserId: '42',
        scopes: ['moderation:ban'],
        targetUserId: '77',
      }),
    ).rejects.toThrow('timeout duration exceeds the Kick maximum')
    expect(kick.banUser).not.toHaveBeenCalled()
  })
})
