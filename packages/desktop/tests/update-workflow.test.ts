import { expect, test } from 'bun:test'
import { checkForAvailableUpdate } from '../src/views/main/services/update-workflow'

test('checks for an update without starting its download', async () => {
  let downloadStarted = false

  const result = await checkForAvailableUpdate({
    async checkForUpdate() {
      return { currentVersion: '0.10.7', updateAvailable: true, version: '0.10.8' }
    },
    async downloadUpdate() {
      downloadStarted = true
      return { success: true }
    },
  })

  expect(result).toEqual({ currentVersion: '0.10.7', updateAvailable: true, version: '0.10.8' })
  expect(downloadStarted).toBe(false)
})
