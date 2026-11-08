import { describe, expect, test } from 'bun:test'

import { loadPendingChangelog } from '../src/gpuix/update-changelog'

interface FakeReleaseNotes {
  version: string
  releaseNotes: string
  publishedAt: string
}

interface Calls {
  lastSeen: number
  notes: string[]
  set: string[]
}

function createApi(options: { lastSeen: string | null; notes: FakeReleaseNotes | null }) {
  const calls: Calls = { lastSeen: 0, notes: [], set: [] }
  const api = {
    getLastSeenVersion: async () => {
      calls.lastSeen++
      return options.lastSeen
    },
    getReleaseNotes: async ({ version }: { version: string }) => {
      calls.notes.push(version)
      return options.notes
    },
    setLastSeenVersion: async ({ version }: { version: string }) => {
      calls.set.push(version)
    },
  }
  return { api, calls }
}

describe('loadPendingChangelog', () => {
  test('does nothing for dev builds', async () => {
    const { api, calls } = createApi({ lastSeen: null, notes: null })

    expect(await loadPendingChangelog('dev', api)).toBeNull()
    expect(calls).toEqual({ lastSeen: 0, notes: [], set: [] })
  })

  test('does nothing when the version was already seen', async () => {
    const { api, calls } = createApi({ lastSeen: '1.7.1', notes: null })

    expect(await loadPendingChangelog('1.7.1', api)).toBeNull()
    expect(calls).toEqual({ lastSeen: 1, notes: [], set: [] })
  })

  test('does not mark the version as seen when release notes are unavailable', async () => {
    const { api, calls } = createApi({ lastSeen: '1.7.0', notes: null })

    expect(await loadPendingChangelog('1.7.1', api)).toBeNull()
    expect(calls.notes).toEqual(['1.7.1'])
    expect(calls.set).toEqual([])
  })

  test('shows notes for a new version and then marks it as seen', async () => {
    const notes = {
      version: '1.7.1',
      releaseNotes: "## What's Changed\n* Fix scrolling",
      publishedAt: '2026-11-08T17:20:39Z',
    }
    const { api, calls } = createApi({ lastSeen: '1.7.0', notes })

    expect(await loadPendingChangelog('1.7.1', api)).toEqual(notes)
    expect(calls.set).toEqual(['1.7.1'])
  })

  test('shows notes on the first launch after installing', async () => {
    const notes = {
      version: '1.7.1',
      releaseNotes: 'Changes',
      publishedAt: '2026-11-08T17:20:39Z',
    }
    const { api, calls } = createApi({ lastSeen: null, notes })

    expect(await loadPendingChangelog('1.7.1', api)).toEqual(notes)
    expect(calls.set).toEqual(['1.7.1'])
  })

  test('preview always shows notes and never marks the version as seen', async () => {
    const notes = {
      version: '1.7.1',
      releaseNotes: 'Changes',
      publishedAt: '2026-11-08T17:20:39Z',
    }
    const { api, calls } = createApi({ lastSeen: '1.7.1', notes })

    expect(await loadPendingChangelog('1.7.1', api, { preview: true })).toEqual(notes)
    expect(calls).toEqual({ lastSeen: 0, notes: ['1.7.1'], set: [] })
  })
})
