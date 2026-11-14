interface ChangelogItemProps {
  item: { label: string; description: string }
  theme: ReturnType<typeof import('../../theme-context').useTheme>
}

export function ChangelogItem({ item, theme }: ChangelogItemProps) {
  const shortLabel = item.label.split(':')[0]!
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
        paddingTop: 6,
        paddingLeft: 15,
        paddingBottom: 8,
        borderRadius: 8,
        backgroundColor: theme.accent.deep02,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
        <div style={{ fontSize: 18, color: 'white', fontWeight: 500 }}>{shortLabel}</div>
        <div style={{ fontSize: 16, color: 'darkgray', fontWeight: 100, whiteSpace: 'normal' }}>
          {item.description}
        </div>
      </div>
    </div>
  )
}
