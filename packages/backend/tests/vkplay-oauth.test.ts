import { expect, test } from 'bun:test'

import { buildVkPlayAuthUrl, isVkPlayOAuthConfigured } from '../src/auth/vkplay'

test('VK Play Live OAuth stays unavailable until the backend holds app credentials', () => {
  expect(isVkPlayOAuthConfigured()).toBe(false)
  expect(() => buildVkPlayAuthUrl('state', 'http://127.0.0.1:9/auth/vkplay/callback')).toThrow(
    'VK Play Live OAuth is not configured',
  )
})
