import { expect, test } from 'bun:test'

import { formatMessageTime } from '../src/gpuix/components/ChatMessage'

test('formats message times with the existing locale and 24-hour precision', () => {
  for (const value of [
    '2026-11-03T00:00:00.000Z',
    '2026-11-03T01:11:11.000Z',
    '2026-11-03T08:08:08.999Z',
    '2026-11-03T23:59:59.000Z',
    '2026-03-29T00:59:59.000Z',
    '2026-10-25T01:00:00.000Z',
  ]) {
    const date = new Date(value)
    const originalTime = date.getTime()
    expect(formatMessageTime(date)).toBe(
      date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
    )
    expect(date.getTime()).toBe(originalTime)
  }
})

test('keeps invalid message dates non-throwing', () => {
  const date = new Date(Number.NaN)
  expect(formatMessageTime(date)).toBe(date.toLocaleTimeString())
})
