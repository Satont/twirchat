import type { AppSettings, CustomPalette } from '@twirchat/shared/types'
import { useState } from 'react'

import { useTextInputFocusTracking } from '../state/focus'
import { THEME_PRESETS } from '../theme'
import { useTheme } from '../theme-context'
import { ActionButton, FormField } from './ui/Form'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'

const PALETTE_FIELDS: readonly { key: keyof CustomPalette; label: string }[] = [
  { key: 'background', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'text', label: 'Text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'accent', label: 'Accent' },
]

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
  palette: CustomPalette
  inputs: PaletteInputs
  invalid: boolean
  onSelect: (value: AppSettings['theme']) => void
  onEdit: (key: keyof CustomPalette, input: string) => void
  onReset: () => void
}

export function ThemeSettings({
  value,
  palette,
  inputs,
  invalid,
  onSelect,
  onEdit,
  onReset,
}: ThemeSettingsProps) {
  const theme = useTheme()
  const options: readonly ThemeChoiceOption[] = [
    ...THEME_PRESETS,
    { id: 'custom', label: 'Custom', palette },
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
      <div
        role="group"
        aria-label="Theme presets"
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
              Colors preview live and adjust for contrast when needed.
            </Text>
            <ActionButton testId="theme-palette-reset" onClick={onReset}>
              Reset to Dark
            </ActionButton>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PALETTE_FIELDS.map(({ key, label }) => (
              <PaletteField
                key={key}
                name={key}
                label={label}
                color={palette[key]}
                input={inputs[key]}
                onEdit={onEdit}
              />
            ))}
          </div>
          {invalid ? (
            <Text testId="theme-palette-error" style={{ fontSize: 12, color: theme.dangerText }}>
              Enter a hex color like #a78bfa in each marked field.
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
  return (
    <div
      testId={`theme-preset-${id}`}
      role="button"
      aria-label={label}
      aria-description={selected ? 'Selected theme' : undefined}
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
        <Text style={{ fontSize: 12, fontWeight: selected ? 700 : 500, color: theme.text }}>
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
            aria-label={`${label} color`}
            aria-description={input?.invalid ? 'Enter a hex color' : undefined}
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
