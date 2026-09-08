/**
 * Left icon navigation rail — port of App.vue's .nav-rail.
 */

import { useState } from 'react'
import { motion } from '@gpuix/react'

import { useStore } from '../state/create-store'
import { accountsStore, activeTabStore, unreadEventsStore, type MainTab } from '../state/app'
import { accent } from '../theme'
import { useTheme } from '../theme-context'
import { Icon, type IconName } from './ui/Icon'
import { Text } from './ui/Text'

const RAIL_WIDTH = 68
const RAIL_COLLAPSED_WIDTH = 44

interface NavItem {
  id: MainTab
  label: string
  icon: IconName
}

const ITEMS: NavItem[] = [
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'events', label: 'Events', icon: 'bell' },
  { id: 'platforms', label: 'Platforms', icon: 'globe' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

function NavItemButton({
  item,
  active,
  collapsed,
  badge,
  badgeColor,
  onClick,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  badge?: number
  badgeColor?: string
  onClick: () => void
}) {
  const theme = useTheme()
  const [hovered, setHovered] = useState(false)

  const activeColor = theme.isLight ? '#7c5aea' : accent.primary
  const color = active
    ? activeColor
    : hovered
      ? theme.isLight
        ? 'rgba(28, 27, 34, 0.75)'
        : 'rgba(255, 255, 255, 0.8)'
      : theme.navText

  return (
    <div
      testId={`nav-${item.id}`}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 4,
        paddingRight: 4,
        borderRadius: 10,
        cursor: 'pointer',
        width: '100%',
        backgroundColor: active
          ? theme.isLight
            ? 'rgba(124, 90, 234, 0.12)'
            : accent.tint15
          : hovered
            ? theme.navHover
            : undefined,
        userSelect: 'none',
      }}
    >
      <div style={{ position: 'relative', display: 'flex' }}>
        <Icon name={item.icon} size={20} color={color} />
        {badge !== undefined && badge > 0 ? (
          <div
            style={{
              position: 'absolute',
              top: -6,
              right: -8,
              backgroundColor: badgeColor ?? '#ef4444',
              borderRadius: 10,
              paddingLeft: 4,
              paddingRight: 4,
              paddingTop: 1,
              paddingBottom: 1,
              minWidth: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: 700, color: '#ffffff', lineHeight: 14 }}>
              {badge > 99 ? '99+' : String(badge)}
            </Text>
          </div>
        ) : null}
      </div>
      {collapsed ? null : (
        <Text style={{ fontSize: 10, fontWeight: 500, color, letterSpacing: 0.1 }}>
          {item.label}
        </Text>
      )}
    </div>
  )
}

export function NavRail({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const theme = useTheme()
  const activeTab = useStore(activeTabStore)
  const unreadEvents = useStore(unreadEventsStore)
  const accounts = useStore(accountsStore)
  const [collapseHovered, setCollapseHovered] = useState(false)

  const badges: Partial<Record<MainTab, { count: number; color?: string }>> = {
    events: unreadEvents > 0 ? { count: unreadEvents } : undefined,
    platforms: accounts.length > 0 ? { count: accounts.length, color: '#22c55e' } : undefined,
  }

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? RAIL_COLLAPSED_WIDTH : RAIL_WIDTH }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{
        flexShrink: 0,
        height: '100%',
        overflow: 'hidden',
        backgroundColor: theme.navBg,
        borderRightWidth: 1,
        borderColor: theme.isLight ? theme.border : 'rgba(255, 255, 255, 0.06)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 12,
        paddingBottom: 16,
        gap: 4,
        userSelect: 'none',
      }}
    >
      <div
        style={{
          marginBottom: 12,
          padding: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="logo" size={24} color={accent.primary} />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          width: '100%',
          paddingLeft: 8,
          paddingRight: 8,
          flexGrow: 1,
        }}
      >
        {ITEMS.map((item) => (
          <NavItemButton
            key={item.id}
            item={item}
            active={activeTab === item.id}
            collapsed={collapsed}
            badge={badges[item.id]?.count}
            badgeColor={badges[item.id]?.color}
            onClick={() => {
              activeTabStore.set(item.id)
              if (item.id === 'events') unreadEventsStore.set(0)
            }}
          />
        ))}
      </div>

      <div
        testId="nav-collapse"
        onClick={onToggle}
        onMouseEnter={() => setCollapseHovered(true)}
        onMouseLeave={() => setCollapseHovered(false)}
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          backgroundColor: collapseHovered
            ? theme.isLight
              ? 'rgba(28, 27, 34, 0.07)'
              : 'rgba(255, 255, 255, 0.08)'
            : undefined,
        }}
      >
        <Icon
          name={collapsed ? 'chevronRight' : 'chevronLeft'}
          size={16}
          color={
            collapseHovered
              ? theme.isLight
                ? 'rgba(28, 27, 34, 0.7)'
                : 'rgba(255, 255, 255, 0.7)'
              : theme.navText
          }
        />
      </div>
    </motion.div>
  )
}
