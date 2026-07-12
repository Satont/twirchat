import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, unlinkSync } from 'node:fs'
import { getDb, initDb } from '@desktop/store/db'
import { ChatLayoutStore } from '@desktop/store/chat-layout-store'
import type { ChatLayout, SplitConfig } from '@twirchat/shared/types'

const TEST_DB = '/tmp/twirchat-chat-layout-test.sqlite'

const DEFAULT_LAYOUT: ChatLayout = {
  version: 1,
  mode: 'combined',
  splits: [{ id: 'default', type: 'combined', size: 100 }],
}

describe('ChatLayoutStore', () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }
    initDb(TEST_DB)
  })

  afterEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }
  })

  describe('get()', () => {
    test('returns default layout when nothing is saved', () => {
      const layout = ChatLayoutStore.get()

      expect(layout.version).toBe(1)
      expect(layout.mode).toBe('combined')
      expect(layout.splits).toHaveLength(1)
      expect(layout.splits[0]!.id).toBe('default')
      expect(layout.splits[0]!.type).toBe('combined')
      expect(layout.splits[0]!.size).toBe(100)
    })

    test('default layout has correct structure matching DEFAULT_LAYOUT', () => {
      const layout = ChatLayoutStore.get()

      expect(layout).toMatchObject(DEFAULT_LAYOUT)
    })

    test('returns persisted layout after set()', () => {
      const customLayout: ChatLayout = {
        version: 1,
        mode: 'split',
        splits: [
          { id: 'panel-1', type: 'combined', size: 50 },
          { id: 'panel-2', type: 'channel', channelId: 'twitch:123', size: 50 },
        ],
      }

      ChatLayoutStore.set(customLayout)
      const retrieved = ChatLayoutStore.get()

      expect(retrieved.mode).toBe('split')
      expect(retrieved.splits).toHaveLength(2)
      expect(retrieved.splits[0]!.id).toBe('panel-1')
      expect(retrieved.splits[1]!.id).toBe('panel-2')
      expect(retrieved.splits[1]!.channelId).toBe('twitch:123')
    })

    test('returns independent copy (mutations do not affect store)', () => {
      const layout1 = ChatLayoutStore.get()
      layout1.mode = 'split'

      const layout2 = ChatLayoutStore.get()
      expect(layout2.mode).toBe('combined')
    })
  })

  describe('set()', () => {
    test('persists layout to database', () => {
      const layout: ChatLayout = {
        version: 1,
        mode: 'split',
        splits: [
          { id: 'left', type: 'combined', size: 60 },
          { id: 'right', type: 'channel', channelId: 'kick:abc', size: 40 },
        ],
      }

      ChatLayoutStore.set(layout)

      const db = getDb()
      const row = db
        .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
        .get('chat_layout')

      expect(row).not.toBeNull()
      const parsed = JSON.parse(row!.value) as ChatLayout
      expect(parsed.mode).toBe('split')
      expect(parsed.splits).toHaveLength(2)
    })

    test('overwrites previously saved layout', () => {
      const firstLayout: ChatLayout = {
        version: 1,
        mode: 'combined',
        splits: [{ id: 'default', type: 'combined', size: 100 }],
      }

      const secondLayout: ChatLayout = {
        version: 1,
        mode: 'split',
        splits: [
          { id: 'a', type: 'combined', size: 50 },
          { id: 'b', type: 'combined', size: 50 },
        ],
      }

      ChatLayoutStore.set(firstLayout)
      ChatLayoutStore.set(secondLayout)

      const retrieved = ChatLayoutStore.get()
      expect(retrieved.mode).toBe('split')
      expect(retrieved.splits).toHaveLength(2)
    })

    test('persists channel split config with channelId', () => {
      const layout: ChatLayout = {
        version: 1,
        mode: 'split',
        splits: [
          { id: 'ch1', type: 'channel', channelId: 'twitch:streamer1', size: 33 },
          { id: 'ch2', type: 'channel', channelId: 'kick:streamer2', size: 33 },
          { id: 'combined', type: 'combined', size: 34 },
        ],
      }

      ChatLayoutStore.set(layout)
      const retrieved = ChatLayoutStore.get()

      expect(retrieved.splits[0]!.channelId).toBe('twitch:streamer1')
      expect(retrieved.splits[1]!.channelId).toBe('kick:streamer2')
      expect(retrieved.splits[2]!.type).toBe('combined')
    })

    test('persists split sizes accurately', () => {
      const splits: SplitConfig[] = [
        { id: 's1', type: 'combined', size: 25 },
        { id: 's2', type: 'combined', size: 75 },
      ]

      ChatLayoutStore.set({ version: 1, mode: 'split', splits })
      const retrieved = ChatLayoutStore.get()

      expect(retrieved.splits[0]!.size).toBe(25)
      expect(retrieved.splits[1]!.size).toBe(75)
    })
  })

  describe('update()', () => {
    test('merges partial mode update without affecting splits', () => {
      ChatLayoutStore.set({
        version: 1,
        mode: 'combined',
        splits: [{ id: 'default', type: 'combined', size: 100 }],
      })

      const updated = ChatLayoutStore.update({ mode: 'split' })

      expect(updated.mode).toBe('split')
      expect(updated.splits).toHaveLength(1)
      expect(updated.splits[0]!.id).toBe('default')
      expect(updated.version).toBe(1)
    })

    test('merges partial splits update without affecting mode', () => {
      const initialSplits: SplitConfig[] = [
        { id: 'p1', type: 'combined', size: 50 },
        { id: 'p2', type: 'combined', size: 50 },
      ]

      ChatLayoutStore.set({ version: 1, mode: 'split', splits: initialSplits })

      const newSplits: SplitConfig[] = [
        { id: 'p1', type: 'channel', channelId: 'twitch:x', size: 40 },
        { id: 'p2', type: 'combined', size: 60 },
      ]
      const updated = ChatLayoutStore.update({ splits: newSplits })

      expect(updated.mode).toBe('split')
      expect(updated.splits[0]!.channelId).toBe('twitch:x')
      expect(updated.splits[1]!.size).toBe(60)
    })

    test('persists the merged result to database', () => {
      ChatLayoutStore.set({
        version: 1,
        mode: 'combined',
        splits: [{ id: 'default', type: 'combined', size: 100 }],
      })

      ChatLayoutStore.update({ mode: 'split' })

      const retrieved = ChatLayoutStore.get()
      expect(retrieved.mode).toBe('split')
    })

    test('returns the updated layout', () => {
      const result = ChatLayoutStore.update({ mode: 'split' })

      expect(result).not.toBeNull()
      expect(result.mode).toBe('split')
      expect(result.version).toBe(1)
    })

    test('update on empty store uses defaults as base', () => {
      const updated = ChatLayoutStore.update({ mode: 'split' })

      expect(updated.version).toBe(1)
      expect(updated.mode).toBe('split')
      expect(updated.splits).toHaveLength(1)
      expect(updated.splits[0]!.id).toBe('default')
    })

    test('multiple sequential updates accumulate correctly', () => {
      ChatLayoutStore.update({ mode: 'split' })
      ChatLayoutStore.update({
        splits: [
          { id: 'p1', type: 'combined', size: 30 },
          { id: 'p2', type: 'combined', size: 70 },
        ],
      })

      const final = ChatLayoutStore.get()
      expect(final.mode).toBe('split')
      expect(final.splits).toHaveLength(2)
      expect(final.splits[0]!.size).toBe(30)
    })
  })

  describe('defaults', () => {
    test('default layout version is 1', () => {
      const layout = ChatLayoutStore.get()
      expect(layout.version).toBe(1)
    })

    test('default mode is combined', () => {
      const layout = ChatLayoutStore.get()
      expect(layout.mode).toBe('combined')
    })

    test('default splits has a single combined panel at 100%', () => {
      const layout = ChatLayoutStore.get()
      const defaultSplit = layout.splits[0]!

      expect(layout.splits).toHaveLength(1)
      expect(defaultSplit.type).toBe('combined')
      expect(defaultSplit.size).toBe(100)
      expect(defaultSplit.id).toBe('default')
    })

    test('default splits has no channelId on the combined panel', () => {
      const layout = ChatLayoutStore.get()
      expect(layout.splits[0]!.channelId).toBeUndefined()
    })

    test('recovers to defaults when stored JSON is invalid', () => {
      const db = getDb()
      db.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['chat_layout', 'not valid json {{{'],
      )

      const layout = ChatLayoutStore.get()
      expect(layout.mode).toBe('combined')
      expect(layout.version).toBe(1)
      expect(layout.splits).toHaveLength(1)
    })

    test('deep-merges defaults for missing fields in stored layout', () => {
      // Store a minimal partial layout missing the version field
      const db = getDb()
      const partial = { mode: 'split', splits: [{ id: 'x', type: 'combined', size: 100 }] }
      db.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['chat_layout', JSON.stringify(partial)],
      )

      const layout = ChatLayoutStore.get()
      // version defaults in from DEFAULT_LAYOUT
      expect(layout.version).toBe(1)
      expect(layout.mode).toBe('split')
    })
  })
})
