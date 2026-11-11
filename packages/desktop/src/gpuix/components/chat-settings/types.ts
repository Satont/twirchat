import type { TimestampFormat } from '@twirchat/shared'
import type { ReactNode } from 'react'

export interface TimestampFormatOptionDefinition {
  readonly value: TimestampFormat
  readonly testId: string
}

export interface ChatTimestampFormatSettingsProps {
  showTimestamp: boolean
  timestampFormat: TimestampFormat
  onShowTimestampChange: (value: boolean) => void
  onTimestampFormatChange: (value: TimestampFormat) => void
}

export interface TimestampSettingsRowProps {
  first?: boolean
  last?: boolean
  centerControl?: boolean
  label: string
  hint?: string
  testId?: string
  children: ReactNode
}

export interface TimestampSwitchProps {
  checked: boolean
  label: string
  onChange: (value: boolean) => void
}

export interface TimestampFormatOptionProps {
  value: TimestampFormat
  active: boolean
  first: boolean
  last: boolean
  testId: string
  onChange: (value: TimestampFormat) => void
}

export interface TimestampFormatToggleProps {
  label: string
  value: TimestampFormat
  onChange: (value: TimestampFormat) => void
}
