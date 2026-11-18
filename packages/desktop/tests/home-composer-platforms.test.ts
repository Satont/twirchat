import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLayoutApi } from '../src/gpuix/backend/layout-api'
import { createHomeComposerPlatformPreferences } from '../src/gpuix/state/home-composer-platforms'
import { initDb } from '../src/store/db'

test('restores the latest My channels platform selection from SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'twirchat-home-composer-'))
  const path = join(directory, 'profile.sqlite')
  let db = initDb(path)
  try {
    const api = createLayoutApi()
    const preferences = createHomeComposerPlatformPreferences()
    await preferences.load(api)
    expect(preferences.store.get().value).toEqual([])

    await Promise.all([preferences.save(api, ['kick', 'youtube']), preferences.save(api, ['kick'])])
    db.close()
    db = initDb(path)

    const restored = createHomeComposerPlatformPreferences()
    await restored.load(createLayoutApi())
    expect(restored.store.get().value).toEqual(['kick'])
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
