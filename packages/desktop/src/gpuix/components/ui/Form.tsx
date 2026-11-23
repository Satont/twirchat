import type { ActionClickEvent } from '@gpuix/components/action-toast'
import { withAlpha } from '@gpuix/theme'
import { useState, type ReactNode } from 'react'

import { useTextInputFocusTracking } from '../../state/focus'
import { useTheme } from '../../theme-context'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

export function ActionButton({
  children,
  onClick,
  disabled,
  primary,
  danger,
  active,
  icon,
  autoFocus,
  testId,
  style,
  textStyle,
}: {
  children: ReactNode
  onClick: (event?: ActionClickEvent) => void
  disabled?: boolean
  primary?: boolean
  danger?: boolean
  active?: boolean
  icon?: IconName
  autoFocus?: boolean
  testId?: string
  style?: Record<string, unknown>
  textStyle?: Record<string, unknown>
}) {
  const theme = useTheme()
  const foreground =
    danger || active ? theme.dangerText : primary ? theme.accent.onPrimary : theme.text
  return (
    <div
      testId={testId}
      tabIndex={disabled ? undefined : 0}
      autoFocus={!disabled && autoFocus}
      onClick={(event) => {
        if (!disabled) onClick(event)
      }}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'enter' || event.key === 'space')) {
          event.preventDefault()
          onClick()
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: active
          ? withAlpha(theme.dangerText, 0.35)
          : primary
            ? theme.accent.primary
            : theme.border,
        backgroundColor: active
          ? withAlpha(theme.dangerText, 0.12)
          : primary
            ? theme.accent.primary
            : theme.fill,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        flexShrink: 0,
        hover: disabled
          ? {}
          : {
              backgroundColor: active
                ? withAlpha(theme.dangerText, 0.2)
                : primary
                  ? theme.accent.primary
                  : theme.fillHover,
            },
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={foreground} /> : null}
      <Text style={{ fontSize: 12, color: foreground, ...textStyle }}>{children}</Text>
    </div>
  )
}

export function FormInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  multiline,
  testId,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
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
    onSubmit,
    ...focus,
    onChange: (event: { value?: string }) => onChange(event.value ?? ''),
    theme: { caret: theme.accent.primary },
    style: {
      width: '100%',
      minWidth: 0,
      fontSize: 12,
      color: theme.text,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: focused ? theme.accent.primary : theme.border,
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
  label?: string
  children: ReactNode
  hint?: string
}) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      {label ? (
        <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>{label}</Text>
      ) : null}
      {children}
      {hint ? <Text style={{ fontSize: 11, color: theme.text2 }}>{hint}</Text> : null}
    </div>
  )
}

export function FormError({ children }: { children?: ReactNode }) {
  const theme = useTheme()
  return children ? <Text style={{ fontSize: 12, color: theme.dangerText }}>{children}</Text> : null
}
