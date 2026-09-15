/**
 * Toggle switch — port of the Vue .switch / .ap-switch styles.
 * 40×22 (default) or 34×19 (small). The knob animates with motion.div.
 */

import { motion } from '@gpuix/react'
import { accent } from '../../theme'

export function Switch({
  checked,
  onChange,
  small,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  small?: boolean
}) {
  const width = small ? 34 : 40
  const height = small ? 19 : 22
  const knob = small ? 14 : 16
  const inset = small ? 2.5 : 3
  const travel = width - knob - inset * 2

  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width,
        height,
        borderRadius: height / 2,
        backgroundColor: checked ? accent.primary : 'rgba(255, 255, 255, 0.12)',
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
          backgroundColor: checked ? '#ffffff' : 'rgba(255, 255, 255, 0.5)',
        }}
      />
    </div>
  )
}
