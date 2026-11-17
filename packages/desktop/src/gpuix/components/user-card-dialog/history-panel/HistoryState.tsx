import { useTheme } from '@gpuix/theme-context'

interface HistoryStateProps {
  minHeight: number
  error?: boolean
  children: React.ReactNode
}

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
