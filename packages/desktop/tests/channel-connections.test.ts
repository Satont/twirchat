import { expect, test } from 'bun:test'
import { applySavedChannels } from '../src/views/main/utils/channel-connections'

test('applySavedChannels replaces every platform snapshot after OAuth', () => {
  const current: Record<string, string[]> = {
    kick: [],
    twitch: ['old-channel'],
    youtube: ['stale-channel'],
  }

  applySavedChannels(current, { kick: ['satont'], twitch: ['justovich221337'] })

  expect(current).toEqual({
    kick: ['satont'],
    twitch: ['justovich221337'],
    youtube: [],
  })
})
