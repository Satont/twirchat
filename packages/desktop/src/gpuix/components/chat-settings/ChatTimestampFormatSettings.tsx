import { SettingsSectionContext } from '@gpuix/components/settings/SettingsLayout'
import { useT } from '@gpuix/i18n'
import { useFont, useTheme } from '@gpuix/theme-context'
import { formatMessageTime } from '@gpuix/timestamp-format'
import { useContext } from 'react'

import { HighlightText } from '../ui/HighlightText'
import { SAMPLE_TIME, TIMESTAMP_FORMAT_OPTIONS, TOGGLE } from './consts'
import type {
  ChatTimestampFormatSettingsProps,
  TimestampFormatOptionProps,
  TimestampFormatToggleProps,
  TimestampSettingsRowProps,
  TimestampSwitchProps,
} from './types'
import { handleActivation } from './utils'

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
        <HighlightText
          text={label}
          query={query}
          style={{ fontSize: 14, fontWeight: 500, color: theme.text }}
        />

        {hint ? (
          <HighlightText
            text={hint}
            query={query}
            style={{ fontSize: 11, fontWeight: 400, color: theme.text2 }}
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

  const travel = TOGGLE.width - TOGGLE.knob - TOGGLE.inset * 2

  return (
    <div
      testId="show-timestamp"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(event) => handleActivation(event, () => onChange(!checked))}
      style={{
        width: TOGGLE.width,
        height: TOGGLE.height,
        borderRadius: TOGGLE.height / 2,
        backgroundColor: checked ? theme.accent.primary : theme.scrollbar,
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        userSelect: 'none',
        focusVisible: {
          outlineWidth: 1,
          outlineColor: theme.link,
          outlineOffset: 2,
        },
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: TOGGLE.inset,
          left: checked ? TOGGLE.inset + travel : TOGGLE.inset,
          width: TOGGLE.knob,
          height: TOGGLE.knob,
          borderRadius: TOGGLE.knob / 2,
          backgroundColor: checked ? theme.accent.onPrimary : theme.text2,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

function TimestampFormatOption({
  value,
  active,
  first,
  last,
  testId,
  onChange,
}: TimestampFormatOptionProps) {
  const theme = useTheme()
  const font = useFont()
  const { t } = useT()

  return (
    <div
      testId={testId}
      role="button"
      aria-label={value}
      aria-description={active ? t('misc.toggle.selected') : undefined}
      tabIndex={0}
      onClick={() => onChange(value)}
      onKeyDown={(event) => handleActivation(event, () => onChange(value))}
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
        borderTopLeftRadius: first ? TOGGLE.edgeRadius : 0,
        borderBottomLeftRadius: first ? TOGGLE.edgeRadius : 0,
        borderTopRightRadius: last ? TOGGLE.edgeRadius : 0,
        borderBottomRightRadius: last ? TOGGLE.edgeRadius : 0,
        flexShrink: 1,
        minWidth: 0,
        hover: {
          backgroundColor: active ? theme.accent.tint25 : theme.fillHover,
        },
        focusVisible: {
          outlineWidth: 1,
          outlineColor: theme.link,
          outlineOffset: -2,
        },
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
        {value}
      </div>
    </div>
  )
}

function TimestampFormatToggle({ label, value, onChange }: TimestampFormatToggleProps) {
  const theme = useTheme()

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
        borderRadius: TOGGLE.radius,
        overflow: 'hidden',
        flexShrink: 1,
      }}
    >
      {TIMESTAMP_FORMAT_OPTIONS.map((option, index) => {
        const active = option.value === value

        return (
          <TimestampFormatOption
            key={option.value}
            {...option}
            active={active}
            first={index === 0}
            last={index === TIMESTAMP_FORMAT_OPTIONS.length - 1}
            onChange={onChange}
          />
        )
      })}
    </div>
  )
}

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
