import { useTheme } from '@gpuix/theme-context'

import type { HistoryStateProps } from './types'

export function HistoryState({ minHeight, error, children }: HistoryStateProps) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: error ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        minHeight,
        padding: 16,
        borderWidth: 1,
        borderColor: theme.hairline,
        borderRadius: 10,
        backgroundColor: theme.fill,
      }}
    >
      {children}
    </div>
  )
}
