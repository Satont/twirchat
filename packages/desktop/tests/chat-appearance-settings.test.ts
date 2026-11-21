import { expect, test } from 'bun:test'

import { DEFAULT_SETTINGS } from '@twirchat/shared/types'

test('defaults the chat label, session emote cache, and localized username display mode', () => {
  expect(DEFAULT_SETTINGS.showChannelLabel).toBe(true)
  expect(DEFAULT_SETTINGS.emoteSessionCache).toBe(true)
  expect(DEFAULT_SETTINGS.usernameDisplayMode).toBe('localized-and-username')
})
