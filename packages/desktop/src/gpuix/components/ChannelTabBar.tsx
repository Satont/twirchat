/**
 * Channel tab bar — port of ChannelTabBar.vue.
 * GPUIX delta: HTML5 drag-reorder is not available, so tab reordering is
 * omitted (see MIGRATION notes).
 */

import { useState } from 'react'
import type { PlatformStatusInfo, WatchedChannel } from '@twirchat/shared/types'

import { platformColor } from '../theme'
import { useTheme } from '../theme-context'
import { Icon, PlatformIcon } from './ui/Icon'
import { Text } from './ui/Text'

export interface WatchedLiveStatus {
  isLive: boolean
  viewerCount?: number
}

function formatViewers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export function ChannelTabBar({
  watchedChannels,
  activeTabId,
  watchedLiveStatuses,
  homeViewerCount,
  tabChannelNames,
  onSelectTab,
  onAddChannel,
  onRemoveChannel,
}: {
  watchedChannels: WatchedChannel[]
  activeTabId: string
  watchedStatuses: Map<string, PlatformStatusInfo>
  watchedLiveStatuses: Map<string, WatchedLiveStatus>
  homeViewerCount?: number
  tabChannelNames?: Map<string, string[]>
  onSelectTab: (id: string) => void
  onAddChannel: () => void
  onRemoveChannel: (id: string) => void
}) {
  const theme = useTheme()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingTop: 6,
        paddingLeft: 8,
        paddingRight: 8,
        borderBottomWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.navBg,
        flexShrink: 0,
        overflowX: 'scroll',
        userSelect: 'none',
      }}
    >
      {/* Home tab */}
      <Tab
        testId="tab-home"
        label="My channels"
        icon={
          <Icon name="home" size={13} color={activeTabId === 'home' ? theme.text : theme.text2} />
        }
        active={activeTabId === 'home'}
        activeColor={theme.text}
        viewers={homeViewerCount}
        onClick={() => onSelectTab('home')}
      />

      {watchedChannels.map((ch) => {
        const live = watchedLiveStatuses.get(ch.id)
        const names = tabChannelNames?.get(ch.id)
        const label = names && names.length > 0 ? names.join(', ') : ch.displayName
        const active = activeTabId === ch.id
        const color = platformColor(ch.platform)
        return (
          <WatchedTab
            key={ch.id}
            testId={`tab-${ch.id}`}
            label={label}
            platform={ch.platform}
            active={active}
            live={live?.isLive === true}
            viewers={live?.isLive ? live.viewerCount : undefined}
            color={color}
            onClick={() => onSelectTab(ch.id)}
            onClose={() => onRemoveChannel(ch.id)}
          />
        )
      })}

      {/* Add button */}
      <div
        testId="tab-add"
        onClick={onAddChannel}
        style={{
          paddingTop: 5,
          paddingBottom: 6,
          paddingLeft: 8,
          paddingRight: 8,
          cursor: 'pointer',
          opacity: 0.5,
          flexShrink: 0,
          display: 'flex',
          hover: { opacity: 1 },
        }}
      >
        <Icon name="plus" size={14} color={theme.text2} />
      </div>
    </div>
  )
}

function Tab({
  label,
  icon,
  active,
  activeColor,
  viewers,
  onClick,
  testId,
}: {
  label: string
  icon?: React.ReactNode
  active: boolean
  activeColor: string
  viewers?: number
  onClick: () => void
  testId?: string
}) {
  const theme = useTheme()
  const [hovered, setHovered] = useState(false)
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingTop: 5,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        cursor: 'pointer',
        borderTopLeftRadius: 6,
        borderTopRightRadius: 6,
        borderBottomWidth: 2,
        borderColor: active ? activeColor : 'transparent',
        backgroundColor: active
          ? 'rgba(167, 139, 250, 0.06)'
          : hovered
            ? 'rgba(255, 255, 255, 0.05)'
            : undefined,
        flexShrink: 0,
        position: 'relative',
        marginBottom: -1,
      }}
    >
      {icon}
      <Text
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: active ? activeColor : hovered ? theme.text : theme.text2,
          maxWidth: 100,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Text>
      {viewers !== undefined ? (
        <Text style={{ fontSize: 10, color: active ? activeColor : theme.text2, opacity: 0.7 }}>
          {formatViewers(viewers)}
        </Text>
      ) : null}
    </div>
  )
}

function WatchedTab({
  label,
  platform,
  active,
  live,
  viewers,
  color,
  onClick,
  onClose,
  testId,
}: {
  label: string
  platform: string
  active: boolean
  live: boolean
  viewers?: number
  color: string
  onClick: () => void
  onClose: () => void
  testId?: string
}) {
  const [hovered, setHovered] = useState(false)
  const [closeHovered, setCloseHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
    >
      <Tab
        testId={testId}
        label={label}
        active={active}
        activeColor={color}
        viewers={viewers}
        onClick={onClick}
        icon={
          <>
            {live ? (
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: color,
                  flexShrink: 0,
                }}
              />
            ) : null}
            <PlatformIcon platform={platform} size={12} color={active ? color : '#8b8b99'} />
          </>
        }
      />
      {hovered ? (
        <div
          onClick={(event) => {
            void event
            onClose()
          }}
          onMouseEnter={() => setCloseHovered(true)}
          onMouseLeave={() => setCloseHovered(false)}
          style={{
            position: 'absolute',
            right: -2,
            top: 2,
            width: 16,
            height: 16,
            borderRadius: 4,
            backgroundColor: closeHovered ? '#ef4444' : '#1f1f24',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Icon name="close" size={10} color={closeHovered ? '#ffffff' : '#8b8b99'} />
        </div>
      ) : null}
    </div>
  )
}
