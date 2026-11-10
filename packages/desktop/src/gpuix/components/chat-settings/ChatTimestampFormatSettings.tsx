import { SettingsRow } from '@gpuix/components/settings/SettingsLayout'
import { Switch } from '@gpuix/components/ui/Switch'
import { ToggleGroup, type ToggleGroupOption } from '@gpuix/components/ui/ToggleGroup'
import { useT } from '@gpuix/i18n'
import { formatMessageTime } from '@gpuix/timestamp-format'
import type { TimestampFormat } from '@twirchat/shared/types'

const SAMPLE_TIME = new Date(2026, 0, 1, 21, 41, 2, 123)

const TIMESTAMP_FORMAT_OPTIONS: readonly ToggleGroupOption<TimestampFormat>[] = [
  { value: 'HH:MM:SS', label: 'HH:MM:SS', testId: 'timestamp-format-hh-mm-ss' },
  { value: 'HH:MM', label: 'HH:MM', testId: 'timestamp-format-hh-mm' },
  { value: 'HH:MM:SS.sss', label: 'HH:MM:SS.sss', testId: 'timestamp-format-hh-mm-ss-sss' },
  { value: 'hh:MM A', label: 'hh:MM A', testId: 'timestamp-format-hh-mm-a' },
  { value: 'hh:MM:SS A', label: 'hh:MM:SS A', testId: 'timestamp-format-hh-mm-ss-a' },
]

interface ChatTimestampFormatSettingsProps {
  showTimestamp: boolean
  timestampFormat: TimestampFormat
  onShowTimestampChange: (value: boolean) => void
  onTimestampFormatChange: (value: TimestampFormat) => void
}

/**
 * Chat timestamp controls. The parent settings panel owns the draft and the
 * save footer, so changing a value here only updates the shared app settings
 * preview; nothing is persisted until the section is saved.
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
    <>
      <SettingsRow
        first
        label={t('settings.chat.showTimestamp')}
        hint={t('settings.chat.showTimestampHint')}
      >
        <Switch checked={showTimestamp} onChange={onShowTimestampChange} />
      </SettingsRow>
      <SettingsRow
        last
        alignTop
        label={t('settings.chat.timestampFormat')}
        hint={t('settings.chat.timestampFormatHint', { example })}
      >
        <ToggleGroup
          label={t('settings.chat.timestampFormat')}
          value={timestampFormat}
          options={TIMESTAMP_FORMAT_OPTIONS}
          onChange={onTimestampFormatChange}
        />
      </SettingsRow>
    </>
  )
}
