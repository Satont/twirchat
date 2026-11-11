import type { TimestampFormatOptionDefinition } from './types'

export const SAMPLE_TIME = new Date(2026, 0, 1, 21, 41, 2, 123)

export const TOGGLE = {
  radius: 8,
  edgeRadius: 7,
  width: 40,
  height: 22,
  knob: 16,
  inset: 3,
}

export const TIMESTAMP_FORMAT_OPTIONS: readonly TimestampFormatOptionDefinition[] = [
  { value: 'HH:MM:SS', testId: 'timestamp-format-hh-mm-ss' },
  { value: 'HH:MM', testId: 'timestamp-format-hh-mm' },
  { value: 'HH:MM:SS.sss', testId: 'timestamp-format-hh-mm-ss-sss' },
  { value: 'hh:MM A', testId: 'timestamp-format-hh-mm-a' },
  { value: 'hh:MM:SS A', testId: 'timestamp-format-hh-mm-ss-a' },
]
