import { expect, test } from 'bun:test'

import { APP_VERSION } from '../src/build-info'
import { createDesktopEvents } from '../src/gpuix/backend/events'
import { createUpdater } from '../src/gpuix/backend/updater'

test('build-info falls back to dev without CI --define', () => {
  expect(APP_VERSION).toBe('dev')
})

test('updater is a no-op in dev builds', async () => {
  const updater = createUpdater(createDesktopEvents())

  expect(await updater.check()).toEqual({ updateAvailable: false, currentVersion: 'dev' })
  expect((await updater.download()).success).toBe(false)
})
