import { expect, test } from 'bun:test'
import { shouldCheckForUpdates } from '../src/views/main/services/update-capability'

test('does not invoke updater flow when the Wails capability disables updates', async () => {
  await expect(
    shouldCheckForUpdates({ capabilities: async () => ({ updates: false }) }),
  ).resolves.toBe(false)
})

test('does not check for updates when the user disables automatic checks', async () => {
  let capabilitiesCalled = false

  await expect(
    shouldCheckForUpdates(
      {
        capabilities: async () => {
          capabilitiesCalled = true
          return { updates: true }
        },
      },
      false,
    ),
  ).resolves.toBe(false)

  expect(capabilitiesCalled).toBe(false)
})
