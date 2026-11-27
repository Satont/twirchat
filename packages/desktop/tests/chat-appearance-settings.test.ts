import { expect, test } from 'bun:test'

import { DEFAULT_SETTINGS } from '@twirchat/shared/types'

test('defaults the chat label, session emote cache, localized username display mode, and mention avatar style', () => {
  expect(DEFAULT_SETTINGS.showChannelLabel).toBe(true)
  expect(DEFAULT_SETTINGS.emoteSessionCache).toBe(true)
  expect(DEFAULT_SETTINGS.usernameDisplayMode).toBe('localized-and-username')
  expect(DEFAULT_SETTINGS.mentionAvatarStyle).toBe('pill')
  expect(DEFAULT_SETTINGS.showMentionAvatar).toBe(true)
})
