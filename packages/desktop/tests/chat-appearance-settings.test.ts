import { expect, test } from 'bun:test'
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'

test('defaults the chat label and session emote cache on', () => {
  expect(DEFAULT_SETTINGS.showChannelLabel).toBe(true)
  expect(DEFAULT_SETTINGS.emoteSessionCache).toBe(true)
})
