import { expect, spyOn, test } from 'bun:test'

import { SevenTVCache } from '../src/seventv/cache'
import { sevenTVChannelKey } from '../src/seventv/channel-key'

test('7TV cache keeps stale snapshots by identity until the expiry sweep', () => {
  const cache = new SevenTVCache()
  const clock = spyOn(Date, 'now').mockReturnValue(1_000)
  const snapshot = {
    id: 'set',
    name: 'Set',
    emotes: new Map(),
  } satisfies Parameters<SevenTVCache['set']>[1]
  try {
    cache.set(sevenTVChannelKey('kick', 'viewer'), snapshot)
    clock.mockReturnValue(301_000)
    expect(cache.isExpired(sevenTVChannelKey('kick', 'viewer'))).toBe(false)
    cache.cleanup()
    expect(cache.get(sevenTVChannelKey('kick', 'viewer'))).toBe(snapshot)
    clock.mockReturnValue(301_001)
    expect(cache.isExpired(sevenTVChannelKey('kick', 'viewer'))).toBe(true)
    expect(cache.get(sevenTVChannelKey('kick', 'viewer'))).toBe(snapshot)
    cache.cleanup()
    expect(cache.get(sevenTVChannelKey('kick', 'viewer'))).toBeUndefined()
  } finally {
    clock.mockRestore()
  }
})
