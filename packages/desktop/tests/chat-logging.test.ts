import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import {
  defaultChatLoggingSettings,
  validateChatLoggingSettings,
  type ChatLoggingSettings,
} from '../src/gpuix/backend/chat-history'
import { createChatFileLogger } from '../src/gpuix/backend/chat-logging'
import { required } from './fixture-values'

let directory = ''
const loggers: ReturnType<typeof createChatFileLogger>[] = []
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'twirchat-filelogs-'))
})
afterEach(async () => {
  await Promise.all(loggers.splice(0).map((logger) => logger.flush()))
  rmSync(directory, { recursive: true, force: true })
})
function logger() {
  const value = createChatFileLogger()
  loggers.push(value)
  return value
}
function settings(overrides: Partial<ChatLoggingSettings> = {}): ChatLoggingSettings {
  return {
    ...defaultChatLoggingSettings(),
    enabled: true,
    directory: join(directory, 'logs'),
    ...overrides,
  }
}
function message(
  id: string,
  overrides: Partial<NormalizedChatMessage> = {},
): NormalizedChatMessage {
  return {
    id,
    platform: 'twitch',
    channelId: 'streamer',
    author: { id: 'viewer', displayName: 'Alice', badges: [] },
    text: `hello ${id}`,
    timestamp: new Date('2026-11-01T12:00:00Z'),
    type: 'message',
    emotes: [],
    ...overrides,
  }
}
async function files() {
  return [...(await Array.fromAsync(new Bun.Glob('**/*.log').scan({ cwd: directory })))]
    .sort()
    .map((path) => join(directory, path))
}

describe('buffered chat file logging', () => {
  test('does not create directories or files until enabled and flushes complete buffered lines', async () => {
    const value = logger()
    const config = settings()
    value.enqueue(message('disabled'), { ...config, enabled: false })
    await value.flush()
    expect(existsSync(config.directory)).toBe(false)
    value.enqueue(message('first'), config)
    value.enqueue(message('second'), config)
    expect(existsSync(config.directory)).toBe(false)
    expect(value.status().queued).toBe(2)
    await value.flush()
    const paths = await files()
    expect(paths).toHaveLength(1)
    const text = await Bun.file(required(paths[0])).text()
    expect(text).toBe(
      '[2026-11-01T12:00:00.000Z] Alice: hello first\n[2026-11-01T12:00:00.000Z] Alice: hello second\n',
    )
    expect(value.status()).toEqual({ error: null, queued: 0 })
  })

  test('honors channel allowlists, platform identity, timestamps and daily rotation', async () => {
    const value = logger()
    const config = settings({
      channels: [{ platform: 'twitch', channelId: 'STREAMER' }],
      timestamps: false,
    })
    value.enqueue(message('one'), config)
    value.enqueue(message('two', { timestamp: new Date('2026-11-02T12:00:00Z') }), config)
    value.enqueue(message('wrong-platform', { platform: 'kick' }), config)
    value.enqueue(message('wrong-channel', { channelId: 'other' }), config)
    await value.flush()
    const paths = await files()
    expect(paths).toHaveLength(2)
    expect(paths[0]).toEndWith('2026-11-01.log')
    expect(paths[1]).toEndWith('2026-11-02.log')
    expect(await Bun.file(required(paths[0])).text()).toBe('Alice: hello one\n')
  })

  test('rotates files at the configured byte limit and never splits Unicode characters', async () => {
    const value = logger()
    const config = settings({ maxFileBytes: 1024 })
    for (let index = 0; index < 10; index += 1)
      value.enqueue(message(String(index), { text: '👍'.repeat(1000) }), config)
    await value.flush()
    const paths = await files()
    expect(paths).toHaveLength(10)
    const contents = await Promise.all(
      paths.map(async (path) => {
        const file = Bun.file(path)
        expect(file.size).toBeLessThanOrEqual(1024)
        return file.text()
      }),
    )
    expect(contents.every((text) => text.endsWith('…\n') && !text.includes('�'))).toBe(true)
  })

  test('flattens control characters and keeps channel path components inside the chosen directory', async () => {
    const value = logger()
    value.enqueue(
      message('unsafe', {
        channelId: '../../outside',
        text: 'first\nsecond\u001b[31m',
        author: { id: 'viewer', displayName: 'A\rB', badges: [] },
      }),
      settings({ timestamps: false }),
    )
    await value.flush()
    const paths = await files()
    expect(paths).toHaveLength(1)
    expect(required(paths[0]).startsWith(join(directory, 'logs', 'twitch'))).toBe(true)
    expect((await Bun.file(required(paths[0])).text()).split('\n')).toHaveLength(2)
    expect(await Bun.file(required(paths[0])).text()).toContain('A B: first second [31m')
  })

  test('reports IO errors without losing queued entries and recovers when the folder is corrected', async () => {
    const value = logger()
    const blocked = join(directory, 'blocked')
    await Bun.file(blocked).write('not a directory')
    const config = settings({ directory: blocked })
    value.enqueue(message('one'), config)
    value.enqueue(message('two'), config)
    await value.flush()
    expect(value.status().error).toBeString()
    expect(value.status().queued).toBe(2)
    const corrected = join(directory, 'corrected')
    value.relocate(corrected)
    await value.flush()
    expect(value.status()).toEqual({ error: null, queued: 0 })
    expect((await files()).every((path) => path.startsWith(corrected))).toBe(true)
  })

  test('continues logging after external cleanup of a previously rotated active file', async () => {
    const value = logger()
    const config = settings({ maxFileBytes: 1024 })
    value.enqueue(message('one', { text: 'a'.repeat(800) }), config)
    await value.flush()
    const [path] = await files()
    await rm(required(path))
    value.enqueue(message('two', { text: 'b'.repeat(800) }), config)
    await value.flush()
    expect(value.status().error).toBeNull()
    expect(await Bun.file(required(path)).exists()).toBe(true)
  })

  test('session rotation groups messages across dates in one app-session log', async () => {
    const value = logger()
    const config = settings({ rotation: 'session' })
    value.enqueue(message('one'), config)
    value.enqueue(message('two', { timestamp: new Date('2026-11-02T12:00:00Z') }), config)
    await value.flush()
    expect(await files()).toHaveLength(1)
  })

  test('validates paths, retention and byte limits before enabling logging', () => {
    expect(() => validateChatLoggingSettings(settings({ directory: 'relative' }))).toThrow(
      'absolute',
    )
    expect(() => validateChatLoggingSettings(settings({ maxMessages: 0 }))).toThrow('retention')
    expect(() => validateChatLoggingSettings(settings({ maxAgeDays: -1 }))).toThrow('retention')
    expect(() => validateChatLoggingSettings(settings({ maxFileBytes: 1 }))).toThrow('KiB')
    expect(validateChatLoggingSettings(settings()).enabled).toBe(true)
  })
})
