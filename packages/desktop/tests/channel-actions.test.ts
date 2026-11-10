import { expect, test } from 'bun:test'

import type { Account, Platform } from '@twirchat/shared/types'

import { createAccountSessions } from '../src/services/account-sessions'
import {
  channelPlayerUrl,
  createChannelActions,
  DEFAULT_PLAYER_SETTINGS,
  playerArguments,
  validatePlayerSettings,
} from '../src/services/channel-actions'
import { required } from './fixture-values'

const account = (platform: Platform): Account => ({
  id: platform,
  platform,
  username: 'fixture',
  platformUserId: '1',
  displayName: 'Fixture',
  scopes: ['user:read:emotes'],
  createdAt: 0,
  updatedAt: 0,
})
function fixture() {
  const accounts = [account('twitch'), account('kick'), account('youtube')]
  const own: Platform[] = [],
    watched: string[] = [],
    reloaded: unknown[] = [],
    urls: string[] = [],
    commands: string[][] = []
  let settings = structuredClone(DEFAULT_PLAYER_SETTINGS)
  const dependencies = {
    activeAccounts: () => accounts,
    reconnectOwn: async (platform: Platform) => {
      own.push(platform)
    },
    reconnectWatched: async (id: string) => {
      watched.push(id)
    },
    reloadEmotes: async (...args: unknown[]) => {
      reloaded.push(args)
    },
    readPlayerSettings: () => settings,
    writePlayerSettings: (next: typeof settings) => {
      settings = next
    },
    openBrowser: (url: string) => {
      urls.push(url)
    },
    spawnPlayer: async (argv: string[]) => {
      commands.push(argv)
    },
  }
  return {
    dependencies,
    actions: createChannelActions(dependencies),
    accounts,
    own,
    watched,
    reloaded,
    urls,
    commands,
  }
}

test('reconnect targets only exact watched channel or selected active own platforms', async () => {
  const f = fixture()
  await f.actions.reconnectChat({ watchedChannelId: 'watched-id' })
  expect(f.watched).toEqual(['watched-id'])
  expect(f.own).toHaveLength(0)
  await f.actions.reconnectChat({ platform: 'kick' })
  expect(f.own).toEqual(['kick'])
  await f.actions.reconnectChat({})
  expect(f.own).toEqual(['kick', 'twitch', 'kick', 'youtube'])
})
test('own reconnect is bounded by platform count, reports individual failures and keeps other results', async () => {
  const f = fixture()
  let active = 0,
    peak = 0
  f.dependencies.reconnectOwn = async (platform) => {
    active++
    peak = Math.max(peak, active)
    await Bun.sleep(1)
    active--
    if (platform === 'kick') throw new Error('offline')
  }
  await expect(f.actions.reconnectChat({})).rejects.toThrow('kick: Error: offline')
  expect(peak).toBe(3)
  f.accounts.length = 0
  await expect(f.actions.reconnectChat({})).rejects.toThrow('Connect an account')
})
test('emote reload validates subscriber identity and permission before contacting providers', async () => {
  const f = fixture()
  await f.actions.reloadChatEmotes({
    platform: 'twitch',
    channelSlug: 'fixture',
    kind: 'subscriber',
  })
  expect(f.reloaded).toEqual([['twitch', 'fixture', 'subscriber']])
  required(f.accounts[0]).scopes = []
  await expect(
    f.actions.reloadChatEmotes({ platform: 'twitch', channelSlug: 'fixture', kind: 'subscriber' }),
  ).rejects.toThrow('user:read:emotes')
  await expect(
    f.actions.reloadChatEmotes({ platform: 'kick', channelSlug: 'fixture', kind: 'subscriber' }),
  ).rejects.toThrow('Twitch')
  await expect(
    f.actions.reloadChatEmotes({ platform: 'twitch', channelSlug: '../bad' }),
  ).rejects.toThrow('valid channel')
})
test('players use official URLs and argv with spaces preserved, no shell interpolation', async () => {
  const f = fixture()
  await f.actions.openChannelPlayer({ platform: 'twitch', channelSlug: 'fixture', mode: 'browser' })
  expect(f.urls).toEqual(['https://www.twitch.tv/fixture'])
  await expect(
    f.actions.openChannelPlayer({ platform: 'twitch', channelSlug: 'fixture', mode: 'custom' }),
  ).rejects.toThrow('Configure')
  await f.actions.savePlayerSettings({
    ...DEFAULT_PLAYER_SETTINGS,
    custom: {
      executable: '/Applications/My Player',
      arguments: ['--title={channel} live stream', '{url}', '--literal=$(touch never)'],
    },
  })
  await f.actions.openChannelPlayer({ platform: 'twitch', channelSlug: 'fixture', mode: 'custom' })
  expect(f.commands[0]).toEqual([
    '/Applications/My Player',
    '--title=fixture live stream',
    'https://www.twitch.tv/fixture',
    '--literal=$(touch never)',
  ])
  await f.actions.openChannelPlayer({
    platform: 'youtube',
    channelSlug: '@fixture',
    mode: 'streamlink',
  })
  expect(f.commands[1]).toEqual(['streamlink', 'https://www.youtube.com/@fixture/live', 'best'])
  expect(channelPlayerUrl('kick', 'fixture')).toBe('https://kick.com/fixture')
  expect(channelPlayerUrl('vkplay', 'fixture')).toBe('https://live.vkvideo.ru/fixture')
  expect(channelPlayerUrl('youtube', 'UCabcdefghijklmnopqrstuv')).toBe(
    'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/live',
  )
  expect(() => channelPlayerUrl('twitch', 'https://evil.test')).toThrow()
  expect(() =>
    playerArguments(DEFAULT_PLAYER_SETTINGS.streamlink, 'twitch', 'fixture', 'javascript:alert(1)'),
  ).toThrow('HTTP')
})
test('invalid player templates fail before save and startup failures give configuration guidance', async () => {
  const f = fixture()
  await expect(
    f.actions.savePlayerSettings({
      ...DEFAULT_PLAYER_SETTINGS,
      custom: { executable: 'mpv', arguments: ['{unknown}'] },
    }),
  ).rejects.toThrow('Unknown player placeholder')
  expect(() =>
    validatePlayerSettings({
      ...DEFAULT_PLAYER_SETTINGS,
      custom: { executable: 'mpv\0', arguments: ['{url}'] },
    }),
  ).toThrow()
  f.dependencies.spawnPlayer = async () => {
    throw new Error('ENOENT')
  }
  await expect(
    f.actions.openChannelPlayer({ platform: 'kick', channelSlug: 'fixture', mode: 'streamlink' }),
  ).rejects.toThrow('Install it or check Player settings')
})
test('own reconnect shares account switch serialization and does not reconnect watched adapters', async () => {
  let selected = account('twitch')
  const other = { ...selected, id: 'other', username: 'second' }

  const { promise: gate, resolve: release } = Promise.withResolvers<void>()
  const calls: string[] = []
  let disconnects = 0
  const sessions = createAccountSessions({
    find: (id) => (id === 'other' ? other : selected),
    active: () => selected,
    select: (_platform, id) => {
      selected = id === 'other' ? other : selected
      return selected
    },
    remove: () => {},
    disconnect: async () => {
      calls.push('disconnect')
      if (++disconnects === 1) await gate
    },
    refreshIdentity: () => {},
    connectOwn: async (_platform, current) => {
      calls.push(`connect:${current?.username}`)
    },
    reconnectWatched: async () => {
      calls.push('watched')
    },
    changed: () => {},
  })
  const reconnect = sessions.reconnectOwn('twitch')
  const switching = sessions.select('twitch', 'other')
  await Bun.sleep(1)
  expect(calls).toEqual(['disconnect'])
  release()
  await Promise.all([reconnect, switching])
  expect(calls).toEqual([
    'disconnect',
    'connect:fixture',
    'disconnect',
    'connect:second',
    'watched',
  ])
})
