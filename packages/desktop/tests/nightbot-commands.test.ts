import { expect, test } from 'bun:test'

import { createNightbotCommandsClient } from '../src/services/nightbot-commands'

const API = 'https://api.nightbot.tv/1'
const CHANNEL_ID = '57b6e0b79a75db0c6efb7dc0'
const CHANNEL = { _id: CHANNEL_ID, name: 'milanrodd', provider: 'twitch', providerId: '38318562' }

test('resolves a normalized Twitch login and shares public Nightbot requests without credentials', async () => {
  const requests: string[] = []
  const getCommands = createNightbotCommandsClient({
    fetcher: async (url, init) => {
      requests.push(url)
      expect(init.credentials).toBe('omit')
      expect(init.signal).toBeInstanceOf(AbortSignal)
      if (url === `${API}/channels/twitch/milanrodd`) {
        expect(init.headers).toEqual({ Accept: 'application/json' })
        return Response.json({ channel: CHANNEL, status: 200 })
      }
      expect(url).toBe(`${API}/commands`)
      expect(init.headers).toEqual({ Accept: 'application/json', 'Nightbot-Channel': CHANNEL_ID })
      return Response.json({
        _total: 1,
        commands: [{ name: '!правила', userLevel: 'everyone', alias: '' }],
        status: 200,
      })
    },
  })

  const first = getCommands('MilanRodd')
  expect(getCommands('milanrodd')).toBe(first)
  expect(await first).toEqual([{ name: 'правила' }])
  expect(await getCommands('milanrodd')).toBe(await first)
  expect(requests).toEqual([`${API}/channels/twitch/milanrodd`, `${API}/commands`])
})

test('keeps public bang commands, preserving Unicode and showing only the invocable name', async () => {
  const getCommands = createNightbotCommandsClient({
    fetcher: async (url) => {
      if (url.endsWith('/milanrodd')) return Response.json({ channel: CHANNEL })
      const commands = [
        { name: '!Яо', userLevel: 'everyone', alias: '!original' },
        { name: '!яо', userLevel: 'everyone' },
        { name: '!🍅', userLevel: 'everyone' },
        { name: '🍅', userLevel: 'everyone', alias: '!pomodoro' },
        { name: '!mods', userLevel: 'moderator' },
        { name: '!member', userLevel: 'subscriber' },
        { name: '!unknown', userLevel: null },
        ...['!', '!!nested', '!two words', '!tab\there', '!invisible\u200b', '!bad\ud800'].map(
          (name) => ({ name, userLevel: 'everyone' }),
        ),
        null,
      ]
      return Response.json({ _total: commands.length, commands })
    },
  })

  expect(await getCommands('milanrodd')).toEqual([{ name: 'Яо' }, { name: '🍅' }])
})

test('does not query commands for missing channels, invalid IDs or mismatched channels', async () => {
  const requests: string[] = []
  const getCommands = createNightbotCommandsClient({
    fetcher: async (url) => {
      requests.push(url)
      switch (url.slice(API.length)) {
        case '/channels/twitch/missing':
          return new Response(null, { status: 404 })
        case '/channels/twitch/milanrodd':
          return Response.json({ channel: { ...CHANNEL, _id: '../invalid' } })
        case '/channels/twitch/wrongname':
          return Response.json({ channel: CHANNEL })
        case '/channels/twitch/wrongprovider':
          return Response.json({
            channel: { ...CHANNEL, name: 'wrongprovider', provider: 'youtube' },
          })
        default:
          throw new Error(`Unexpected Nightbot request ${url}`)
      }
    },
  })

  expect(await getCommands('missing')).toEqual([])
  expect(await getCommands('MISSING')).toEqual([])
  expect(await getCommands('milanrodd')).toEqual([])
  expect(await getCommands('wrongname')).toEqual([])
  expect(await getCommands('wrongprovider')).toEqual([])
  expect(await getCommands('../invalid')).toEqual([])
  expect(requests).toEqual([
    `${API}/channels/twitch/missing`,
    `${API}/channels/twitch/milanrodd`,
    `${API}/channels/twitch/wrongname`,
    `${API}/channels/twitch/wrongprovider`,
  ])
})
