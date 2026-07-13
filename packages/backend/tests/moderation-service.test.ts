import { describe, expect, mock, test } from 'bun:test'
import { createModerationService } from '../src/api/moderation/service.ts'

const baseInput = {
  accessToken: 'token',
  channelSlug: 'streamer',
  platformUserId: '42',
  scopes: [
    'moderator:read:moderators',
    'moderator:manage:chat_messages',
    'moderator:manage:banned_users',
  ],
} as const

function createService() {
  const twitch = {
    banUser: mock(async () => ({
      createdAt: new Date(),
      isPermanent: false,
      platform: 'twitch' as const,
      success: true,
      userId: '77',
    })),
    deleteMessage: mock(async () => ({
      messageId: 'message-id',
      platform: 'twitch' as const,
      success: true,
    })),
    isModerator: mock(async () => ({
      isModerator: true,
      platform: 'twitch' as const,
      userId: '42',
    })),
  }
  const kick = {
    banUser: mock(async () => ({
      createdAt: new Date(),
      isPermanent: false,
      platform: 'kick' as const,
      success: true,
      userId: '77',
    })),
    deleteMessage: mock(async () => ({
      messageId: 'message-id',
      platform: 'kick' as const,
      success: true,
    })),
  }

  return {
    kick,
    service: createModerationService({
      kick,
      resolveKickBroadcasterUserId: async () => 99,
      resolveTwitchBroadcasterUserId: async () => '100',
      twitch,
    }),
    twitch,
  }
}

describe('desktop moderation service', () => {
  test('confirms Twitch moderation only for a moderator with all rail scopes', async () => {
    const { service, twitch } = createService()

    await expect(service.getCapabilities({ ...baseInput, platform: 'twitch' })).resolves.toEqual({
      canModerate: true,
    })
    expect(twitch.isModerator).toHaveBeenCalledWith('token', '100', '42')
  })

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

  test('dispatches delete and timeout to distinct Twitch provider operations', async () => {
    const { service, twitch } = createService()

    await service.execute({
      ...baseInput,
      action: 'delete_message',
      messageId: 'message-id',
      platform: 'twitch',
      targetUserId: '77',
    })
    await service.execute({
      ...baseInput,
      action: 'timeout',
      durationSeconds: 300,
      messageId: 'message-id',
      platform: 'twitch',
      targetUserId: '77',
    })

    expect(twitch.deleteMessage).toHaveBeenCalledWith('token', '100', '42', 'message-id')
    expect(twitch.banUser).toHaveBeenCalledWith('token', '100', '42', {
      duration: 300,
      user_id: '77',
    })
  })

  test('converts rail seconds to valid Kick minutes and preserves a permanent ban', async () => {
    const { kick, service } = createService()
    const kickInput = {
      accessToken: 'token',
      channelSlug: 'creator',
      platform: 'kick' as const,
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
