/**
 * Root component — port of App.vue's shell: nav rail + channel tab bar +
 * tabbed content area (chat / events / platforms / settings) + modals +
 * transient notice toast. Window chrome is the native GPUI titlebar.
 */

import { useEffect, useMemo, useState } from 'react'
import { motion } from '@gpuix/react'

import { useBackend } from '../backend/context'
import { useStore } from '../state/create-store'
import {
  accountsStore,
  activeTabStore,
  activeWatchedTabStore,
  noticeStore,
  settingsStore,
  streamStatusStore,
  tabChannelIdsStore,
  tabChannelNamesStore,
  watchedChannelsStore,
  showNotice,
} from '../state/app'
import { registerHotkeyActions } from '../state/hotkeys'
import { resolveFont, resolveTheme, FontContext, ThemeContext } from '../theme-context'
import { NavRail } from './NavRail'
import { Text } from './ui/Text'
import { ChatView } from './ChatView'
import { EventsFeed } from './EventsFeed'
import { PlatformsPanel } from './PlatformsPanel'
import { SettingsPanel } from './SettingsPanel'
import { ChannelTabBar, type WatchedLiveStatus } from './ChannelTabBar'
import { WatchedView } from './WatchedView'
import { AddChannelModal } from './AddChannelModal'
import { TabSelectorModal, type TabItem } from './TabSelectorModal'

/** Transient top-center toast (port of ChatNotice.vue). */
function ChatNotice() {
  const notice = useStore(noticeStore)
  if (!notice) return null

  const palette =
    notice.kind === 'success'
      ? { bg: 'rgba(20, 83, 45, 0.97)', text: '#bbf7d0', dot: '#22c55e' }
      : notice.kind === 'error'
        ? { bg: 'rgba(127, 29, 29, 0.97)', text: '#fecaca', dot: '#ef4444' }
        : { bg: 'rgba(31, 41, 55, 0.97)', text: '#e5e7eb', dot: '#a78bfa' }

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 0,
        right: 0,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: palette.bg,
          borderRadius: 10,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 12,
          paddingRight: 12,
          boxShadow: {
            offsetX: 0,
            offsetY: 4,
            blurRadius: 16,
            spreadRadius: 0,
            color: '#00000055',
          },
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.dot }} />
        <Text style={{ fontSize: 13, color: palette.text }}>{notice.text}</Text>
      </motion.div>
    </div>
  )
}

export function App() {
  const backend = useBackend()
  const settings = useStore(settingsStore)
  const activeTab = useStore(activeTabStore)
  const accounts = useStore(accountsStore)
  const watchedChannels = useStore(watchedChannelsStore)
  const tabChannelIds = useStore(tabChannelIdsStore)
  const activeWatchedTab = useStore(activeWatchedTabStore)
  const tabChannelNames = useStore(tabChannelNamesStore)
  const streamStatuses = useStore(streamStatusStore)

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showTabSelector, setShowTabSelector] = useState(false)

  const theme = resolveTheme(settings)
  const font = resolveFont(settings)

  // Sidebar collapse preference survives restarts via the settings KV store.
  useEffect(() => {
    void backend.api.getUiState({ key: 'sidebar_collapsed' }).then((value) => {
      if (value === 'true') setSidebarCollapsed(true)
    })
  }, [backend])

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      void backend.api.setUiState({ key: 'sidebar_collapsed', value: String(!current) })
      return !current
    })
  }

  // Global hotkeys (Ctrl+K etc.) are dispatched from main.tsx's render().
  useEffect(() => {
    registerHotkeyActions({
      openAddChannel: () => setShowAddModal(true),
      openTabSelector: () => setShowTabSelector(true),
    })
  }, [])

  const tabWatchedChannels = useMemo(
    () => watchedChannels.filter((ch) => tabChannelIds.includes(ch.id)),
    [watchedChannels, tabChannelIds],
  )

  const watchedLiveStatuses = useMemo(() => {
    const map = new Map<string, WatchedLiveStatus>()
    for (const ch of watchedChannels) {
      if (ch.platform === 'youtube') continue
      const status = streamStatuses.get(`${ch.platform}:${ch.channelSlug.toLowerCase()}`)
      map.set(ch.id, { isLive: status?.isLive ?? false, viewerCount: status?.viewerCount })
    }
    return map
  }, [watchedChannels, streamStatuses])

  const homeViewerCount = useMemo(() => {
    let total = 0
    let anyLive = false
    for (const acc of accounts) {
      if (acc.platform !== 'twitch' && acc.platform !== 'kick') continue
      const status = streamStatuses.get(`${acc.platform}:${acc.username.toLowerCase()}`)
      if (status?.isLive) {
        anyLive = true
        total += status.viewerCount ?? 0
      }
    }
    return anyLive ? total : undefined
  }, [accounts, streamStatuses])

  const tabSelectorItems = useMemo<TabItem[]>(() => {
    const items: TabItem[] = [{ id: 'home', label: 'My channels' }]
    for (const ch of tabWatchedChannels) {
      items.push({
        id: ch.id,
        label: tabChannelNames.get(ch.id)?.join(', ') ?? ch.displayName,
        platform: ch.platform,
        isLive: watchedLiveStatuses.get(ch.id)?.isLive ?? false,
      })
    }
    return items
  }, [tabWatchedChannels, tabChannelNames, watchedLiveStatuses])

  const selectWatchedTab = (id: string) => {
    activeWatchedTabStore.set(id)
    activeTabStore.set('chat')
  }

  const persistTabIds = (ids: string[]) => {
    tabChannelIdsStore.set(ids)
    void backend.api.setTabChannelIds({ ids })
  }

  const onAddChannel = async (platform: 'twitch' | 'kick' | 'youtube', channelSlug: string) => {
    try {
      const channel = await backend.api.addWatchedChannel({ platform, channelSlug })
      watchedChannelsStore.set(await backend.api.getWatchedChannels())
      if (!tabChannelIdsStore.get().includes(channel.id)) {
        persistTabIds([...tabChannelIdsStore.get(), channel.id])
      }
      activeWatchedTabStore.set(channel.id)
      setShowAddModal(false)
      showNotice('success', `Watching ${channel.displayName}`)
    } catch (error) {
      console.error('[App] addWatchedChannel failed:', error)
      showNotice('error', `Failed to add channel: ${String(error)}`)
    }
  }

  const onRemoveChannel = async (id: string) => {
    try {
      await backend.api.removeWatchedChannel({ id })
      watchedChannelsStore.set(await backend.api.getWatchedChannels())
      const remaining = tabChannelIdsStore.get().filter((tabId) => tabId !== id)
      persistTabIds(remaining)
      if (activeWatchedTabStore.get() === id) {
        activeWatchedTabStore.set(remaining[0] ?? 'home')
      }
    } catch (error) {
      console.error('[App] removeWatchedChannel failed:', error)
    }
  }

  return (
    <ThemeContext.Provider value={theme}>
      <FontContext.Provider value={font}>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'row',
            width: '100%',
            height: '100%',
            backgroundColor: theme.bg,
          }}
        >
          <NavRail collapsed={sidebarCollapsed} onToggle={toggleSidebar} />

          <div
            style={{
              flexGrow: 1,
              minWidth: 0,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: theme.bg,
            }}
          >
            {activeTab === 'chat' ? (
              <ChannelTabBar
                watchedChannels={tabWatchedChannels}
                activeTabId={activeWatchedTab}
                watchedStatuses={new Map()}
                watchedLiveStatuses={watchedLiveStatuses}
                homeViewerCount={homeViewerCount}
                tabChannelNames={tabChannelNames}
                onSelectTab={selectWatchedTab}
                onAddChannel={() => setShowAddModal(true)}
                onRemoveChannel={(id) => void onRemoveChannel(id)}
              />
            ) : null}

            {activeTab === 'chat' ? (
              activeWatchedTab === 'home' ? (
                <ChatView onGoToPlatforms={() => activeTabStore.set('platforms')} />
              ) : (
                <WatchedView tabId={activeWatchedTab} />
              )
            ) : null}
            {activeTab === 'events' ? <EventsFeed /> : null}
            {activeTab === 'platforms' ? <PlatformsPanel /> : null}
            {activeTab === 'settings' ? <SettingsPanel /> : null}
          </div>

          {showAddModal ? (
            <AddChannelModal
              onConfirm={(platform, slug) => void onAddChannel(platform, slug)}
              onCancel={() => setShowAddModal(false)}
            />
          ) : null}

          {showTabSelector ? (
            <TabSelectorModal
              tabs={tabSelectorItems}
              activeTabId={activeWatchedTab}
              onSelect={selectWatchedTab}
              onClose={() => setShowTabSelector(false)}
            />
          ) : null}

          <ChatNotice />
        </div>
      </FontContext.Provider>
    </ThemeContext.Provider>
  )
}
