import { expect, test } from 'bun:test'

import type { TimestampFormat } from '@twirchat/shared/types'

import { t } from '../src/gpuix/i18n'
import { formatMessageTime } from '../src/gpuix/timestamp-format'

const CASES = [
  ['HH:MM:SS', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }],
  ['HH:MM', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }],
  [
    'HH:MM:SS.sss',
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hourCycle: 'h23',
    },
  ],
  ['hh:MM A', { hour: '2-digit', minute: '2-digit', hour12: true }],
  ['hh:MM:SS A', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }],
] satisfies readonly (readonly [TimestampFormat, Intl.DateTimeFormatOptions])[]

test('formats message times with the selected timestamp format', () => {
  const date = new Date(2026, 0, 1, 21, 41, 2, 123)
  const originalTime = date.getTime()
  for (const [format, options] of CASES) {
    expect(formatMessageTime(date, format)).toBe(
      new Intl.DateTimeFormat(undefined, options).format(date),
    )
  }
  expect(date.getTime()).toBe(originalTime)
})

test('defaults to 24-hour timestamps with seconds', () => {
  const date = new Date(2026, 0, 1, 21, 41, 2, 123)
  expect(formatMessageTime(date)).toBe(formatMessageTime(date, 'HH:MM:SS'))
})

test('keeps invalid message dates non-throwing for every format', () => {
  const date = new Date(Number.NaN)
  for (const [format] of CASES) {
    expect(formatMessageTime(date, format)).toBe(t('chatMessages.invalidDate'))
  }
})
