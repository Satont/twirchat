import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_SETTINGS, type NormalizedChatMessage } from '@twirchat/shared/types'

import {
  backendToDesktopMessageSchema,
  watchedChannelsLayoutSchema,
} from '../src/services/persisted-schemas'
import { initDb } from '../src/store/db'
import { MessageStore } from '../src/store/message-store'
import { SettingsStore } from '../src/store/settings-store'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'twirchat-persisted-boundaries-'))
  const database = initDb(join(directory, 'profile.sqlite'))
  return {
    database,
    dispose() {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('persisted partial settings retain nested defaults and reject wrong external types', () => {
  const f = fixture()
  try {
    f.database.run('INSERT INTO settings(key,value) VALUES(?,?)', [
      'app_settings',
      JSON.stringify({ fontSize: 18, overlay: { fontSize: 22 }, hotkeys: { newTab: 'ctrl+n' } }),
    ])
    const settings = SettingsStore.get()
    expect(settings.fontSize).toBe(18)
    expect(settings.twirIntegrationEnabled).toBe(true)
    expect(settings.fossabotIntegrationEnabled).toBe(true)
    expect(settings.nightbotIntegrationEnabled).toBe(true)
    expect(settings.potatIntegrationEnabled).toBe(true)
    expect(settings.supibotIntegrationEnabled).toBe(true)
    expect(settings.showModerationRail).toBe(true)
    expect(settings.overlay).toEqual({ ...DEFAULT_SETTINGS.overlay, fontSize: 22 })
    expect(settings.hotkeys).toEqual({ ...DEFAULT_SETTINGS.hotkeys, newTab: 'ctrl+n' })
    SettingsStore.set({
      ...settings,
      twirIntegrationEnabled: false,
      fossabotIntegrationEnabled: false,
      nightbotIntegrationEnabled: false,
      potatIntegrationEnabled: false,
      supibotIntegrationEnabled: false,
      showModerationRail: false,
    })
    expect(SettingsStore.get()).toMatchObject({
      twirIntegrationEnabled: false,
      fossabotIntegrationEnabled: false,
      nightbotIntegrationEnabled: false,
      potatIntegrationEnabled: false,
      supibotIntegrationEnabled: false,
      showModerationRail: false,
    })
    f.database.run('UPDATE settings SET value=? WHERE key=?', [
      JSON.stringify({ fontSize: 'wrong' }),
      'app_settings',
    ])
    expect(SettingsStore.get().fontSize).toBe(DEFAULT_SETTINGS.fontSize)
  } finally {
    f.dispose()
  }
})

test('timestamp format defaults for old settings and persists supported values', () => {
  const f = fixture()
  try {
    f.database.run('INSERT INTO settings(key,value) VALUES(?,?)', [
      'app_settings',
      JSON.stringify({ fontSize: 18 }),
    ])
    expect(SettingsStore.get().timestampFormat).toBe(DEFAULT_SETTINGS.timestampFormat)

    SettingsStore.set({ ...SettingsStore.get(), timestampFormat: 'hh:MM A' })
    expect(SettingsStore.get().timestampFormat).toBe('hh:MM A')

    f.database.run('UPDATE settings SET value=? WHERE key=?', [
      JSON.stringify({ timestampFormat: 'not-a-format' }),
      'app_settings',
    ])
    expect(SettingsStore.get().timestampFormat).toBe(DEFAULT_SETTINGS.timestampFormat)
  } finally {
    f.dispose()
  }
})

test('reply on double-click defaults on for old settings and persists when disabled', () => {
  const f = fixture()
  try {
    f.database.run('INSERT INTO settings(key,value) VALUES(?,?)', [
      'app_settings',
      JSON.stringify({ fontSize: 18 }),
    ])
    expect(SettingsStore.get().replyOnDoubleClick).toBe(true)

    SettingsStore.set({ ...SettingsStore.get(), replyOnDoubleClick: false })
    expect(SettingsStore.get().replyOnDoubleClick).toBe(false)

    f.database.run('UPDATE settings SET value=? WHERE key=?', [
      JSON.stringify({ replyOnDoubleClick: 'no' }),
      'app_settings',
    ])
    expect(SettingsStore.get().replyOnDoubleClick).toBe(DEFAULT_SETTINGS.replyOnDoubleClick)
  } finally {
    f.dispose()
  }
})

test('theme settings recover independently and retain the custom palette across preset changes', () => {
  const f = fixture()
  try {
    const customPalette = {
      background: '#123344',
      surface: '#234455',
      text: '#eef0f2',
      muted: '#bbccee',
      accent: '#556677',
    }
    f.database.run('INSERT INTO settings(key,value) VALUES(?,?)', [
      'app_settings',
      JSON.stringify({ theme: 'retired', themeMode: 'system', customPalette, fontSize: 19 }),
    ])
    expect(SettingsStore.get()).toMatchObject({
      theme: 'dark',
      themeMode: 'dark',
      customPalette,
      fontSize: 19,
    })

    f.database.run('UPDATE settings SET value=? WHERE key=?', [
      JSON.stringify({
        theme: 'forest',
        customPalette: { ...customPalette, accent: 9 },
        fontSize: 18,
      }),
      'app_settings',
    ])
    expect(SettingsStore.get()).toMatchObject({ theme: 'forest', fontSize: 18 })
    expect(SettingsStore.get().customPalette).toBeUndefined()

    expect(SettingsStore.update({ theme: 'opencode', themeMode: 'light' })).toMatchObject({
      theme: 'opencode',
      themeMode: 'light',
    })

    const settings = SettingsStore.get()
    SettingsStore.set({
      ...settings,
      theme: 'custom',
      customPalette: { ...customPalette, muted: 'BCE', accent: ' #567 ' },
    })
    expect(SettingsStore.get()).toMatchObject({ theme: 'custom', customPalette })
    expect(SettingsStore.update({ theme: 'ocean' }).customPalette).toEqual(customPalette)
    expect(SettingsStore.get()).toMatchObject({ theme: 'ocean', customPalette })
    expect(SettingsStore.update({ theme: 'custom' }).customPalette).toEqual(customPalette)
  } finally {
    f.dispose()
  }
})

test('history identity columns override serialized JSON while malformed author data is skipped', () => {
  const f = fixture()
  try {
    const original: NormalizedChatMessage = {
      id: 'real',
      platform: 'twitch',
      channelId: 'real-channel',
      author: { id: 'viewer', displayName: 'Viewer', badges: [] },
      text: 'hello',
      emotes: [],
      type: 'message',
      timestamp: new Date(1000),
    }
    MessageStore.save(original)
    f.database.run('UPDATE chat_messages SET data=?', [
      JSON.stringify({
        ...original,
        id: 'forged',
        platform: 'kick',
        channelId: 'forged-channel',
        timestamp: 'invalid',
      }),
    ])
    expect(MessageStore.getRecent()).toMatchObject([
      { id: 'real', platform: 'twitch', channelId: 'real-channel', timestamp: new Date(1000) },
    ])
    f.database.run('UPDATE chat_messages SET data=?', [
      JSON.stringify({ ...original, author: { id: 42, displayName: 'Wrong', badges: [] } }),
    ])
    expect(MessageStore.getRecent()).toEqual([])
  } finally {
    f.dispose()
  }
})

test('wire dates are restored and malformed nested layouts or relay batches fail at entry', () => {
  const event = backendToDesktopMessageSchema.parse({
    type: 'youtube_chat_event',
    event: {
      type: 'batch',
      subscriptionId: 'one',
      batch: {
        messages: [],
        events: [
          {
            id: 'event',
            platform: 'youtube',
            type: 'superchat',
            user: { id: 'viewer', displayName: 'Viewer' },
            data: {},
            timestamp: '2026-11-01T12:00:00Z',
          },
        ],
        moderation: [],
      },
    },
  })
  if (event.type !== 'youtube_chat_event' || event.event.type !== 'batch')
    throw new Error('Expected relay batch.')
  expect(event.event.batch.events[0]?.timestamp).toBeInstanceOf(Date)
  expect(
    watchedChannelsLayoutSchema.safeParse({
      version: 2,
      root: {
        type: 'split',
        id: 'root',
        direction: 'horizontal',
        flex: 100,
        children: [
          { type: 'panel', id: 'pane', content: { type: 'watched', channelId: 42 }, flex: 100 },
        ],
      },
    }).success,
  ).toBe(false)
  expect(
    backendToDesktopMessageSchema.safeParse({
      type: 'youtube_chat_event',
      event: {
        type: 'batch',
        subscriptionId: 'one',
        batch: {
          messages: [],
          events: [],
          moderation: [{ platform: 'youtube', channelId: 'channel', action: 'unknown' }],
        },
      },
    }).success,
  ).toBe(false)
})
