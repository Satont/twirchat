import { expect, test } from 'bun:test'
import type { PlatformStatus, PlatformStatusInfo } from '@twirchat/shared/types'
import { createConnectionNoticeStore } from '../src/views/main/composables/useConnectionNotice'

function status(state: PlatformStatus, error?: string): PlatformStatusInfo {
  return {
    platform: 'kick',
    status: state,
    mode: 'authenticated',
    ...(error ? { error } : {}),
  }
}

test('deduplicates an identical status within five seconds', () => {
  const notices = createConnectionNoticeStore(
    () => 1_000,
    () => 1,
  )

  expect(notices.observe('kick:channel', status('connecting'))).toEqual({
    durationMs: 3_000,
    kind: 'info',
    text: 'Connecting to channel…',
  })
  expect(notices.observe('kick:channel', status('connecting'))).toBeNull()
})

test('describes each connection transition with an appropriate lifetime', () => {
  const notices = createConnectionNoticeStore(
    () => 1_000,
    () => 1,
  )

  expect(notices.observe('kick:channel', status('connected'))).toEqual({
    durationMs: 3_000,
    kind: 'success',
    text: 'Connected to channel',
  })
  expect(notices.observe('kick:channel', status('disconnected'))).toEqual({
    durationMs: 3_000,
    kind: 'info',
    text: 'channel disconnected',
  })
  expect(notices.observe('kick:channel', status('error', 'Connection closed'))).toEqual({
    durationMs: 6_000,
    kind: 'error',
    text: 'Connection closed',
  })
})
