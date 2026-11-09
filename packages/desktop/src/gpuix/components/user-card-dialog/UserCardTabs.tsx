import { ActionButton } from '@gpuix/components/ui/Form'

type TabName = 'profile' | 'actions' | 'notes' | 'history'

interface TabConfig {
  id: TabName
  label: string
}

const TABS: TabConfig[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'actions', label: 'Actions & moderation' },
  { id: 'notes', label: 'Notes' },
  { id: 'history', label: 'History' },
]

interface UserCardTabsProps {
  tab: TabName
  setTab: (tab: TabName) => void
}

export function UserCardTabs({ tab, setTab }: UserCardTabsProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 4,
        marginBottom: 16,
        padding: 4,
        borderRadius: 10,
        borderWidth: 1,
      }}
    >
      {TABS.map(({ id, label }) => (
        <ActionButton
          key={id}
          primary={tab === id}
          onClick={() => setTab(id)}
          style={{
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 16,
            paddingRight: 16,
            justifyContent: 'center',
            borderRadius: 8,
            flex: 1,
          }}
          textStyle={{ fontSize: 13, fontWeight: 500 }}
        >
          {label}
        </ActionButton>
      ))}
    </div>
  )
}
