import type { TimestampFormat } from '@twirchat/shared/types'

import { t } from './i18n'

const FORMATTERS: Record<TimestampFormat, Intl.DateTimeFormat> = {
  'HH:MM:SS': new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }),
  'HH:MM': new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }),
  'HH:MM:SS.sss': new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  }),
  'hh:MM A': new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }),
  'hh:MM:SS A': new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }),
}

/**
 * Width of the fixed timestamp column in the compact layout, in font-size
 * units. Long formats need a wider column so the next token does not overlap.
 */
const TIMESTAMP_COLUMN_EM: Record<TimestampFormat, number> = {
  'HH:MM:SS': 4.6,
  'HH:MM': 3.1,
  'HH:MM:SS.sss': 7,
  'hh:MM A': 4.8,
  'hh:MM:SS A': 6.6,
}

export function timestampSize(fontSize: number): number {
  return Math.max(10, Math.round(fontSize * 0.78))
}

export function timestampColumnWidth(fontSize: number, format: TimestampFormat): number {
  return Math.ceil(timestampSize(fontSize) * TIMESTAMP_COLUMN_EM[format])
}

export function formatMessageTime(ts: Date, format: TimestampFormat = 'HH:MM:SS'): string {
  return Number.isNaN(ts.getTime()) ? t('chatMessages.invalidDate') : FORMATTERS[format].format(ts)
}
