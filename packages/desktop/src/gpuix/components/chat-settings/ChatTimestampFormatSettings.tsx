import { useT } from '@gpuix/i18n'
import { useFont, useTheme } from '@gpuix/theme-context'
import type { TimestampFormat } from '@twirchat/shared/types'
import type { ReactNode } from 'react'

interface TimestampFormatOption {
  readonly value: TimestampFormat
  readonly testId: string
}

const TIMESTAMP_FORMAT_OPTIONS: readonly TimestampFormatOption[] = [
  { value: 'HH:MM:SS', testId: 'timestamp-format-hh-mm-ss' },
  { value: 'HH:MM', testId: 'timestamp-format-hh-mm' },
  { value: 'HH:MM:SS.sss', testId: 'timestamp-format-hh-mm-ss-sss' },
  { value: 'hh:MM A', testId: 'timestamp-format-hh-mm-a' },
  { value: 'hh:MM:SS A', testId: 'timestamp-format-hh-mm-ss-a' },
]

interface ChatTimestampFormatSettingsProps {
  showTimestamp: boolean
  timestampFormat: TimestampFormat
  onShowTimestampChange: (value: boolean) => void
  onTimestampFormatChange: (value: TimestampFormat) => void
}

interface TimestampSettingsRowProps {
  first?: boolean
  last?: boolean
  center?: boolean
  testId?: string
  children: ReactNode
}

interface TimestampSwitchProps {
  checked: boolean
  label: string
  onChange: (value: boolean) => void
}

interface TimestampFormatToggleProps {
  label: string
  value: TimestampFormat
  onChange: (value: TimestampFormat) => void
}

function TimestampSettingsRow({
  first,
  last,
  center,
  testId,
  children,
}: TimestampSettingsRowProps) {
  const theme = useTheme()
  return (
    <div
      testId={testId}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: center ? 'center' : 'flex-end',
        gap: 16,
        paddingTop: first ? 0 : 12,
        paddingBottom: last ? 0 : 10,
        borderBottomWidth: last ? 0 : 1,
        borderColor: theme.border,
      }}
    >
      {children}
    </div>
  )
}

function TimestampSwitch({ checked, label, onChange }: TimestampSwitchProps) {
  const theme = useTheme()
  const inset = 3
  const knob = 16
  const width = 40
  const height = 22
  const travel = width - knob - inset * 2
  return (
    <div
      testId="show-timestamp"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(event) => {
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          onChange(!checked)
        }
      }}
      style={{
        width,
        height,
        borderRadius: height / 2,
        backgroundColor: checked ? theme.accent.primary : theme.scrollbar,
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        userSelect: 'none',
        focusVisible: { outlineWidth: 1, outlineColor: theme.link, outlineOffset: 2 },
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: inset,
          left: checked ? inset + travel : inset,
          width: knob,
          height: knob,
          borderRadius: knob / 2,
          backgroundColor: checked ? theme.accent.onPrimary : theme.text2,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

function TimestampFormatToggle({ label, value, onChange }: TimestampFormatToggleProps) {
  const theme = useTheme()
  const font = useFont()
  const { t } = useT()
  return (
    <div
      role="group"
      aria-label={label}
      testId="timestamp-format-options"
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'nowrap',
        maxWidth: '100%',
        minWidth: 0,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 8,
        overflow: 'hidden',
        flexShrink: 1,
      }}
    >
      {TIMESTAMP_FORMAT_OPTIONS.map((option, index) => {
        const active = option.value === value
        return (
          <div
            key={option.value}
            testId={option.testId}
            role="button"
            aria-label={option.value}
            aria-description={active ? t('misc.toggle.selected') : undefined}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'enter' || event.key === 'space') {
                event.preventDefault()
                onChange(option.value)
              }
            }}
            onClick={() => onChange(option.value)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: 5,
              paddingBottom: 5,
              paddingLeft: 12,
              paddingRight: 12,
              cursor: 'pointer',
              backgroundColor: active ? theme.accent.tint20 : undefined,
              borderLeftWidth: index === 0 ? 0 : 1,
              borderColor: theme.border,
              flexShrink: 1,
              minWidth: 0,
              hover: { backgroundColor: active ? theme.accent.tint25 : theme.fillHover },
              focusVisible: { outlineWidth: 1, outlineColor: theme.link, outlineOffset: -2 },
            }}
          >
            <div
              style={{
                fontFamily: font,
                fontSize: 12,
                fontWeight: 500,
                color: active ? theme.accent.primary : theme.text2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              {option.value}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Chat timestamp controls built from plain divs. The parent settings panel owns
 * the draft and the save footer, so changing a value here only updates the
 * shared app settings preview; nothing is persisted until the section is saved.
 */
export function ChatTimestampFormatSettings({
  showTimestamp,
  timestampFormat,
  onShowTimestampChange,
  onTimestampFormatChange,
}: ChatTimestampFormatSettingsProps) {
  const { t } = useT()

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <TimestampSettingsRow first>
        <TimestampSwitch
          checked={showTimestamp}
          label={t('settings.chat.showTimestamp')}
          onChange={onShowTimestampChange}
        />
      </TimestampSettingsRow>
      <TimestampSettingsRow last center testId="timestamp-format-row">
        <TimestampFormatToggle
          label={t('settings.chat.timestampFormat')}
          value={timestampFormat}
          onChange={onTimestampFormatChange}
        />
      </TimestampSettingsRow>
    </div>
  )
}
