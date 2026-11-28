import { expect, spyOn, test } from 'bun:test'

import { SevenTVCache } from '../src/seventv/cache'

test('7TV cache keeps stale snapshots by identity until the expiry sweep', () => {
  const cache = new SevenTVCache()
  const clock = spyOn(Date, 'now').mockReturnValue(1_000)
  const snapshot = {
    platform: 'kick',
    channelId: 'viewer',
    id: 'set',
    name: 'Set',
    emotes: new Map(),
  } satisfies Parameters<SevenTVCache['set']>[2]
  try {
    cache.set('kick', 'viewer', snapshot)
    clock.mockReturnValue(301_000)
    expect(cache.isExpired('kick', 'viewer')).toBe(false)
    cache.cleanup()
    expect(cache.get('kick', 'viewer')).toBe(snapshot)
    clock.mockReturnValue(301_001)
    expect(cache.isExpired('kick', 'viewer')).toBe(true)
    expect(cache.get('kick', 'viewer')).toBe(snapshot)
    cache.cleanup()
    expect(cache.get('kick', 'viewer')).toBeUndefined()
  } finally {
    clock.mockRestore()
  }
})
