import { motion } from '@gpuix/react'

import { useTheme } from '../../theme-context'

export function Toast({ message }: { message: string }) {
  const theme = useTheme()
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        display: 'flex',
        justifyContent: 'center',
        width: '100%',
        padding: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.popover,
        boxShadow: {
          offsetX: 0,
          offsetY: 4,
          blurRadius: 12,
          spreadRadius: 0,
          color: '#00000066',
        },
      }}
    >
      <div style={{ fontSize: 12, color: theme.text }}>{message}</div>
    </motion.div>
  )
}
