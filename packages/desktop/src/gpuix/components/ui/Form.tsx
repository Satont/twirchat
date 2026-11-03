import { useState, type ReactNode } from 'react'

import { useTextInputFocusTracking } from '../../state/focus'
import { accent } from '../../theme'
import { useTheme } from '../../theme-context'
import { Text } from './Text'

export function ActionButton({
  children,
  onClick,
  disabled,
  primary,
  danger,
  testId,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  danger?: boolean
  testId?: string
}) {
  const theme = useTheme()
  return (
    <div
      testId={testId}
      tabIndex={disabled ? undefined : 0}
      onClick={() => {
        if (!disabled) onClick()
      }}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'enter' || event.key === 'space')) {
          event.preventDefault()
          onClick()
        }
      }}
      style={{
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: primary ? accent.primary : theme.border,
        backgroundColor: primary ? accent.primary : theme.fill,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        flexShrink: 0,
        hover: disabled ? {} : { backgroundColor: primary ? accent.primary : theme.fillHover },
      }}
    >
      <Text
        style={{
          fontSize: 12,
          color: primary ? '#ffffff' : danger ? theme.dangerText : theme.text,
        }}
      >
        {children}
      </Text>
    </div>
  )
}

export function FormInput({
  value,
  onChange,
  placeholder,
  multiline,
  testId,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
  testId?: string
}) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const focus = useTextInputFocusTracking(setFocused)
  const props = {
    value,
    placeholder,
    testId,
    ...focus,
    onChange: (event: { value?: string }) => onChange(event.value ?? ''),
    theme: { caret: accent.primary },
    style: {
      width: '100%',
      minWidth: 0,
      fontSize: 12,
      color: theme.text,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: focused ? accent.primary : theme.border,
      borderRadius: 5,
      padding: 7,
    },
  }
  return multiline ? <textarea {...props} minRows={2} maxRows={5} /> : <input {...props} />
}

export function FormField({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>{label}</Text>
      {children}
      {hint ? <Text style={{ fontSize: 11, color: theme.text2 }}>{hint}</Text> : null}
    </div>
  )
}

export function FormError({ children }: { children?: ReactNode }) {
  const theme = useTheme()
  return children ? <Text style={{ fontSize: 12, color: theme.dangerText }}>{children}</Text> : null
}
