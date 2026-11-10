import { motion, useGpuixRequired } from '@gpuix/react'
import { useEffect, useMemo, useRef, useState } from 'react'
/**
 * The app header, tabbed content, modals and toasts sit below the native titlebar.
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
import { useT } from '../i18n'
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
import { setMainTab } from '../state/settings-session'
import { saveStreamerMode, streamerModeStore } from '../state/streamer-mode'
import { visitChatTab, navigateChatTabHistory } from '../state/tab-history'
import { clearTabUnread } from '../state/tab-unread'
import { changeWindowPresentation, useWindowPresentation } from '../state/window-presentation'
import { useWindowScope } from '../state/window-scope'
import { withAlpha } from '../theme'
import { resolveFont, resolveTheme, useTheme, FontContext, ThemeContext } from '../theme-context'
import { loadPendingChangelog, type PendingChangelog } from '../update-changelog'
import {
  dismissUpdateToast,
  initialUpdateToastState,
  nextUpdateToastState,
} from '../update-toast-state'
import { AddChannelModal } from './AddChannelModal'
import { AppNavigation } from './AppNavigation'
import { ChannelTabBar, type WatchedLiveStatus } from './ChannelTabBar'
import { ObsRemoteController } from './obs-remote/ObsRemoteController'
import { PlatformsPanel } from './PlatformsPanel'
import { SavedAccounts } from './SavedAccounts'
import { SearchAllChatsDialog } from './SearchAllChatsDialog'
import { SettingsPanel } from './SettingsPanel'
import { TabSelectorModal, type TabItem } from './TabSelectorModal'
import { TwitchActivitiesPanel } from './TwitchActivitiesPanel'
import { TwitchDeviceDialog } from './TwitchDeviceDialog'
import { ActionButton } from './ui/Form'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { Text } from './ui/Text'
import { UpdateChangelogModal } from './UpdateChangelogModal'
import { WatchedView } from './WatchedView'

/** Transient top-center toast (port of ChatNotice.vue). */
export function ChatNotice() {
  const notice = useStore(noticeStore)
  const theme = useTheme()
  if (!notice) return null

  const palette =
    notice.kind === 'success'
      ? { bg: 'rgba(20, 83, 45, 0.97)', text: '#bbf7d0', dot: '#22c55e' }
      : notice.kind === 'error'
        ? { bg: 'rgba(127, 29, 29, 0.97)', text: '#fecaca', dot: '#ef4444' }
        : { bg: theme.popover, text: theme.text, dot: theme.accent.primary }

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

const UPDATE_TOAST_WIDTH = 320
const UPDATE_TOAST_PADDING = 12
// Border-box width minus padding and the 1px border on each side.
const UPDATE_TOAST_CONTENT_WIDTH = UPDATE_TOAST_WIDTH - UPDATE_TOAST_PADDING * 2 - 2
const BUSY_BAR_WIDTH = 72
// The toast grows upward when its buttons appear, so a click aimed at the old close
// icon can land on the new primary button. Clicks this soon after are ignored.
const FRESH_ACTIONS_GUARD_MS = 600

/** Indeterminate progress: a segment sliding back and forth along the track. */
function UpdateBusyBar() {
  const theme = useTheme()
  const [forward, setForward] = useState(true)
  return (
    <div
      style={{
        position: 'relative',
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.fill,
        overflow: 'hidden',
      }}
    >
      <motion.div
        initial={{ left: 0 }}
        animate={{ left: forward ? UPDATE_TOAST_CONTENT_WIDTH - BUSY_BAR_WIDTH : 0 }}
        transition={{ duration: 0.8, ease: 'easeInOut' }}
        onMotionComplete={() => setForward((value) => !value)}
        style={{
          position: 'absolute',
          top: 0,
          width: BUSY_BAR_WIDTH,
          height: 4,
          borderRadius: 2,
          backgroundColor: theme.accent.primary,
        }}
      />
    </div>
  )
}

/** Wraps actions so they ignore clicks made right after `actionsKey` changed. */
function useFreshActionsGuard(actionsKey: string | null) {
  const shownAt = useRef(0)
  useEffect(
    () => {
      shownAt.current = performance.now()
    },
    // The key is the trigger: new actions restart the guard window.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
    [actionsKey],
  )
  return (action: () => void) => () => {
    if (performance.now() - shownAt.current >= FRESH_ACTIONS_GUARD_MS) action()
  }
}

/**
 * Update notification toast (port of App.vue's update-toast). Driven by the
 * backend's `update_status` events: 'checking' / 'update-available' /
 * 'downloading' (progress) / 'download-complete' / 'applying' /
 * 'no-update' / 'update-error' / 'idle' (dismiss).
 */
export function UpdateToast() {
  const backend = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const [toast, setToast] = useState(initialUpdateToastState)
  const { update, dismissed } = toast
  const dismiss = () => setToast(dismissUpdateToast)
  const guarded = useFreshActionsGuard(
    update && !dismissed ? `${update.status}:${update.hash ?? ''}` : null,
  )

  useBackendEvent('update_status', (status) => {
    setToast((current) => nextUpdateToastState(current, status))
  })

  // 'no-update' and errors are informational — auto-hide them.
  useEffect(() => {
    if (!update || dismissed) return
    if (update.status !== 'no-update' && update.status !== 'update-error') return
    const timer = setTimeout(() => setToast(dismissUpdateToast), 5000)
    return () => clearTimeout(timer)
  }, [update, dismissed])

  if (!update || dismissed) return null

  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        bottom: 12,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        width: UPDATE_TOAST_WIDTH,
        backgroundColor: theme.popover,
        borderWidth: 1,
        borderColor: theme.dialogBorder,
        borderRadius: 10,
        padding: UPDATE_TOAST_PADDING,
        boxShadow: {
          offsetX: 0,
          offsetY: 4,
          blurRadius: 16,
          spreadRadius: 0,
          color: '#00000055',
        },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Text style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize: 13, color: theme.text }}>
          {update.status === 'downloading' && typeof update.progress === 'number'
            ? `${update.message} — ${Math.round(update.progress)}%`
            : update.message}
        </Text>
        <div
          onClick={dismiss}
          style={{
            display: 'flex',
            flexShrink: 0,
            cursor: 'pointer',
            borderRadius: 4,
            padding: 2,
            hover: { backgroundColor: theme.fillHover },
          }}
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
              backgroundColor: theme.accent.primary,
            }}
          />
        </div>
      ) : null}
      {update.status === 'checking' || update.status === 'applying' ? <UpdateBusyBar /> : null}
      {update.status === 'update-available' ? (
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <ActionButton
            onClick={guarded(() => {
              const { hash } = update
              if (hash) runUiTask(backend.api.skipUpdate({ hash }))
              dismiss()
            })}
          >
            {t('app.update.skip')}
          </ActionButton>
          <ActionButton primary onClick={guarded(() => runUiTask(backend.api.downloadUpdate()))}>
            {t('app.update.download')}
          </ActionButton>
        </div>
      ) : null}
      {update.status === 'download-complete' ? (
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <ActionButton onClick={guarded(dismiss)}>{t('app.update.notNow')}</ActionButton>
          <ActionButton primary onClick={guarded(() => runUiTask(backend.api.applyUpdate()))}>
            {t('app.update.restartToApply')}
          </ActionButton>
        </div>
      ) : null}
    </div>
  )
}

export function App() {
  const backend = useBackend()
  const { t, language } = useT()
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

  const [showAddModal, setShowAddModal] = useState(false)
  const [showTabSelector, setShowTabSelector] = useState(false)
  const [showAllChatSearch, setShowAllChatSearch] = useState(false)
  const [showAccounts, setShowAccounts] = useState(false)
  const [showFollowing, setShowFollowing] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)
  const [changelogData, setChangelogData] = useState<PendingChangelog | null>(null)
  const [hasOpenedObsRemote, setHasOpenedObsRemote] = useState(false)
  const obsRemoteActive = activeTab === 'obs-remote'
  if (obsRemoteActive && !hasOpenedObsRemote) setHasOpenedObsRemote(true)

  const theme = resolveTheme(settings)
  const font = resolveFont(settings)

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
    const items: TabItem[] = [{ id: 'home', label: t('app.tabs.home') }]
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
    // The home tab label is translated: rebuild the list when the UI language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tabWatchedChannels,
    tabChannelNames,
    watchedLiveStatuses,
    chatTabs.value.metadata,
    t,
    language,
  ])

  const selectWatchedTab = (id: string) => {
    clearTabUnread(id)
    activeWatchedTabStore.set(id)
    setMainTab('chat')
  }

  const onAddChannel = async (platform: WatchedPlatform, channelSlug: string) => {
    try {
      const channel = await backend.api.addWatchedChannel({ platform, channelSlug })
      watchedChannelsStore.set(await backend.api.getWatchedChannels())
      // Adding a chat that is already open opens it once more, e.g. to send from another account.
      await openChannelChatTab(backend, channel, { another: true })
      setShowAddModal(false)
      showNotice('success', t('app.notice.watching', { name: channel.displayName }))
    } catch (error) {
      console.error('[App] addWatchedChannel failed:', error)
      showNotice('error', t('app.notice.addChannelFailed', { error: String(error) }))
    }
  }

  const onRemoveChannel = async (id: string) => {
    try {
      await closeChatTab(backend, id)
    } catch (error) {
      showNotice('error', t('app.notice.closeTabFailed', { error: String(error) }))
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
        if (!panel) throw new Error(t('app.error.layoutUnavailable'))
        setMainTab('chat')
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
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: theme.bg,
            // Inherited by every text subtree (GPUI's default wash is blue).
            selectionColor: withAlpha(theme.accent.primary, 0.35),
          }}
        >
          <div
            testId="app-header"
            style={{
              flexShrink: 0,
              backgroundColor: theme.navBg,
              borderBottomWidth: 1,
              borderColor: theme.border,
            }}
          >
            <ChannelTabBar
              leading={<AppNavigation />}
              tabs={
                activeTab === 'chat' && presentation.tabVisibility !== 'off'
                  ? {
                      watchedChannels: visibleTabs,
                      activeTabId: activeWatchedTab,
                      watchedLiveStatuses,
                      homeViewerCount,
                      tabChannelNames,
                      onSelectTab: selectWatchedTab,
                      onAddChannel: () => setShowAddModal(true),
                      onSearchAll: () => setShowAllChatSearch(true),
                      onRemoveChannel: (id) => void onRemoveChannel(id),
                    }
                  : undefined
              }
            />
          </div>

          <div
            style={{
              flexGrow: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {activeTab === 'chat' ? (
              <WatchedView
                tabId={activeWatchedTab}
                onGoToPlatforms={() => setMainTab('platforms')}
              />
            ) : null}
            {activeTab === 'platforms' ? <PlatformsPanel /> : null}
            {activeTab === 'settings' ? <SettingsPanel /> : null}
            {hasOpenedObsRemote ? <ObsRemoteController active={obsRemoteActive} /> : null}
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
          <TwitchDeviceDialog />
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
