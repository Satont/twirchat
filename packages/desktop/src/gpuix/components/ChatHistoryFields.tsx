import { useState, type ReactNode } from 'react'

import { useTextInputFocusTracking } from '../state/focus'
import { useTheme } from '../theme-context'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

export function HistoryField({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexGrow: 1, minWidth: 120 }}>
      <Text style={{ fontSize: 11, color: theme.text2 }}>{label}</Text>
      {children}
    </div>
  )
}
export function HistoryInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  testId?: string
}) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const focus = useTextInputFocusTracking(setFocused)
  return (
    <input
      testId={testId}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.value ?? '')}
      {...focus}
      theme={{ caret: theme.accent.primary }}
      style={{
        width: '100%',
        minWidth: 0,
        backgroundColor: theme.surface2,
        borderWidth: 1,
        borderColor: focused ? theme.link : theme.border,
        borderRadius: 6,
        color: theme.text,
        fontSize: 12,
        padding: 8,
      }}
    />
  )
}
export function HistoryButton({
  label,
  onClick,
  disabled = false,
  primary = false,
  testId,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  testId?: string
}) {
  const theme = useTheme()
  return (
    <div
      testId={testId}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'enter' || event.key === 'space')) {
          event.preventDefault()
          onClick()
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 6,
        backgroundColor: primary ? theme.accent.tint20 : theme.fill,
        borderWidth: 1,
        borderColor: primary ? theme.link : theme.hairline,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: primary ? theme.link : theme.text,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Text>
    </div>
  )
}
export function HistoryChoices<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
      {options.map((option) => (
        <HistoryButton
          key={option.value}
          label={option.label}
          primary={option.value === value}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  )
}
export function HistoryToggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  const theme = useTheme()
  return (
    <div
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          onChange(!checked)
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <Text style={{ fontSize: 12, color: theme.text }}>{label}</Text>
      <Switch checked={checked} onChange={onChange} small />
    </div>
  )
}
