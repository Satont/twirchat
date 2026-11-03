import { describe, expect, test } from 'bun:test'

import { parseLogLevel } from '../logger'
import { DEFAULT_MODERATION_SETTINGS, validateModerationSettings } from '../user-profile'
import { resolveYouTubeLiveChat } from '../youtube/discovery'

const moderation = () => structuredClone(DEFAULT_MODERATION_SETTINGS)

describe('shared external data boundaries', () => {
  test('moderation parsing trims valid values and rejects malformed runtime fields', () => {
    const input = moderation()
    input.timeouts[0] = { label: ' one ', seconds: 1 }
    input.reasons = [' reason ']
    expect(validateModerationSettings(input).timeouts[0]).toEqual({ label: 'one', seconds: 1 })
    expect(validateModerationSettings(input).reasons).toEqual(['reason'])
    for (const value of [
      null,
      [],
      {},
      { ...moderation(), timeouts: [] },
      {
        ...moderation(),
        timeouts: Array.from({ length: 8 }, () => ({ label: 'bad', seconds: '1' })),
      },
      {
        ...moderation(),
        timeouts: Array.from({ length: 8 }, () => ({ label: 'bad', seconds: NaN })),
      },
      {
        ...moderation(),
        timeouts: Array.from({ length: 8 }, () => ({ label: 'bad', seconds: 1209601 })),
      },
      { ...moderation(), reasons: [null] },
      { ...moderation(), reasons: [' '] },
      { ...moderation(), defaultReason: 42 },
    ])
      expect(() => validateModerationSettings(value)).toThrow()
  })

  test('log-level environment values narrow to supported levels or their configured default', () => {
    const levels: Parameters<typeof parseLogLevel>[1][] = ['debug', 'info', 'warn', 'error']
    for (const level of levels) expect(parseLogLevel(level, 'info')).toBe(level)
    for (const value of [undefined, '', 'verbose', 'toString', '__proto__'])
      expect(parseLogLevel(value, 'warn')).toBe('warn')
  })

  test('discovery rejects malformed successful JSON before exposing it to callers', async () => {
    for (const body of [
      null,
      [],
      { items: 'bad' },
      { items: [null] },
      { items: [{ id: 4 }] },
      { items: [{ liveStreamingDetails: { activeLiveChatId: 4 } }] },
    ]) {
      await expect(
        resolveYouTubeLiveChat({
          channelId: 'UCchannel',
          videoId: 'video',
          credentials: { apiKey: 'key' },
          fetcher: Object.assign(async () => Response.json(body), { preconnect: fetch.preconnect }),
        }),
      ).rejects.toThrow('Invalid YouTube discovery response.')
    }
  })

  test('discovery accepts extra API fields while keeping the requested channel identity', async () => {
    const result = await resolveYouTubeLiveChat({
      channelId: 'UCchannel',
      videoId: 'video',
      credentials: { apiKey: 'key' },
      fetcher: Object.assign(
        async () =>
          Response.json({
            extra: true,
            items: [
              {
                snippet: { channelId: 'UCchannel', title: 'unused' },
                liveStreamingDetails: { activeLiveChatId: 'chat' },
              },
            ],
          }),
        { preconnect: fetch.preconnect },
      ),
    })
    expect(result).toEqual({ channelId: 'UCchannel', videoId: 'video', liveChatId: 'chat' })
  })
})

test('timer reconnect failures are reported and close the transport instead of escaping unhandled', async () => {
  const { EventEmitter } = await import('node:events')
  const { status } = await import('@grpc/grpc-js')
  const { createYouTubeGrpcSession } = await import('../youtube/session')
  const stream = Object.assign(new EventEmitter(), { cancel() {} })
  let connecting = 0
  let closed = 0
  const terminalErrors: string[] = []
  const session = createYouTubeGrpcSession({
    liveChatId: 'chat',
    retryDelayMs: 1,
    getCredentials: () => ({ apiKey: 'key' }),
    clientFactory: () => ({
      streamList: () => stream,
      close() {
        closed++
      },
    }),
    onBatch() {},
    onStatus(state, error, terminal) {
      if (state === 'connecting' && ++connecting === 3) throw new Error('status subscriber failed')
      if (state === 'error' && terminal && error) terminalErrors.push(error)
    },
  })
  try {
    await session.start()
    stream.emit('error', { code: status.UNAVAILABLE, message: 'retry' })
    const deadline = Date.now() + 1000
    while (!terminalErrors.length && Date.now() < deadline) await Bun.sleep(1)
    expect(terminalErrors).toEqual(['status subscriber failed'])
    expect(closed).toBeGreaterThan(0)
  } finally {
    session.stop()
  }
})
