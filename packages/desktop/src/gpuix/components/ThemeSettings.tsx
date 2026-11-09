import type { AppSettings, CustomPalette, ThemeMode } from '@twirchat/shared/types'
import { useState } from 'react'

import { useT, type MessageKey } from '../i18n'
import { useTextInputFocusTracking } from '../state/focus'
import { THEME_PRESETS } from '../theme'
import { useTheme } from '../theme-context'
import { ActionButton, FormField } from './ui/Form'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'
import { ToggleGroup, type ToggleGroupOption } from './ui/ToggleGroup'

const PALETTE_FIELDS: readonly { key: keyof CustomPalette; labelKey: MessageKey }[] = [
  { key: 'background', labelKey: 'themeSettings.palette.background' },
  { key: 'surface', labelKey: 'themeSettings.palette.surface' },
  { key: 'text', labelKey: 'themeSettings.palette.text' },
  { key: 'muted', labelKey: 'themeSettings.palette.muted' },
  { key: 'accent', labelKey: 'themeSettings.palette.accent' },
]

const PRESET_LABELS: Partial<Record<string, MessageKey>> = {
  dark: 'themeSettings.mode.dark',
  light: 'themeSettings.mode.light',
  midnight: 'themeSettings.preset.midnight',
  ocean: 'themeSettings.preset.ocean',
  forest: 'themeSettings.preset.forest',
  ember: 'themeSettings.preset.ember',
  rose: 'themeSettings.preset.rose',
  paper: 'themeSettings.preset.paper',
}

interface PaletteInput {
  value: string
  invalid: boolean
}

export type PaletteInputs = Partial<Record<keyof CustomPalette, PaletteInput>>

interface ThemeChoiceOption {
  id: AppSettings['theme']
  label: string
  palette: CustomPalette
}

interface ThemeSettingsProps {
  value: AppSettings['theme']
  mode: ThemeMode
  palette: CustomPalette
  inputs: PaletteInputs
  invalid: boolean
  onSelect: (value: AppSettings['theme']) => void
  onModeChange: (mode: ThemeMode) => void
  onEdit: (key: keyof CustomPalette, input: string) => void
  onReset: () => void
}

export function ThemeSettings({
  value,
  mode,
  palette,
  inputs,
  invalid,
  onSelect,
  onModeChange,
  onEdit,
  onReset,
}: ThemeSettingsProps) {
  const theme = useTheme()
  const { t } = useT()
  const selectedPreset = THEME_PRESETS.find((preset) => preset.id === value)
  const modeOptions: ToggleGroupOption<ThemeMode>[] = [
    { value: 'dark', label: t('themeSettings.mode.dark'), testId: 'theme-mode-dark' },
    { value: 'light', label: t('themeSettings.mode.light'), testId: 'theme-mode-light' },
  ]
  const options: readonly ThemeChoiceOption[] = [
    ...THEME_PRESETS.map((preset) => {
      const labelKey = PRESET_LABELS[preset.id]
      return {
        id: preset.id,
        label: labelKey ? t(labelKey) : preset.label,
        palette: mode === 'light' ? (preset.lightPalette ?? preset.palette) : preset.palette,
      }
    }),
    { id: 'custom', label: t('themeSettings.custom'), palette },
  ]
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        gap: 10,
      }}
    >
      {selectedPreset?.lightPalette ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <Text style={{ fontSize: 12, color: theme.text2 }}>{t('themeSettings.colorMode')}</Text>
          <ToggleGroup
            label={t('themeSettings.colorMode')}
            options={modeOptions}
            value={mode}
            onChange={onModeChange}
          />
        </div>
      ) : null}
      <div
        role="group"
        aria-label={t('themeSettings.themePresets')}
        style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
      >
        {options.map((option) => (
          <ThemeChoice
            key={option.id}
            {...option}
            selected={value === option.id}
            onSelect={onSelect}
          />
        ))}
      </div>
      {value === 'custom' ? (
        <div
          testId="theme-palette-editor"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 10,
            backgroundColor: theme.fill,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <Text style={{ fontSize: 12, color: theme.text2, flexShrink: 1, minWidth: 0 }}>
              {t('themeSettings.colorsPreviewHint')}
            </Text>
            <ActionButton testId="theme-palette-reset" onClick={onReset}>
              {t('themeSettings.resetToDark')}
            </ActionButton>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PALETTE_FIELDS.map(({ key, labelKey }) => (
              <PaletteField
                key={key}
                name={key}
                label={t(labelKey)}
                color={palette[key]}
                input={inputs[key]}
                onEdit={onEdit}
              />
            ))}
          </div>
          {invalid ? (
            <Text testId="theme-palette-error" style={{ fontSize: 12, color: theme.dangerText }}>
              {t('themeSettings.invalidColor')}
            </Text>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ThemeChoice({
  id,
  label,
  palette,
  selected,
  onSelect,
}: ThemeChoiceOption & {
  selected: boolean
  onSelect: ThemeSettingsProps['onSelect']
}) {
  const theme = useTheme()
  const { t } = useT()
  return (
    <div
      testId={`theme-preset-${id}`}
      role="button"
      aria-label={label}
      aria-description={selected ? t('themeSettings.selectedTheme') : undefined}
      tabIndex={0}
      onClick={() => onSelect(id)}
      onKeyDown={(event) => {
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          onSelect(id)
        }
      }}
      style={{
        width: 104,
        maxWidth: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: 7,
        borderWidth: 1,
        borderColor: selected ? theme.link : theme.border,
        borderRadius: 7,
        backgroundColor: selected ? theme.accent.tint12 : theme.fill,
        cursor: 'pointer',
        hover: { backgroundColor: selected ? theme.accent.tint20 : theme.fillHover },
        focusVisible: { outlineWidth: 1, outlineColor: theme.link, outlineOffset: 2 },
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          height: 13,
          borderRadius: 3,
          borderWidth: 1,
          borderColor: theme.hairline,
          overflow: 'hidden',
        }}
      >
        {PALETTE_FIELDS.map(({ key }) => (
          <div key={key} style={{ flexGrow: 1, flexBasis: 0, backgroundColor: palette[key] }} />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 3,
        }}
      >
        <Text
          style={{
            fontSize: 12,
            fontWeight: selected ? 700 : 500,
            color: theme.text,
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          {label}
        </Text>
        {selected ? <Icon name="check" size={12} color={theme.link} /> : null}
      </div>
    </div>
  )
}

function PaletteField({
  name,
  label,
  color,
  input,
  onEdit,
}: {
  name: keyof CustomPalette
  label: string
  color: string
  input?: PaletteInput
  onEdit: ThemeSettingsProps['onEdit']
}) {
  const theme = useTheme()
  const { t } = useT()
  const [focused, setFocused] = useState(false)
  const focus = useTextInputFocusTracking(setFocused)
  return (
    <div style={{ width: 110, maxWidth: '100%' }}>
      <FormField label={label}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <div
            style={{
              width: 16,
              height: 16,
              flexShrink: 0,
              borderWidth: 1,
              borderColor: theme.hairline,
              borderRadius: 4,
              backgroundColor: color,
            }}
          />
          <input
            {...focus}
            testId={`theme-color-${name}`}
            role="textbox"
            aria-label={t('themeSettings.palette.color', { label })}
            aria-description={input?.invalid ? t('themeSettings.palette.invalidHint') : undefined}
            tabIndex={0}
            value={input?.value ?? color}
            onChange={(event) => onEdit(name, event.value ?? '')}
            theme={{ caret: theme.accent.primary }}
            style={{
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
              fontSize: 12,
              color: theme.text,
              backgroundColor: theme.surface2,
              borderWidth: 1,
              borderColor: input?.invalid ? theme.dangerText : focused ? theme.link : theme.border,
              borderRadius: 5,
              padding: 6,
            }}
          />
        </div>
      </FormField>
    </div>
  )
}
