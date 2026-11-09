import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'

import type { StreamerModeStatus } from '../../services/streamer-mode'
import { accountsStore, activeTabStore, showNotice, type MainTab } from '../state/app'
import { useStore, useStoreSelector } from '../state/create-store'
import { useDesktopWindows } from '../state/desktop-windows'
import { streamerModeStore } from '../state/streamer-mode'
import { useTheme } from '../theme-context'
import { Icon, type IconName } from './ui/Icon'
import { describeStreamerMode, StreamerModeDot } from './ui/StreamerModeIndicator'
import { Text } from './ui/Text'

interface NavItem<Id extends string = MainTab> {
  id: Id
  label: string
  icon: IconName
}

const ITEMS: readonly NavItem[] = [
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'platforms', label: 'Platforms', icon: 'globe' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]
const OBS_REMOTE_ITEM: NavItem<'obs-remote'> = {
  id: 'obs-remote',
  label: 'OBS Remote',
  icon: 'monitor',
}

function NavItemButton({
  item,
  active,
  badge,
  streamerMode,
  select,
}: {
  item: NavItem<MainTab | 'obs-remote'>
  active: boolean
  badge?: number
  streamerMode?: StreamerModeStatus
  select: () => void
}) {
  const theme = useTheme()
  const label =
    badge === undefined
      ? item.label
      : `${item.label} (${badge} ${badge === 1 ? 'account' : 'accounts'})`
  const status = streamerMode ? describeStreamerMode(streamerMode) : undefined

  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <div
          testId={`nav-${item.id}`}
          role="button"
          aria-label={label}
          aria-description={
            [active ? 'Current view' : '', status].filter(Boolean).join('. ') || undefined
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
          <Icon name={item.icon} size={16} color={active ? theme.link : theme.text2} />
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

export function AppNavigation() {
  const activeTab = useStore(activeTabStore)
  const accountCount = useStoreSelector(accountsStore, (accounts) => accounts.length)
  const streamerMode = useStore(streamerModeStore)
  const windows = useDesktopWindows()

  return (
    <div
      testId="app-navigation"
      role="navigation"
      aria-label="Main navigation"
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
      {ITEMS.map((item) => (
        <NavItemButton
          key={item.id}
          item={item}
          active={activeTab === item.id}
          badge={item.id === 'platforms' ? accountCount : undefined}
          streamerMode={item.id === 'settings' ? streamerMode : undefined}
          select={() => activeTabStore.set(item.id)}
        />
      ))}
      {windows ? (
        <NavItemButton
          item={OBS_REMOTE_ITEM}
          active={false}
          select={() => {
            void windows
              .openObsRemote()
              .catch((error: unknown) => showNotice('error', String(error)))
          }}
        />
      ) : null}
    </div>
  )
}
