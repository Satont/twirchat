import { expect, test } from 'bun:test'

import { createJeetbotCommandsClient } from '../src/services/jeetbot-commands'

const API = 'https://api.jeetbot.app/api/v2/public/extension_helper/'
const TARGET = { channelLogin: 'AlexUE4', userId: '123' }
const HOUR = 60 * 60_000

const RESPONSE = {
  commands: [
    {
      description: 'Сменить голос',
      args: [
        {
          name: 'voice',
          type: 'voice',
          required: false,
          description: 'Выберите голос',
          suggestions: [
            { value: 'default', label: 'Голос канала', aliases: ['Сброс'], sample_url: null },
            { value: 'aidar', label: 'Айдар', aliases: [], sample_url: 'https://example/a.mp3' },
          ],
        },
      ],
      aliases: ['!tts'],
    },
    {
      description: 'Управление ВИПами',
      subcommands: [
        {
          name: 'add',
          description: 'Дать ВИПку',
          args: [
            { name: 'username', type: 'mention', required: true, description: 'Ник' },
            { name: 'expiration', type: 'duration', required: false, examples: ['1h', '1d'] },
          ],
        },
      ],
      aliases: ['!випка', '!vip'],
    },
    {
      description: 'Цвет',
      args: [{ name: 'color', type: 'choice', suggestions: ['blue', 'с пробелом'] }],
      aliases: ['!color'],
    },
    { description: 'Без префикса', aliases: ['hello', '!two words'] },
    { description: 'Сломанный', aliases: '!broken' },
  ],
}

test('fetches by lowercased Twitch login and user ID and normalizes the commands', async () => {
  const urls: string[] = []
  const getCommands = createJeetbotCommandsClient({
    fetcher: async (url, init) => {
      urls.push(url)
      expect(init.signal).toBeInstanceOf(AbortSignal)
      return Response.json(RESPONSE)
    },
  })
  const first = getCommands(TARGET)
  expect(getCommands(TARGET)).toBe(first)
  const commands = await first
  expect(urls).toEqual([`${API}?channel_name=alexue4&user_id=123`])
  expect(commands.map((command) => command.names)).toEqual([['tts'], ['випка', 'vip'], ['color']])
  expect(commands[0]?.args[0]?.options).toEqual([
    { value: 'default', label: 'Голос канала', aliases: ['Сброс'] },
    { value: 'aidar', label: 'Айдар', aliases: [] },
  ])
  expect(commands[1]?.subcommands[0]?.args.map((argument) => argument.required)).toEqual([
    true,
    false,
  ])
  expect(commands[1]?.subcommands[0]?.args[1]?.examples).toEqual(['1h', '1d'])
  expect(commands[2]?.args[0]?.options.map((option) => option.value)).toEqual(['blue'])
})

test('keeps one cache entry per sending account', async () => {
  const urls: string[] = []
  const getCommands = createJeetbotCommandsClient({
    fetcher: async (url) => {
      urls.push(url)
      return Response.json({ commands: [] })
    },
  })
  await getCommands(TARGET)
  await getCommands({ channelLogin: 'alexue4', userId: '123' })
  await getCommands({ channelLogin: 'alexue4', userId: '456' })
  await getCommands({ channelLogin: 'alexue4' })
  expect(urls).toEqual([
    `${API}?channel_name=alexue4&user_id=123`,
    `${API}?channel_name=alexue4&user_id=456`,
    `${API}?channel_name=alexue4`,
  ])
})

test('caches channels without jeetbot for half a day', async () => {
  let now = 0
  let requests = 0
  const getCommands = createJeetbotCommandsClient({
    now: () => now,
    fetcher: async () => {
      requests++
      return new Response(null, { status: 404 })
    },
  })
  expect(await getCommands(TARGET)).toEqual([])
  now = 11 * HOUR
  expect(await getCommands(TARGET)).toEqual([])
  expect(requests).toBe(1)
  now = 12 * HOUR
  expect(await getCommands(TARGET)).toEqual([])
  expect(requests).toBe(2)
})

test('keeps the previous list through failures and retries after a cooldown', async () => {
  let now = 0
  let status = 200
  let requests = 0
  const getCommands = createJeetbotCommandsClient({
    now: () => now,
    fetcher: async () => {
      requests++
      return status === 200 ? Response.json(RESPONSE) : new Response(null, { status })
    },
  })
  expect(await getCommands(TARGET)).toHaveLength(3)
  now = 12 * HOUR
  status = 502
  expect(await getCommands(TARGET)).toHaveLength(3)
  expect(await getCommands(TARGET)).toHaveLength(3)
  expect(requests).toBe(2)
  now += 5 * 60_000
  status = 200
  expect(await getCommands(TARGET)).toHaveLength(3)
  expect(requests).toBe(3)
})

test('explicit reload bypasses a fresh list and reports failures', async () => {
  let body: unknown = { commands: [] }
  let requests = 0
  const getCommands = createJeetbotCommandsClient({
    fetcher: async () => {
      requests++
      return Response.json(body)
    },
  })
  expect(await getCommands(TARGET)).toEqual([])
  body = RESPONSE
  expect(await getCommands(TARGET, { refresh: true })).toHaveLength(3)
  expect(await getCommands(TARGET)).toHaveLength(3)
  body = { commands: 'nope' }
  await expect(getCommands(TARGET, { refresh: true })).rejects.toThrow(
    'jeetbot returned an invalid response.',
  )
  expect(await getCommands(TARGET)).toHaveLength(3)
  expect(requests).toBe(3)
})
