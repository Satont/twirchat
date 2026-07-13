import { expect, test } from 'bun:test'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { createAvatarCache } from '../src/views/main/composables/useAvatarCache'

function message(avatarUrl?: string): NormalizedChatMessage {
  return {
    id: 'message-1',
    platform: 'twitch',
    channelId: 'streamer',
    author: {
      id: 'viewer-7',
      username: 'viewer',
      displayName: 'Viewer',
      ...(avatarUrl ? { avatarUrl } : {}),
      badges: [],
    },
    text: 'hello',
    emotes: [],
    timestamp: new Date('2026-07-13T12:00:00.000Z'),
    type: 'message',
  }
}

test('renders fallback immediately then reuses one completed background avatar lookup', async () => {
  let resolveLookup: ((value: { avatarUrl: string }) => void) | undefined
  let calls = 0
  const cache = createAvatarCache(
    () =>
      new Promise((resolve: (value: { avatarUrl: string }) => void) => {
        calls += 1
        resolveLookup = resolve
      }),
  )
  const first = message()
  const later = { ...message(), id: 'message-2' }

  expect(cache.avatarUrlFor(first)).toBeUndefined()
  cache.ensureAvatar(first)
  cache.ensureAvatar(later)
  expect(calls).toBe(1)

  resolveLookup?.({ avatarUrl: 'https://cdn.test/viewer.png' })
  await Promise.resolve()

  expect(cache.avatarUrlFor(first)).toBe('https://cdn.test/viewer.png')
  expect(cache.avatarUrlFor(later)).toBe('https://cdn.test/viewer.png')
})

test('seeds a supplied Kick profile picture without a backend lookup', () => {
  let calls = 0
  const cache = createAvatarCache(async () => {
    calls += 1
    return { avatarUrl: 'https://cdn.test/unused.png' }
  })
  const kickMessage = { ...message('https://cdn.test/kick.png'), platform: 'kick' as const }

  cache.ensureAvatar(kickMessage)

  expect(cache.avatarUrlFor(kickMessage)).toBe('https://cdn.test/kick.png')
  expect(calls).toBe(0)
})
