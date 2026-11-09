/**
 * Toggle switch — port of the Vue .switch / .ap-switch styles.
 * 40×22 (default) or 34×19 (small). The knob animates with motion.div.
 */

import { motion } from '@gpuix/react'

import { useTheme } from '../../theme-context'

export function Switch({
  checked,
  onChange,
  small,
  testId,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  small?: boolean
  testId?: string
}) {
  const theme = useTheme()
  const width = small ? 34 : 40
  const height = small ? 19 : 22
  const knob = small ? 14 : 16
  const inset = small ? 2.5 : 3
  const travel = width - knob - inset * 2

  return (
    <div
      testId={testId}
      onClick={() => onChange(!checked)}
      style={{
        width,
        height,
        borderRadius: height / 2,
        backgroundColor: checked ? theme.accent.primary : theme.scrollbar,
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      <motion.div
        initial={false}
        animate={{ left: checked ? inset + travel : inset }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        style={{
          position: 'absolute',
          top: inset,
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
