import { Text } from '@gpuix/components/ui/Text'
import { useTheme } from '@gpuix/theme-context'

export function GhostButton({
  disabled,
  onClick,
  children,
  style,
}: {
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  style?: Record<string, unknown>
}) {
  const theme = useTheme()
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        backgroundColor: 'transparent',
        borderRadius: 8,
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 16,
        paddingRight: 16,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        hover: disabled ? {} : { backgroundColor: theme.fillHover },
        ...style,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: 500, color: theme.text }}>{children}</Text>
    </div>
  )
}

export function InlineButton({
  disabled,
  onClick,
  children,
  style,
}: {
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  style?: Record<string, unknown>
}) {
  const theme = useTheme()
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        borderRadius: 8,
        backgroundColor: theme.accent.primary,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 12,
        paddingRight: 12,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        hover: disabled ? {} : { opacity: 0.9 },
        ...style,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: 500, color: theme.accent.onPrimary }}>
        {children}
      </Text>
    </div>
  )
}

export function MetadataState({ error, children }: { error?: boolean; children: React.ReactNode }) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: error ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        minHeight: 100,
        padding: 20,
        borderWidth: 1,
        borderColor: theme.hairline,
        borderRadius: 12,
        backgroundColor: theme.surface,
      }}
    >
      {children}
    </div>
  )
}

export function HeaderPill({ accent, children }: { accent?: boolean; children: string }) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        minHeight: 26,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 999,
        backgroundColor: accent
          ? theme.accent.primary
          : theme.isLight
            ? theme.fill
            : 'rgba(0, 0, 0, 0.25)',
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: accent ? theme.accent.onPrimary : theme.text,
        }}
      >
        {children}
      </Text>
    </div>
  )
}
