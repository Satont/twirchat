import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_MODERATION_SETTINGS,
  validateModerationSettings,
} from '@twirchat/shared/user-profile'

import {
  getUserNotes,
  setUserNotes,
  getModerationSettings,
  saveModerationSettings,
} from '../src/gpuix/backend/user-preferences'
import { initDb } from '../src/store/db'
import { literal, required } from './fixture-values'
let directory: string
let db: Database
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'twirchat-user-notes-'))
  db = initDb(join(directory, 'notes.sqlite'))
})
afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})
describe('local user notes and moderation settings', () => {
  test('notes survive reopening and remain isolated by platform and numeric ID', () => {
    const target = { platform: literal('twitch'), platformUserId: '123' }
    expect(getUserNotes(target)).toBe('')
    setUserNotes({ ...target, text: '# Note\nПривет **world**\n<script>literal</script>' })
    db.close()
    db = initDb(join(directory, 'notes.sqlite'))
    expect(getUserNotes(target)).toBe('# Note\nПривет **world**\n<script>literal</script>')
    expect(getUserNotes({ ...target, platform: 'kick' })).toBe('')
    expect(getUserNotes({ ...target, platformUserId: '124' })).toBe('')
    setUserNotes({ ...target, text: '' })
    expect(getUserNotes(target)).toBe('')
  })
  test('oversized or invalid notes cannot overwrite saved notes', () => {
    const target = { platform: literal('twitch'), platformUserId: '123' }
    setUserNotes({ ...target, text: 'keep' })
    expect(() => setUserNotes({ ...target, text: 'a'.repeat(50001) })).toThrow()
    expect(() => setUserNotes({ ...target, platformUserId: '', text: 'bad' })).toThrow()
    expect(getUserNotes(target)).toBe('keep')
  })
  test('eight customized durations and reasons persist, invalid edits retain last settings', () => {
    const defaults = getModerationSettings()
    expect(defaults).toEqual(DEFAULT_MODERATION_SETTINGS)
    defaults.timeouts[0] = { label: 'Quick', seconds: 7 }
    defaults.reasons = ['Custom reason']
    defaults.defaultReason = 'Custom reason'
    saveModerationSettings(defaults)
    expect(getModerationSettings()).toEqual(defaults)
    expect(() => saveModerationSettings({ ...defaults, timeouts: [] })).toThrow('eight')
    expect(getModerationSettings()).toEqual(defaults)
    expect(required(DEFAULT_MODERATION_SETTINGS.timeouts[0]).seconds).toBe(1)
  })
  test.each([0, -1, 1209601, 1.5, NaN])('rejects invalid timeout seconds %s', (seconds) => {
    const input = structuredClone(DEFAULT_MODERATION_SETTINGS)
    required(input.timeouts[0]).seconds = seconds
    expect(() => validateModerationSettings(input)).toThrow()
  })
})
