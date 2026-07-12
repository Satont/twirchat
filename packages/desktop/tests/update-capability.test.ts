import { expect, test } from 'bun:test'
import { shouldCheckForUpdates } from '../src/views/main/services/update-capability'

test('does not invoke updater flow when the Wails capability disables updates', async () => {
  await expect(
    shouldCheckForUpdates({ capabilities: async () => ({ updates: false }) }),
  ).resolves.toBe(false)
})
