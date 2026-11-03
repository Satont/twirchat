import { describe, expect, test } from 'bun:test'

import {
  commandApplies,
  CUSTOM_COMMAND_PACING_MS,
  expandCustomCommand,
  runCommandActions,
  validateCustomCommands,
  type CommandContext,
  type CustomCommandDefinition,
} from '../src/gpuix/commands'
import {
  createCustomCommandsController,
  CUSTOM_COMMANDS_KEY,
} from '../src/gpuix/state/custom-commands'

function command(
  name: string,
  template: string,
  extra: Partial<CustomCommandDefinition> = {},
): CustomCommandDefinition {
  return { id: name, name, template, showInMessageMenu: false, ...extra }
}

const context: CommandContext = {
  platform: 'twitch',
  channel: { name: 'satont', id: '42' },
  my: { name: 'streamer', id: '1' },
  user: { name: 'viewer', id: '2' },
  message: { id: 'message-3', text: 'Hello everyone' },
  stream: { title: 'Building a chat app', game: 'Software and Game Development' },
  inputText: '/test original text',
  elementCopyText: 'Copied message text',
}

describe('custom command expansion', () => {
  test('substitutes positional arguments and all remaining words, including quoted phrases', () => {
    expect(
      expandCustomCommand(
        '/greet "Alice Smith" welcome to chat',
        [command('greet', 'Hello {1}! {2+}')],
        context,
      ),
    ).toEqual({ ok: true, matched: true, outputs: ['Hello Alice Smith! welcome to chat'] })
    expect(
      expandCustomCommand("/greet 'Alice Smith' welcome", [command('greet', '{2} {1}')], context),
    ).toEqual({ ok: true, matched: true, outputs: ['welcome Alice Smith'] })
  })

  test('uses semicolon defaults for missing or empty values, plus equals compatibility', () => {
    const definition = command('hello', 'Hi {1;chat}! {2+;Welcome back} {3=friend}')
    expect(expandCustomCommand('/hello', [definition], {})).toEqual({
      ok: true,
      matched: true,
      outputs: ['Hi chat! Welcome back friend'],
    })
    expect(expandCustomCommand('/hello ""', [definition], {})).toEqual({
      ok: true,
      matched: true,
      outputs: ['Hi chat! Welcome back friend'],
    })
    expect(
      expandCustomCommand(
        '/hello',
        [command('hello', '{stream.title;offline} {stream.game;No category}')],
        {},
      ),
    ).toEqual({ ok: true, matched: true, outputs: ['offline No category'] })
  })

  test('provides channel, account, selected user/message, stream and input contexts', () => {
    const definition = command(
      'test',
      '{channel.name}/{channel.id} {my.name}/{my.id} {user.name}/{user.id} {msg.id}: {msg.text} | {stream.title} | {stream.game} | {input.text} | {element.copytext}',
    )
    expect(expandCustomCommand('/test', [definition], context)).toEqual({
      ok: true,
      matched: true,
      outputs: [
        'satont/42 streamer/1 viewer/2 message-3: Hello everyone | Building a chat app | Software and Game Development | /test original text | Copied message text',
      ],
    })
  })

  test('supports deprecated context aliases and preserves unknown placeholders', () => {
    expect(
      expandCustomCommand(
        '/old',
        [command('old', '{channel} {user} {msg-id} {message} {unknown;kept}')],
        context,
      ),
    ).toEqual({
      ok: true,
      matched: true,
      outputs: ['satont viewer message-3 Hello everyone {unknown;kept}'],
    })
  })

  test('escapes braces without expanding the escaped placeholder', () => {
    expect(
      expandCustomCommand(
        '/literal secret',
        [command('literal', '{{1} {{channel.name}} {1}')],
        context,
      ),
    ).toEqual({ ok: true, matched: true, outputs: ['{1} {channel.name} secret'] })
  })

  test('selects the longest multiword trigger, preserving arguments after it', () => {
    const commands = [command('hello', 'short {1+}'), command('hello chat', 'long {1+}')]
    expect(expandCustomCommand('/hello chat dear friends', commands, context)).toEqual({
      ok: true,
      matched: true,
      outputs: ['long dear friends'],
    })
    expect(expandCustomCommand('/HELLO   CHAT dear friends', commands, context)).toEqual({
      ok: true,
      matched: true,
      outputs: ['long dear friends'],
    })
    expect(expandCustomCommand('/helloworld', commands, context)).toEqual({
      ok: true,
      matched: false,
      outputs: ['/helloworld'],
    })
  })

  test('expands aliases recursively while retaining the current channel context', () => {
    const commands = [
      command('welcome', '/greet {1+}'),
      command('greet', 'Welcome {1} to {channel.name}!'),
    ]
    expect(expandCustomCommand('/welcome Alice', commands, context)).toEqual({
      ok: true,
      matched: true,
      outputs: ['Welcome Alice to satont!'],
    })
  })

  test('rejects direct and indirect alias cycles instead of sending a partial expansion', () => {
    const direct = expandCustomCommand('/loop', [command('loop', '/loop')], context)
    expect(direct.ok).toBe(false)
    if (!direct.ok) expect(direct.error).toContain('cycle')
    const indirect = expandCustomCommand(
      '/first',
      [command('first', 'hello\n/second'), command('second', '/first')],
      context,
    )
    expect(indirect.ok).toBe(false)
  })

  test('limits deeply nested and branching aliases', () => {
    const chain = Array.from({ length: 10 }, (_, i) =>
      command(`alias${i}`, i === 9 ? 'hello' : `/alias${i + 1}`),
    )
    const deep = expandCustomCommand('/alias0', chain, context)
    expect(deep.ok).toBe(false)
    const branching = [
      command('first', Array(30).fill('/second').join('\n')),
      command('second', Array(30).fill('/empty').join('\n')),
      command('empty', '{1}'),
    ]
    const wide = expandCustomCommand('/first', branching, context)
    expect(wide.ok).toBe(false)
    if (!wide.ok) expect(wide.error).toContain('complex')
  })

  test('enforces platform and channel scopes on direct commands and nested aliases', () => {
    const scoped = command('hello', 'Scoped greeting', { platform: 'kick', channel: 'satont' })
    expect(commandApplies(scoped, context)).toBe(false)
    expect(expandCustomCommand('/hello', [scoped], context).ok).toBe(false)
    expect(expandCustomCommand('/alias', [command('alias', '/hello'), scoped], context).ok).toBe(
      false,
    )
    expect(
      expandCustomCommand('/hello', [scoped], { platform: 'kick', channel: { name: '#SATONT' } }),
    ).toEqual({ ok: true, matched: true, outputs: ['Scoped greeting'] })
    expect(
      expandCustomCommand('/hello', [scoped], { platform: 'kick', channel: { name: 'another' } })
        .ok,
    ).toBe(false)
  })

  test('picks the first applicable scoped definition, allowing ordered fallbacks', () => {
    const commands = [
      command('hello', 'Only Kick', { id: 'kick', platform: 'kick' }),
      command('hello', 'All others', { id: 'all' }),
    ]
    expect(expandCustomCommand('/hello', commands, context)).toEqual({
      ok: true,
      matched: true,
      outputs: ['All others'],
    })
  })

  test('produces bounded newline-separated outputs without accepting argument line injection', () => {
    expect(expandCustomCommand('/multi', [command('multi', 'first\nsecond')], context)).toEqual({
      ok: true,
      matched: true,
      outputs: ['first', 'second'],
    })
    expect(
      expandCustomCommand(
        '/multi',
        [command('multi', Array(6).fill('message').join('\n'))],
        context,
      ).ok,
    ).toBe(false)
    expect(
      expandCustomCommand('/echo "hello\n/ban viewer"', [command('echo', '{1}')], context),
    ).toEqual({ ok: true, matched: true, outputs: ['hello /ban viewer'] })
    expect(
      expandCustomCommand('/echo', [command('echo', '{msg.text}')], {
        ...context,
        message: { id: '1', text: 'hello\n/ban viewer' },
      }),
    ).toEqual({ ok: true, matched: true, outputs: ['hello /ban viewer'] })
  })

  test('returns clear errors for empty output, huge expansion and unfinished quoted arguments', () => {
    expect(expandCustomCommand('/empty', [command('empty', '{1}')], context).ok).toBe(false)
    expect(
      expandCustomCommand('/huge', [command('huge', '{msg.text}')], {
        ...context,
        message: { id: '1', text: 'x'.repeat(20_001) },
      }).ok,
    ).toBe(false)
    const quoted = expandCustomCommand('/echo "unfinished', [command('echo', '{1}')], context)
    expect(quoted.ok).toBe(false)
    if (!quoted.ok) expect(quoted.error).toContain('quotation')
  })

  test('leaves unknown provider commands and ordinary messages intact without evaluating code', () => {
    expect(
      expandCustomCommand("/echo don't repeat this", [command('echo', '{1+}')], context),
    ).toEqual({ ok: true, matched: true, outputs: ["don't repeat this"] })
    expect(expandCustomCommand('/ban viewer reason', [], context)).toEqual({
      ok: true,
      matched: false,
      outputs: ['/ban viewer reason'],
    })
    expect(expandCustomCommand('hello\nworld', [], context)).toEqual({
      ok: true,
      matched: false,
      outputs: ['hello\nworld'],
    })
    expect(
      expandCustomCommand('/literal', [command('literal', '$(whoami) `id` <script>')], context),
    ).toEqual({ ok: true, matched: true, outputs: ['$(whoami) `id` <script>'] })
  })
})

describe('saved command validation', () => {
  test('normalizes trigger and channel names while retaining templates and UI choices', () => {
    const validated = validateCustomCommands([
      command(' /HELLO   CHAT ', 'Hello {unknown}', {
        channel: '#SATONT',
        platform: 'twitch',
        showInMessageMenu: true,
      }),
    ])
    expect(validated[0]).toMatchObject({
      name: 'hello chat',
      channel: 'satont',
      template: 'Hello {unknown}',
      showInMessageMenu: true,
    })
  })

  test('rejects malformed or duplicate definitions and reserved local triggers', () => {
    for (const value of [
      null,
      {},
      [null],
      [command('pause', 'hello')],
      [command('bad!', 'hello')],
      [command('good', '')],
      [command('good', 'x'.repeat(4001))],
      [command('good', 'hi'), command('good', 'hello', { id: 'other' })],
      [command('good', 'hi'), command('another', 'hello', { id: 'good' })],
      [{ ...command('good', 'hello'), platform: 'invalid' }],
    ]) {
      expect(() => validateCustomCommands(value)).toThrow()
    }
    expect(
      validateCustomCommands([
        command('good', 'hello', { platform: 'kick' }),
        command('good', 'hi', { id: 'twitch', platform: 'twitch' }),
      ]),
    ).toHaveLength(2)
  })
})

describe('custom command persistence', () => {
  test('coalesces concurrent loads and validates the saved list', async () => {
    const controller = createCustomCommandsController()
    let reads = 0
    const api = {
      getUiState: async ({ key }: { key: string }) => {
        expect(key).toBe(CUSTOM_COMMANDS_KEY)
        reads++
        await Bun.sleep(1)
        return JSON.stringify([command('hello', 'Hi')])
      },
      setUiState: async () => {},
    }
    await Promise.all([controller.load(api), controller.load(api), controller.load(api)])
    expect(reads).toBe(1)
    expect(controller.store.get()).toMatchObject({
      loaded: true,
      loading: false,
      commands: [command('hello', 'Hi')],
    })
  })

  test('reports corrupt saved definitions without overwriting storage until explicit save', async () => {
    const controller = createCustomCommandsController()
    const writes: string[] = []
    const api = {
      getUiState: async () => '{broken',
      setUiState: async ({ value }: { value: string }) => {
        writes.push(value)
      },
    }
    await controller.load(api)
    expect(controller.store.get().error).toContain('could not be loaded')
    expect(writes).toEqual([])
    await controller.save(api, [command('hello', 'Hi')])
    expect(writes).toEqual([JSON.stringify([command('hello', 'Hi')])])
    expect(controller.store.get().error).toBeNull()
  })

  test('serializes overlapping saves so the latest successful edit wins', async () => {
    const controller = createCustomCommandsController()
    const order: string[] = []
    let active = 0
    let maxActive = 0
    const api = {
      getUiState: async () => null,
      setUiState: async ({ key, value }: { key: string; value: string }) => {
        expect(key).toBe(CUSTOM_COMMANDS_KEY)
        active++
        maxActive = Math.max(active, maxActive)
        await Bun.sleep(1)
        order.push(value)
        active--
      },
    }
    await Promise.all([
      controller.save(api, [command('hello', 'First')]),
      controller.save(api, [command('hello', 'Second')]),
    ])
    expect(maxActive).toBe(1)
    expect(order.map((value) => JSON.parse(value)[0].template)).toEqual(['First', 'Second'])
    expect(controller.store.get()).toMatchObject({
      saving: false,
      commands: [command('hello', 'Second')],
    })
  })

  test('does not lose the last good state on write failure, and a later retry succeeds', async () => {
    const controller = createCustomCommandsController()
    let fail = true
    const api = {
      getUiState: async () => JSON.stringify([command('hello', 'Old')]),
      setUiState: async () => {
        if (fail) throw new Error('disk full')
      },
    }
    await controller.load(api)
    await expect(controller.save(api, [command('hello', 'New')])).rejects.toThrow('disk full')
    expect(controller.store.get().commands[0]?.template).toBe('Old')
    expect(controller.store.get().error).toContain('disk full')
    fail = false
    await controller.save(api, [command('hello', 'New')])
    expect(controller.store.get().commands[0]?.template).toBe('New')
    expect(controller.store.get().saving).toBe(false)
  })

  test('can retry a failed read and rejects invalid saves before writing', async () => {
    const controller = createCustomCommandsController()
    let fail = true
    let writes = 0
    const api = {
      getUiState: async () => {
        if (fail) throw new Error('unavailable')
        return null
      },
      setUiState: async () => {
        writes++
      },
    }
    await expect(controller.load(api)).rejects.toThrow('unavailable')
    expect(controller.store.get()).toMatchObject({ loaded: false, loading: false })
    fail = false
    await controller.load(api)
    await expect(controller.save(api, [command('invalid!', 'Hi')])).rejects.toThrow()
    expect(writes).toBe(0)
  })
})

describe('paced command execution', () => {
  test('executes sequentially and waits between every output', async () => {
    const events: string[] = []
    await runCommandActions(
      [
        async () => {
          events.push('first')
          await Bun.sleep(1)
          events.push('first done')
        },
        () => {
          events.push('second')
        },
      ],
      {
        wait: async (ms) => {
          expect(ms).toBe(CUSTOM_COMMAND_PACING_MS)
          events.push('wait')
        },
      },
    )
    expect(events).toEqual(['first', 'first done', 'wait', 'second'])
  })

  test('stops after errors and rejects oversized batches before any side effect', async () => {
    let calls = 0
    await expect(
      runCommandActions([
        () => {
          throw new Error('rejected')
        },
        () => {
          calls++
        },
      ]),
    ).rejects.toThrow('rejected')
    await expect(
      runCommandActions(
        Array.from({ length: 6 }, () => () => {
          calls++
        }),
      ),
    ).rejects.toThrow('at most 5')
    expect(calls).toBe(0)
  })

  test('cancellation while waiting prevents later outputs', async () => {
    const cancellation = new AbortController()
    let calls = 0
    await expect(
      runCommandActions(
        [
          () => {
            calls++
          },
          () => {
            calls++
          },
        ],
        {
          signal: cancellation.signal,
          wait: async () => {
            cancellation.abort()
          },
        },
      ),
    ).rejects.toThrow()
    expect(calls).toBe(1)
  })
})
