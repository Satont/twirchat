import { motion, useGpuixRequired, type StyleDesc } from '@gpuix/react'
import { useEffect, useMemo, useState } from 'react'
/**
 * Root component — port of App.vue's shell: nav rail + channel tab bar +
 * tabbed content area (chat / platforms / settings) + modals +
 * transient notice toast. Window chrome is the native GPUI titlebar.
 */

import { APP_VERSION } from '../../build-info'
import {
  isPluginPlatform,
  isPluginWatchedChannel,
  type WatchedPlatform,
} from '../../watched-channels/plugin-channel-types'
import { useBackend, useBackendEvent } from '../backend/context'
import { registerBundledFonts } from '../fonts'
import { runUiTask } from '../hooks/run-ui-task'
import { parseHotkeyChoice } from '../hotkey-bindings'
import { useHotkeyContext, useHotkeyRoute } from '../state/action-bindings'
import { getActivePane } from '../state/active-pane'
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
import {
  chatTabsStore,
  closeChatTab,
  openChannelChatTab,
  tabsForChannels,
  createEmptyChatTab,
  reorderChatTab,
} from '../state/chat-tabs'
import { useStore } from '../state/create-store'
import { useDesktopWindows } from '../state/desktop-windows'
import { registerHotkeyActions } from '../state/hotkeys'
import { allPanels, layoutStore, loadLayout, splitPanel, reopenClosedSplit } from '../state/layout'
import { messageSimilarityPreferences } from '../state/message-similarity'
import { saveStreamerMode, streamerModeStore } from '../state/streamer-mode'
import { visitChatTab, navigateChatTabHistory } from '../state/tab-history'
import { clearTabUnread, tabUnreadStore } from '../state/tab-unread'
import { changeWindowPresentation, useWindowPresentation } from '../state/window-presentation'
import { useWindowScope } from '../state/window-scope'
import { accent, withAlpha } from '../theme'
import { resolveFont, resolveTheme, useTheme, FontContext, ThemeContext } from '../theme-context'
import { loadPendingChangelog, type PendingChangelog } from '../update-changelog'
import { AddChannelModal } from './AddChannelModal'
import { ChannelTabBar, type WatchedLiveStatus } from './ChannelTabBar'
import { NavRail } from './NavRail'
import { PlatformsPanel } from './PlatformsPanel'
import { SavedAccounts } from './SavedAccounts'
import { SearchAllChatsDialog } from './SearchAllChatsDialog'
import { SettingsPanel } from './SettingsPanel'
import { TabSelectorModal, type TabItem } from './TabSelectorModal'
import { TwitchActivitiesPanel } from './TwitchActivitiesPanel'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { Text } from './ui/Text'
import { UpdateChangelogModal } from './UpdateChangelogModal'
import { WatchedView } from './WatchedView'

/** Badge updates stay inside the tab bar, outside the chat render tree. */
function UnreadChannelTabBar(props: React.ComponentProps<typeof ChannelTabBar>) {
  const unread = useStore(tabUnreadStore)
  return <ChannelTabBar {...props} unread={unread} />
}

/** Transient top-center toast (port of ChatNotice.vue). */
export function ChatNotice() {
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

/**
 * Update notification toast (port of App.vue's update-toast). Driven by the
 * backend's `update_status` events: 'checking' / 'update-available' /
 * 'downloading' (progress) / 'download-complete' / 'applying' /
 * 'no-update' / 'update-error'.
 */
export function UpdateToast() {
  const backend = useBackend()
  const theme = useTheme()
  const [update, setUpdate] = useState<{
    status: string
    message: string
    progress?: number
    hash?: string
  } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useBackendEvent('update_status', (status) => {
    setUpdate(status)
    setDismissed(false)
  })

  // 'no-update' and errors are informational — auto-hide them.
  useEffect(() => {
    if (!update || dismissed) return
    if (update.status !== 'no-update' && update.status !== 'update-error') return
    const timer = setTimeout(() => setDismissed(true), 5000)
    return () => clearTimeout(timer)
  }, [update, dismissed])

  if (!update || dismissed) return null

  const buttonStyle: StyleDesc = {
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 12,
    paddingRight: 12,
    borderRadius: 6,
    backgroundColor: accent.deep,
    cursor: 'pointer',
  }
  const secondaryButtonStyle = {
    ...buttonStyle,
    backgroundColor: theme.fill,
    borderWidth: 1,
    borderColor: theme.hairline,
  }

  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        bottom: 12,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 240,
        maxWidth: 340,
        backgroundColor: theme.popover,
        borderWidth: 1,
        borderColor: theme.dialogBorder,
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flexGrow: 1, fontSize: 13, color: theme.text }}>
          {update.status === 'downloading' && typeof update.progress === 'number'
            ? `${update.message} — ${Math.round(update.progress)}%`
            : update.message}
        </Text>
        <div
          onClick={() => setDismissed(true)}
          style={{ display: 'flex', cursor: 'pointer', borderRadius: 4, padding: 2 }}
        >
          <Icon name="close" size={14} color={theme.text2} />
        </div>
      </div>
      {update.status === 'downloading' ? (
        <div
          style={{ height: 4, borderRadius: 2, backgroundColor: theme.fill, overflow: 'hidden' }}
        >
          <div
            style={{
              width: `${Math.round(update.progress ?? 0)}%`,
              height: '100%',
              backgroundColor: accent.deep,
            }}
          />
        </div>
      ) : null}
      {update.status === 'update-available' ? (
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
          <div style={buttonStyle} onClick={() => runUiTask(backend.api.downloadUpdate())}>
            <Text style={{ fontSize: 13, color: '#ffffff' }}>Download</Text>
          </div>
          <div
            style={secondaryButtonStyle}
            onClick={() => {
              if (update.hash) runUiTask(backend.api.skipUpdate({ hash: update.hash }))
              setDismissed(true)
            }}
          >
            <Text style={{ fontSize: 13, color: theme.text }}>Skip</Text>
          </div>
        </div>
      ) : null}
      {update.status === 'download-complete' ? (
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
          <div style={buttonStyle} onClick={() => runUiTask(backend.api.applyUpdate())}>
            <Text style={{ fontSize: 13, color: '#ffffff' }}>Restart to apply</Text>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function App() {
  const backend = useBackend()
  const windows = useDesktopWindows()
  const scope = useWindowScope()
  const presentation = useWindowPresentation()
  const streamerMode = useStore(streamerModeStore)
  // Runs during the first render — before the first layout — so text that
  // names Inter/Manrope never falls back. Idempotent across hot remounts.
  registerBundledFonts(useGpuixRequired())
  const settings = useStore(settingsStore)
  const activeTab = useStore(activeTabStore)
  const accounts = useStore(accountsStore)
  const watchedChannels = useStore(watchedChannelsStore)
  const tabChannelIds = useStore(tabChannelIdsStore)
  const chatTabs = useStore(chatTabsStore)
  const activeWatchedTab = useStore(activeWatchedTabStore)
  const tabChannelNames = useStore(tabChannelNamesStore)
  const streamStatuses = useStore(streamStatusStore)

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showTabSelector, setShowTabSelector] = useState(false)
  const [showAllChatSearch, setShowAllChatSearch] = useState(false)
  const [showAccounts, setShowAccounts] = useState(false)
  const [showFollowing, setShowFollowing] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)
  const [changelogData, setChangelogData] = useState<PendingChangelog | null>(null)

  const theme = resolveTheme(settings)
  const font = resolveFont(settings)

  // Sidebar collapse preference survives restarts via the settings KV store.
  useEffect(() => {
    runUiTask(
      backend.api.getUiState({ key: 'sidebar_collapsed' }).then((value) => {
        if (value === 'true') setSidebarCollapsed(true)
      }),
    )
  }, [backend])

  useEffect(() => {
    let mounted = true
    runUiTask(
      loadPendingChangelog(APP_VERSION, backend.api, {
        preview:
          process.env.TWIRCHAT_CHANGELOG_PREVIEW === '1' && process.env.NODE_ENV !== 'production',
      }).then((changelog) => {
        if (!mounted || !changelog) return
        setChangelogData(changelog)
        setShowChangelog(true)
      }),
    )
    return () => {
      mounted = false
    }
  }, [backend])

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      runUiTask(backend.api.setUiState({ key: 'sidebar_collapsed', value: String(!current) }))
      return !current
    })
  }

  // Global hotkeys (Ctrl+K etc.) are dispatched from main.tsx's render().
  useEffect(() => {
    return registerHotkeyActions(
      {
        openAddChannel: () => setShowAddModal(true),
        openTabSelector: () => setShowTabSelector(true),
        openAllChatSearch: () => setShowAllChatSearch(true),
        isChatActive: () => activeTabStore.get() === 'chat',
      },
      scope,
    )
  }, [scope])
  useEffect(() => visitChatTab(activeWatchedTab, scope), [activeWatchedTab, scope])

  const tabWatchedChannels = useMemo(
    () => tabsForChannels(watchedChannels, tabChannelIds, chatTabs.value.metadata),
    [watchedChannels, tabChannelIds, chatTabs.value.metadata],
  )

  const watchedLiveStatuses = useMemo(() => {
    const map = new Map<string, WatchedLiveStatus>()
    for (const ch of watchedChannels) {
      if (isPluginWatchedChannel(ch) || ch.platform === 'youtube') continue
      const status = streamStatuses.get(`${ch.platform}:${ch.channelSlug.toLowerCase()}`)
      map.set(ch.id, {
        isLive: status?.isLive ?? false,
        viewerCount:
          streamerMode.effectiveEnabled && streamerMode.settings.hideViewerCountAndDuration
            ? undefined
            : status?.viewerCount,
      })
    }
    for (const tab of tabWatchedChannels) {
      const status = map.get(tab.sourceChannelId)
      if (status) map.set(tab.id, status)
    }
    return map
  }, [watchedChannels, streamStatuses, tabWatchedChannels, streamerMode])

  const homeViewerCount = useMemo(() => {
    if (streamerMode.effectiveEnabled && streamerMode.settings.hideViewerCountAndDuration)
      return undefined
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
  }, [accounts, streamStatuses, streamerMode])

  const tabSelectorItems = useMemo<TabItem[]>(() => {
    const items: TabItem[] = [{ id: 'home', label: 'My channels' }]
    for (const ch of tabWatchedChannels) {
      items.push({
        id: ch.id,
        label:
          chatTabs.value.metadata[ch.id]?.title ??
          tabChannelNames.get(ch.id)?.join(', ') ??
          ch.displayName,
        platform: ch.platform,
        isLive: watchedLiveStatuses.get(ch.id)?.isLive ?? false,
      })
    }
    return items
  }, [tabWatchedChannels, tabChannelNames, watchedLiveStatuses, chatTabs.value.metadata])

  const selectWatchedTab = (id: string) => {
    clearTabUnread(id)
    activeWatchedTabStore.set(id)
    activeTabStore.set('chat')
  }

  const onAddChannel = async (platform: WatchedPlatform, channelSlug: string) => {
    try {
      const channel = await backend.api.addWatchedChannel({ platform, channelSlug })
      watchedChannelsStore.set(await backend.api.getWatchedChannels())
      await openChannelChatTab(backend, channel)
      setShowAddModal(false)
      showNotice('success', `Watching ${channel.displayName}`)
    } catch (error) {
      console.error('[App] addWatchedChannel failed:', error)
      showNotice('error', `Failed to add channel: ${String(error)}`)
    }
  }

  const onRemoveChannel = async (id: string) => {
    try {
      await closeChatTab(backend, id)
    } catch (error) {
      showNotice('error', `Could not close tab: ${String(error)}`)
    }
  }

  const visibleTabs =
    presentation.tabVisibility === 'liveOnly'
      ? tabWatchedChannels.filter(
          (tab) =>
            tab.id === activeWatchedTab ||
            (tab.platform !== undefined && isPluginPlatform(tab.platform)) ||
            watchedLiveStatuses.get(tab.id)?.isLive,
        )
      : tabWatchedChannels
  const visibleTabIds = ['home', ...visibleTabs.map((tab) => tab.id)]
  const activePanel = () => {
    const panels = allPanels(layoutStore.get().get(activeWatchedTab)?.layout ?? null)
    const active = getActivePane(scope)
    return panels.find((panel) => `${activeWatchedTab}:${panel.id}` === active?.paneId) ?? panels[0]
  }
  useHotkeyContext({
    id: 'window',
    category: 'window',
    handlers: {
      newSplit: async () => {
        if (!layoutStore.get().get(activeWatchedTab)?.layout)
          await loadLayout(backend, activeWatchedTab)
        const panel = activePanel()
        if (!panel) throw new Error('The current layout is unavailable.')
        activeTabStore.set('chat')
        await splitPanel(backend, activeWatchedTab, panel.id, 'vertical', scope)
      },
      newTab: () => createEmptyChatTab(backend),
      openSettings: () => activeTabStore.set('settings'),
      openAccountSelector: () => setShowAccounts(true),
      openQuickSwitcher: () => setShowTabSelector(true),
      quit: windows ? () => windows.quit() : null,
      removeTab: activeWatchedTab !== 'home' ? () => closeChatTab(backend, activeWatchedTab) : null,
      reopenSplit: () => reopenClosedSplit(backend),
      toggleLocalR9K: async () => {
        await messageSimilarityPreferences.load(backend.api)
        const value = messageSimilarityPreferences.store.get().value
        await messageSimilarityPreferences.save(backend.api, {
          ...value,
          hideSimilar: !value.hideSimilar,
        })
      },
      setStreamerMode: ([mode]) =>
        saveStreamerMode(
          backend,
          parseHotkeyChoice(mode ?? 'toggle', ['on', 'off', 'auto', 'toggle']),
        ),
      selectTabHistoryBack: () => {
        const id = navigateChatTabHistory(-1, activeWatchedTab, ['home', ...tabChannelIds], scope)
        if (id) selectWatchedTab(id)
      },
      selectTabHistoryForward: () => {
        const id = navigateChatTabHistory(1, activeWatchedTab, ['home', ...tabChannelIds], scope)
        if (id) selectWatchedTab(id)
      },
      openFollowedChannels: accounts.some((account) => account.platform === 'twitch')
        ? () => setShowFollowing(true)
        : null,
      moveTab:
        activeWatchedTab !== 'home'
          ? ([argument]) => {
              const index = tabChannelIds.indexOf(activeWatchedTab)
              const target =
                argument === 'next'
                  ? index + 1
                  : argument === 'previous'
                    ? index - 1
                    : Number(argument)
              return reorderChatTab(
                backend,
                activeWatchedTab,
                Math.max(0, Math.min(tabChannelIds.length - 1, target)),
              )
            }
          : null,
      openTab: ([argument]) => {
        const index = visibleTabIds.indexOf(activeWatchedTab)
        const target =
          argument === 'last'
            ? visibleTabIds.length - 1
            : argument === 'next'
              ? (index + 1) % visibleTabIds.length
              : argument === 'previous'
                ? (index - 1 + visibleTabIds.length) % visibleTabIds.length
                : Number(argument)
        const id = visibleTabIds[target]
        if (id) selectWatchedTab(id)
      },
      popup: windows
        ? ([kind]) =>
            windows.openChat(activeWatchedTab, kind === 'split' ? activePanel()?.id : undefined)
        : null,
      zoom: ([argument]) => changeWindowPresentation(backend.api, scope, 'zoom', argument),
      setTabVisibility: ([argument]) =>
        changeWindowPresentation(backend.api, scope, 'tabs', argument),
    },
  })
  useHotkeyRoute(['window'])

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
            // Inherited by every text subtree (GPUI's default wash is blue).
            selectionColor: withAlpha(accent.primary, 0.35),
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
            {activeTab === 'chat' && presentation.tabVisibility !== 'off' ? (
              <UnreadChannelTabBar
                watchedChannels={visibleTabs}
                activeTabId={activeWatchedTab}
                watchedStatuses={new Map()}
                watchedLiveStatuses={watchedLiveStatuses}
                homeViewerCount={homeViewerCount}
                tabChannelNames={tabChannelNames}
                onSelectTab={selectWatchedTab}
                onAddChannel={() => setShowAddModal(true)}
                onSearchAll={() => setShowAllChatSearch(true)}
                onRemoveChannel={(id) => void onRemoveChannel(id)}
              />
            ) : null}

            {activeTab === 'chat' ? (
              <WatchedView
                tabId={activeWatchedTab}
                onGoToPlatforms={() => activeTabStore.set('platforms')}
              />
            ) : null}
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
          {showAllChatSearch ? (
            <SearchAllChatsDialog onClose={() => setShowAllChatSearch(false)} />
          ) : null}
          {showAccounts ? (
            <Modal width={660} onClose={() => setShowAccounts(false)}>
              <SavedAccounts />
            </Modal>
          ) : null}
          {showFollowing ? (
            <TwitchActivitiesPanel
              channelSlug={
                accounts.find((account) => account.platform === 'twitch')?.username ?? ''
              }
              initialTab="following"
              onClose={() => setShowFollowing(false)}
            />
          ) : null}
          {showChangelog && changelogData ? (
            <UpdateChangelogModal
              version={changelogData.version}
              releaseNotes={changelogData.releaseNotes}
              publishedAt={changelogData.publishedAt}
              onClose={() => {
                setShowChangelog(false)
                setChangelogData(null)
              }}
            />
          ) : null}

          <ChatNotice />
          <UpdateToast />
        </div>
      </FontContext.Provider>
    </ThemeContext.Provider>
  )
}
