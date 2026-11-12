import { expect, test } from 'bun:test'

import { createPotatCommandsClient } from '../src/services/potat-commands'

const API = 'https://api.potat.app'
const NOW = Date.parse('2026-11-12T00:00:00Z')

test('uses every configured Potat prefix for built-ins and public custom commands', async () => {
  const requests: string[] = []
  const getCommands = createPotatCommandsClient({
    now: () => NOW,
    fetcher: async (url, init) => {
      expect(init.credentials).toBe('omit')
      expect(init.signal).toBeInstanceOf(AbortSignal)
      requests.push(url)
      if (url.endsWith('/users/qa')) {
        return Response.json({
          data: [
            {
              channel: {
                state: 'JOINED',
                settings: { prefix: ['-', '--', 'Pb:', 'pb:', 'bad prefix', ''] },
                commands: [
                  { active: true, name: '{any}discord', help: 'Discord server' },
                  { active: true, trigger: '/^!uwu$/' },
                  { active: true, trigger: '^Pb:ping$' },
                  { active: true, trigger: '^Pb:test.*' },
                  { active: true, trigger: '^hello$' },
                  { active: true, trigger: '^!secret', user_trigger_ids: [123] },
                  { active: true, trigger: '^!old', expires_at: '2026-11-11T00:00:00Z' },
                  { active: false, trigger: '^!inactive' },
                ],
              },
            },
          ],
        })
      }
      return Response.json([
        { name: 'ping', aliases: ['p', '-ping', 'has space'] },
        { name: 'disabled', isDisabled: true },
        { name: 'two words' },
        null,
      ])
    },
  })

  const commands = await getCommands('QA')
  expect(commands.map(({ prefix, name }) => prefix + name)).toEqual([
    'Pb:ping',
    'Pb:p',
    'Pb:-ping',
    '--ping',
    '--p',
    '---ping',
    '-ping',
    '-p',
    'Pb:discord',
    '--discord',
    '-discord',
    '!uwu',
  ])
  expect(commands.find((command) => command.prefix + command.name === '--ping')).toMatchObject({
    prefix: '--',
    name: 'ping',
  })
  expect(commands.find((command) => command.prefix + command.name === 'Pb:p')).toMatchObject({
    prefix: 'Pb:',
    aliasFor: 'ping',
  })
  expect(await getCommands('qa')).toEqual(commands)
  expect(requests).toEqual([`${API}/users/qa`, `${API}/help`])
})

test('scopes Potat prefixes by channel and shares the catalog only across joined channels', async () => {
  const requests: string[] = []
  const getCommands = createPotatCommandsClient({
    fetcher: async (url) => {
      requests.push(url)
      if (url.endsWith('/help')) return Response.json([{ name: 'ping' }])
      if (url.endsWith('/missing')) return new Response(null, { status: 404 })
      if (url.endsWith('/parted'))
        return Response.json({ data: [{ channel: { state: 'PARTED' } }] })
      const prefix = url.endsWith('/custom') ? '!' : undefined
      return Response.json({ data: [{ channel: { state: 'JOINED', settings: { prefix } } }] })
    },
  })

  expect(await getCommands('missing')).toEqual([])
  expect(await getCommands('parted')).toEqual([])
  expect(await getCommands('../invalid')).toEqual([])
  const [defaultCommands, customCommands] = await Promise.all([
    getCommands('default'),
    getCommands('custom'),
  ])
  expect(defaultCommands).toMatchObject([{ prefix: '#', name: 'ping' }])
  expect(customCommands).toMatchObject([{ prefix: '!', name: 'ping' }])
  expect(requests).toEqual([
    `${API}/users/missing`,
    `${API}/users/parted`,
    `${API}/users/default`,
    `${API}/users/custom`,
    `${API}/help`,
  ])
})
