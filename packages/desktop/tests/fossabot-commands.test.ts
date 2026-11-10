import { expect, test } from 'bun:test'

import { createFossabotCommandsClient } from '../src/services/fossabot-commands'

const API = 'https://fossabot.com/api/v2/cached/channels'
const FOSSABOT_ID = '461152141112872960'
const TWITCH_ID = '37402112'
const CHANNEL = { id: FOSSABOT_ID, login: 'shroud', provider: 'twitch', provider_id: TWITCH_ID }
const TARGET = { channelLogin: 'shroud', twitchChannelId: TWITCH_ID }
const COMMAND = {
  name: 'sens',
  aliases: ['sensitivity'],
  role_ids: [],
  enabled_online: true,
  enabled_offline: true,
}
const SUGGESTIONS = [{ name: 'sens' }, { name: 'sensitivity', aliasFor: 'sens' }]

test('uses the Twitch ID, reads the string Fossabot ID and shares pending and cached results', async () => {
  const requests: string[] = []
  const getCommands = createFossabotCommandsClient({
    fetcher: async (url, init) => {
      requests.push(url)
      expect(init.headers).toEqual({ Accept: 'application/json' })
      expect(init.credentials).toBe('omit')
      expect(init.signal).toBeInstanceOf(AbortSignal)
      if (url.endsWith('/commands')) return Response.json({ commands: [COMMAND], roles: [] })
      return Response.json({ channel: { ...CHANNEL, login: 'newlogin', slug: 'customslug' } })
    },
  })

  const first = getCommands(TARGET)
  expect(getCommands({ ...TARGET, channelLogin: 'newlogin' })).toBe(first)
  expect(await first).toEqual(SUGGESTIONS)
  expect(await getCommands(TARGET)).toBe(await first)
  expect(requests).toEqual([
    `${API}/by-provider-id/twitch/${TWITCH_ID}`,
    `${API}/${FOSSABOT_ID}/commands`,
  ])
})

test('looks up lowercased Twitch logins and lists only unique public, enabled invocations', async () => {
  const getCommands = createFossabotCommandsClient({
    fetcher: async (url) => {
      if (url === `${API}/by-slug/shroud`) return Response.json({ channel: CHANNEL })
      expect(url).toBe(`${API}/${FOSSABOT_ID}/commands`)
      return Response.json({
        commands: [
          {
            ...COMMAND,
            aliases: [
              'sensitivity',
              'SENSITIVITY',
              'MOUSE',
              '!prefix',
              'two words',
              'x\u0000',
              'x\ud800',
            ],
          },
          { ...COMMAND, name: 'mouse', aliases: [], enabled_offline: false },
          { ...COMMAND, name: 'schedule', aliases: [], enabled_online: false },
          { ...COMMAND, name: 'disabled', enabled_online: false, enabled_offline: false },
          { ...COMMAND, name: 'private', role_ids: ['mods'] },
          { ...COMMAND, name: 'SENS', aliases: [] },
          { ...COMMAND, name: 'bad name' },
          { ...COMMAND, role_ids: null },
          null,
        ],
      })
    },
  })

  expect(await getCommands({ channelLogin: 'Shroud' })).toEqual([
    { name: 'sens' },
    { name: 'mouse' },
    { name: 'schedule' },
    { name: 'sensitivity', aliasFor: 'sens' },
  ])
})

test('ignores a matching Fossabot slug owned by another Twitch login or provider', async () => {
  let requests = 0
  const getCommands = createFossabotCommandsClient({
    fetcher: async (url) => {
      requests++
      expect(url).toContain('/by-slug/')
      const channel = url.endsWith('/shroud')
        ? { ...CHANNEL, login: 'anotherchannel' }
        : { ...CHANNEL, provider: 'kick', login: 'other' }
      return Response.json({ channel })
    },
  })

  expect(await getCommands({ channelLogin: 'shroud' })).toEqual([])
  expect(await getCommands({ channelLogin: 'other' })).toEqual([])
  expect(requests).toBe(2)
})

test('caches a missing channel and rejects an unsafe Fossabot ID before fetching commands', async () => {
  let requests = 0
  const getCommands = createFossabotCommandsClient({
    fetcher: async (url) => {
      requests++
      if (url.endsWith('/missing')) return new Response(null, { status: 404 })
      expect(url).toBe(`${API}/by-slug/shroud`)
      return Response.json({ channel: { ...CHANNEL, id: '../invalid' } })
    },
  })

  expect(await getCommands({ channelLogin: 'missing' })).toEqual([])
  expect(await getCommands({ channelLogin: 'MISSING' })).toEqual([])
  expect(await getCommands({ channelLogin: 'shroud' })).toEqual([])
  expect(requests).toBe(2)
})

test('keeps the previous commands when a refresh fails and retries after a cooldown', async () => {
  let now = 0
  let commandRequests = 0
  const getCommands = createFossabotCommandsClient({
    now: () => now,
    fetcher: async (url) => {
      if (!url.endsWith('/commands')) return Response.json({ channel: CHANNEL })
      commandRequests++
      if (commandRequests === 2) return Response.json({ commands: null })
      if (commandRequests === 3) return Response.json({ commands: [] })
      return Response.json({ commands: [COMMAND] })
    },
  })

  expect(await getCommands(TARGET)).toEqual(SUGGESTIONS)
  now = 5 * 60_000
  expect(await getCommands(TARGET)).toEqual(SUGGESTIONS)
  expect(await getCommands(TARGET)).toEqual(SUGGESTIONS)
  expect(commandRequests).toBe(2)
  now += 30_000
  expect(await getCommands(TARGET)).toEqual([])
  expect(commandRequests).toBe(3)
})
