import { useState, type ReactNode } from 'react'

import { useT } from '../../i18n'
import { useTheme } from '../../theme-context'
import { ActionButton } from '../ui/Form'
import { Text } from '../ui/Text'

export function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <Text style={{ color: theme.text, fontSize: 14, fontWeight: 600 }}>{title}</Text>
        {action}
      </div>
      {children}
    </div>
  )
}

export function Choice({
  label,
  value,
  values,
  onChange,
  disabled = false,
}: {
  label: string
  value: string
  values: string[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const theme = useTheme()
  const { t } = useT()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
      <ActionButton disabled={disabled} onClick={() => setOpen(!open)}>
        {`${label}: ${value || t('obsRemote.choice.select')} ▾`}
      </ActionButton>
      {open && !disabled ? (
        <div
          style={{
            maxHeight: 180,
            overflowY: 'scroll',
            backgroundColor: theme.surface2,
            padding: 4,
            gap: 3,
          }}
        >
          {values.map((option) => (
            <ActionButton
              key={option}
              primary={option === value}
              onClick={() => {
                setOpen(false)
                onChange(option)
              }}
            >
              {option}
            </ActionButton>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function timecode(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, '0')}:${Math.floor((seconds / 60) % 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
