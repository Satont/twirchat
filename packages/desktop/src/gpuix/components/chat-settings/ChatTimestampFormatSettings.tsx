import { SettingsSectionContext } from '@gpuix/components/settings/SettingsLayout'
import { useT } from '@gpuix/i18n'
import type { StyleDesc } from '@gpuix/native/host'
import { highlightParts } from '@gpuix/settings-highlight'
import { useFont, useTheme } from '@gpuix/theme-context'
import { formatMessageTime } from '@gpuix/timestamp-format'
import type { TimestampFormat } from '@twirchat/shared/types'
import { useContext, useMemo, type ReactNode } from 'react'

const SAMPLE_TIME = new Date(2026, 0, 1, 21, 41, 2, 123)
const TOGGLE_RADIUS = 8
const TOGGLE_EDGE_RADIUS = TOGGLE_RADIUS - 1

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
  centerControl?: boolean
  label: string
  hint?: string
  testId?: string
  children: ReactNode
}

interface HighlightedTextProps {
  text: string
  query: string
  textStyle: StyleDesc
  highlightColor: string
}

interface KeyedHighlightPart {
  readonly text: string
  readonly highlighted: boolean
  readonly key: number
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

function HighlightedText({ text, query, textStyle, highlightColor }: HighlightedTextProps) {
  const parts = useMemo(() => {
    const keyed: KeyedHighlightPart[] = []
    let offset = 0
    for (const part of highlightParts(text, query)) {
      keyed.push({ ...part, key: offset })
      offset += part.text.length
    }
    return keyed
  }, [text, query])
  if (!parts.some((part) => part.highlighted)) {
    return <div style={textStyle}>{text}</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', ...textStyle }}>
      {parts.map((part) => (
        <div
          key={part.key}
          style={part.highlighted ? { ...textStyle, color: highlightColor } : textStyle}
        >
          {part.text}
        </div>
      ))}
    </div>
  )
}

function TimestampSettingsRow({
  first,
  last,
  centerControl,
  label,
  hint,
  testId,
  children,
}: TimestampSettingsRowProps) {
  const theme = useTheme()
  const font = useFont()
  const { narrow, query } = useContext(SettingsSectionContext)
  return (
    <div
      testId={testId}
      style={{
        display: 'flex',
        flexDirection: narrow ? 'column' : 'row',
        alignItems: narrow ? 'stretch' : 'center',
        justifyContent: 'space-between',
        gap: 16,
        paddingTop: first ? 0 : 12,
        paddingBottom: last ? 0 : 10,
        borderBottomWidth: last ? 0 : 1,
        borderColor: theme.border,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
          ...(narrow ? {} : { flexBasis: 220, flexShrink: 0 }),
        }}
      >
        <HighlightedText
          text={label}
          query={query}
          highlightColor={theme.link}
          textStyle={{ fontFamily: font, fontSize: 14, fontWeight: 500, color: theme.text }}
        />
        {hint ? (
          <HighlightedText
            text={hint}
            query={query}
            highlightColor={theme.link}
            textStyle={{ fontFamily: font, fontSize: 11, fontWeight: 400, color: theme.text2 }}
          />
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: centerControl ? 'center' : 'flex-end',
          flexGrow: centerControl ? 1 : 0,
          flexShrink: 1,
          minWidth: 0,
        }}
      >
        {children}
      </div>
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
        borderRadius: TOGGLE_RADIUS,
        overflow: 'hidden',
        flexShrink: 1,
      }}
    >
      {TIMESTAMP_FORMAT_OPTIONS.map((option, index) => {
        const active = option.value === value
        const first = index === 0
        const last = index === TIMESTAMP_FORMAT_OPTIONS.length - 1
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
              borderLeftWidth: first ? 0 : 1,
              borderColor: theme.border,
              borderTopLeftRadius: first ? TOGGLE_EDGE_RADIUS : 0,
              borderBottomLeftRadius: first ? TOGGLE_EDGE_RADIUS : 0,
              borderTopRightRadius: last ? TOGGLE_EDGE_RADIUS : 0,
              borderBottomRightRadius: last ? TOGGLE_EDGE_RADIUS : 0,
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
  const example = formatMessageTime(SAMPLE_TIME, timestampFormat)

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <TimestampSettingsRow
        first
        label={t('settings.chat.showTimestamp')}
        hint={t('settings.chat.showTimestampHint')}
      >
        <TimestampSwitch
          checked={showTimestamp}
          label={t('settings.chat.showTimestamp')}
          onChange={onShowTimestampChange}
        />
      </TimestampSettingsRow>
      <TimestampSettingsRow
        last
        centerControl
        testId="timestamp-format-row"
        label={t('settings.chat.timestampFormat')}
        hint={t('settings.chat.timestampFormatHint', { example })}
      >
        <TimestampFormatToggle
          label={t('settings.chat.timestampFormat')}
          value={timestampFormat}
          onChange={onTimestampFormatChange}
        />
      </TimestampSettingsRow>
    </div>
  )
}
