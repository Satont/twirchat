import { Icon } from '@gpuix/components/ui/Icon'
import { Text } from '@gpuix/components/ui/Text'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'

import { TABS } from './consts'
import type { UserCardTabsProps } from './types'
import { userCardWellColor, accentGradient, accentGlow } from './utils'

export function UserCardTabs({ tab, setTab }: UserCardTabsProps) {
  const theme = useTheme()
  const { t } = useT()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginBottom: 16,
        padding: 4,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.hairline,
        backgroundColor: userCardWellColor(theme),
      }}
    >
      {TABS.map(({ id, labelKey, icon }) => {
        const active = tab === id
        return (
          <div
            key={id}
            testId={`user-card-tab-${id}`}
            tabIndex={0}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              if (event.key === 'enter' || event.key === 'space') {
                event.preventDefault()
                setTab(id)
              }
            }}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              flexGrow: 1,
              flexBasis: 140,
              minHeight: 36,
              paddingTop: 8,
              paddingBottom: 8,
              paddingLeft: 10,
              paddingRight: 10,
              borderRadius: 9,
              background: active ? accentGradient(theme) : 'transparent',
              borderWidth: 1,
              borderColor: active ? theme.accent.deep : 'transparent',
              boxShadow: active ? accentGlow(theme) : undefined,
              cursor: 'pointer',
              userSelect: 'none',
              hover: active ? {} : { backgroundColor: theme.fillHover },
              active: { opacity: 0.82 },
              focusVisible: {
                outlineWidth: 2,
                outlineColor: theme.accent.primary,
                outlineOffset: 2,
              },
            }}
          >
            <Icon name={icon} size={14} color={active ? theme.accent.onDeep : theme.text2} />
            <Text
              style={{
                fontSize: 12,
                fontWeight: active ? 700 : 600,
                textAlign: 'center',
                color: active ? theme.accent.onDeep : theme.text2,
              }}
            >
              {t(labelKey)}
            </Text>
          </div>
        )
      })}
    </div>
  )
}
