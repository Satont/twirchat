import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'

import type { StreamerModeStatus } from '../../services/streamer-mode'
import { useT, type MessageKey } from '../i18n'
import { accountsStore, activeTabStore, type MainTab } from '../state/app'
import { useStore, useStoreSelector } from '../state/create-store'
import { setMainTab } from '../state/settings-session'
import { streamerModeStore } from '../state/streamer-mode'
import { useTheme } from '../theme-context'
import { Icon, type IconName } from './ui/Icon'
import { describeStreamerMode, StreamerModeDot } from './ui/StreamerModeIndicator'
import { Text } from './ui/Text'

interface NavItem {
  id: MainTab
  labelKey: MessageKey
  icon: IconName
}

const ITEMS: readonly NavItem[] = [
  { id: 'chat', labelKey: 'app.nav.chat', icon: 'chat' },
  { id: 'platforms', labelKey: 'app.nav.platforms', icon: 'globe' },
  { id: 'settings', labelKey: 'app.nav.settings', icon: 'settings' },
  { id: 'obs-remote', labelKey: 'app.nav.obsRemote', icon: 'monitor' },
]

function NavButton({
  testId,
  label,
  icon,
  active,
  badge,
  streamerMode,
  select,
}: {
  testId: string
  label: string
  icon: IconName
  active: boolean
  badge?: number
  streamerMode?: StreamerModeStatus
  select: () => void
}) {
  const theme = useTheme()
  const { t } = useT()
  const status = streamerMode ? describeStreamerMode(streamerMode) : undefined

  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <div
          testId={testId}
          role="button"
          aria-label={label}
          aria-description={
            [active ? t('app.nav.currentView') : '', status].filter(Boolean).join('. ') || undefined
          }
          tabIndex={0}
          onClick={select}
          onKeyDown={(event) => {
            if (event.key === 'enter' || event.key === 'space') {
              event.preventDefault()
              select()
            }
          }}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 6,
            cursor: 'pointer',
            backgroundColor: active ? theme.navActiveBg : undefined,
            hover: { backgroundColor: active ? theme.navActiveBg : theme.fillHover },
            focusVisible: { outlineWidth: 1, outlineColor: theme.link, outlineOffset: 1 },
          }}
        >
          <Icon name={icon} size={16} color={active ? theme.link : theme.text2} />
          {badge !== undefined && badge > 0 ? (
            <div
              style={{
                position: 'absolute',
                top: -1,
                right: -2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 12,
                height: 13,
                paddingLeft: 2,
                paddingRight: 2,
                borderRadius: 7,
                borderWidth: 1,
                borderColor: theme.navBg,
                backgroundColor: theme.surface2,
                pointerEvents: 'none',
              }}
            >
              <Text
                style={{ fontSize: 9, fontWeight: 700, color: theme.successText, lineHeight: 11 }}
              >
                {badge > 99 ? '99+' : String(badge)}
              </Text>
            </div>
          ) : null}
          {streamerMode?.effectiveEnabled ? (
            <StreamerModeDot style={{ position: 'absolute', top: 4, right: 3 }} />
          ) : null}
        </div>
      </TooltipTrigger>
      <TooltipContent
        testId={status ? 'streamer-mode-tooltip' : undefined}
        side="bottom"
        align="start"
        sideOffset={6}
        style={{
          backgroundColor: theme.popover,
          borderWidth: 1,
          borderColor: theme.dialogBorder,
          borderRadius: 6,
          padding: 6,
        }}
      >
        <Text style={{ fontSize: 11, color: theme.text }}>{label}</Text>
        {status ? <Text style={{ fontSize: 11, color: theme.text2 }}>{status}</Text> : null}
      </TooltipContent>
    </Tooltip>
  )
}

export function AppNavigation({ onSearchAll }: { onSearchAll?: () => void }) {
  const { t, tPlural } = useT()
  const theme = useTheme()
  const activeTab = useStore(activeTabStore)
  const accountCount = useStoreSelector(accountsStore, (accounts) => accounts.length)
  const streamerMode = useStore(streamerModeStore)

  return (
    <div
      testId="app-navigation"
      role="navigation"
      aria-label={t('app.nav.mainNavigation')}
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexShrink: 0,
        alignSelf: 'flex-start',
        alignItems: 'center',
        gap: 4,
        paddingBottom: 2,
        marginRight: 6,
        userSelect: 'none',
      }}
    >
      {ITEMS.map((item) => {
        const badge = item.id === 'platforms' ? accountCount : undefined
        return (
          <NavButton
            key={item.id}
            testId={`nav-${item.id}`}
            label={
              badge === undefined
                ? t(item.labelKey)
                : `${t(item.labelKey)} (${tPlural('app.nav.accountBadge', badge)})`
            }
            icon={item.icon}
            active={activeTab === item.id}
            badge={badge}
            streamerMode={item.id === 'settings' ? streamerMode : undefined}
            select={() => setMainTab(item.id)}
          />
        )
      })}
      {onSearchAll ? (
        <>
          <div
            testId="nav-divider"
            style={{
              width: 1,
              height: 18,
              flexShrink: 0,
              marginLeft: 2,
              marginRight: 2,
              backgroundColor: theme.border,
            }}
          />
          <NavButton
            testId="nav-search-all"
            label={t('app.nav.searchAll')}
            icon="search"
            active={false}
            select={onSearchAll}
          />
        </>
      ) : null}
    </div>
  )
}
