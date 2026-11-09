import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { obsRemoteApi } from '../src/gpuix/backend/obs-remote'
import { initDb } from '../src/store/db'

test('OBS connection links separate the password from the WebSocket endpoint', () => {
  expect(obsRemoteApi.parseAddress(' studio.local:4455 ')).toEqual({
    url: 'ws://studio.local:4455/',
  })
  expect(obsRemoteApi.parseAddress('obswss://studio.example:443/p%40ss%2Fword')).toEqual({
    url: 'wss://studio.example/',
    password: 'p@ss/word',
  })
  expect(() => obsRemoteApi.parseAddress('ws://user:password@studio.local:4455')).toThrow()
  expect(() => obsRemoteApi.parseAddress('https://studio.example')).toThrow()
})

test('OBS connections survive reopening the database and never expose stored passwords', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twirchat-obs-profiles-'))
  const path = join(directory, 'profile.sqlite')
  let db = initDb(path)
  try {
    const password = 'obs profile test secret'
    await Promise.all([
      obsRemoteApi.save({ name: 'Studio', url: 'ws://localhost:4455', password }),
      obsRemoteApi.save({ name: 'Backup', url: 'wss://backup.example/socket' }),
    ])
    db.close()
    db = initDb(path)

    const profiles = await obsRemoteApi.list()
    expect(profiles).toHaveLength(2)
    const studio = profiles.find(({ name }) => name === 'Studio')
    if (!studio) throw new Error('Studio connection did not survive reopening the database.')
    expect(studio).toEqual({
      id: studio.id,
      name: 'Studio',
      url: 'ws://localhost:4455/',
      hasPassword: true,
    })
    const identity = db.query('SELECT value FROM client_identity').all()
    expect(JSON.stringify(identity)).not.toContain(password)

    await obsRemoteApi.save({ ...studio, name: 'Streaming PC' })
    expect(await obsRemoteApi.list()).toContainEqual({ ...studio, name: 'Streaming PC' })
    await obsRemoteApi.save({ ...studio, password: '' })
    expect(await obsRemoteApi.list()).toContainEqual({ ...studio, hasPassword: false })
    expect(await obsRemoteApi.remove(studio.id)).toHaveLength(1)
  } finally {
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
})
