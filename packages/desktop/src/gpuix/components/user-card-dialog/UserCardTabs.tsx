import { ActionButton } from '@gpuix/components/ui/Form'
import { useT, type MessageKey } from '@gpuix/i18n'

type TabName = 'profile' | 'actions' | 'notes' | 'history'

interface TabConfig {
  id: TabName
  labelKey: MessageKey
}

const TABS: TabConfig[] = [
  { id: 'profile', labelKey: 'userCard.tab.profile' },
  { id: 'actions', labelKey: 'userCard.tab.actions' },
  { id: 'notes', labelKey: 'userCard.tab.notes' },
  { id: 'history', labelKey: 'userCard.tab.history' },
]

interface UserCardTabsProps {
  tab: TabName
  setTab: (tab: TabName) => void
}

export function UserCardTabs({ tab, setTab }: UserCardTabsProps) {
  const { t } = useT()
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
      {TABS.map(({ id, labelKey }) => (
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
          {t(labelKey)}
        </ActionButton>
      ))}
    </div>
  )
}
