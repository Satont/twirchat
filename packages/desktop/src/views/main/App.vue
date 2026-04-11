<script setup lang="ts">
import { computed, onMounted, ref, triggerRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRpcListener } from './composables/useRpcListener'
import { useAccountsStore } from './stores/accounts'
import { useAliasStore } from './stores/useAliasStore'
import { useSettingsStore } from './stores/settings'
import { useChannelStatusStore } from './stores/channelStatus'
import { useStreamStatusStore } from './stores/streamStatus'
import PlatformsPanel from './components/PlatformsPanel.vue'
import WatchedChannelsView from './components/WatchedChannelsView.vue'
import ChatList from './components/ChatList.vue'
import EventsFeed from './components/EventsFeed.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ChannelTabBar from './components/ChannelTabBar.vue'
import type { WatchedLiveStatus } from './components/ChannelTabBar.vue'
import AddChannelModal from './components/AddChannelModal.vue'
import TabSelectorModal from './components/TabSelectorModal.vue'
import type { TabItem } from './components/TabSelectorModal.vue'
import { useHotkeys } from './composables/useHotkeys'
import { rpc } from './main'
import { attemptMigration } from './services/migration'
import type {
  Account,
  AppSettings,
  LayoutNode,
  NormalizedChatMessage,
  NormalizedEvent,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------

const messages = ref<NormalizedChatMessage[]>([])
const events = ref<NormalizedEvent[]>([])
const accountsStore = useAccountsStore()
const aliasStore = useAliasStore()
const settingsStore = useSettingsStore()
const channelStatusStore = useChannelStatusStore()
const streamStatusStore = useStreamStatusStore()

const { accounts } = storeToRefs(accountsStore)
const { settings } = storeToRefs(settingsStore)
const { statuses } = storeToRefs(channelStatusStore)

// Sync theme class to body for Teleported components
watch(
  () => settings.value?.theme,
  (theme) => {
    const activeTheme = theme ?? 'dark'
    document.body.classList.remove('dark', 'light')
    document.body.classList.add(activeTheme)
  },
  { immediate: true },
)

const activeTab = ref<'chat' | 'events' | 'platforms' | 'settings'>('chat')
const unreadEvents = ref(0)

// ---- Watched channels ----
const watchedChannels = ref<WatchedChannel[]>([])
const tabChannelIds = ref<Set<string>>(new Set())

const tabWatchedChannels = computed(() =>
  watchedChannels.value.filter((ch) => tabChannelIds.value.has(ch.id)),
)

const watchedLiveStatuses = computed<Map<string, WatchedLiveStatus>>(() => {
  const map = new Map<string, WatchedLiveStatus>()
  for (const ch of watchedChannels.value) {
    if (ch.platform === 'youtube') continue
    const status = streamStatusStore.getStatus(ch.platform as 'twitch' | 'kick', ch.channelSlug)
    map.set(ch.id, { isLive: status?.isLive ?? false, viewerCount: status?.viewerCount })
  }
  return map
})

const tabSelectorItems = computed<TabItem[]>(() => {
  const items: TabItem[] = [{ id: 'home', label: 'My channels' }]
  for (const ch of tabWatchedChannels.value) {
    items.push({
      id: ch.id,
      label: ch.displayName,
      platform: ch.platform,
      isLive: watchedLiveStatuses.value.get(ch.id)?.isLive ?? false,
    })
  }
  return items
})

/** Active watched channel tab ('home' or WatchedChannel.id) */
const activeWatchedTab = ref<string>('home')
/** ChannelId → messages buffer */
const watchedMessages = ref<Map<string, NormalizedChatMessage[]>>(new Map())
/** ChannelId → PlatformStatusInfo */
const watchedStatuses = ref<Map<string, PlatformStatusInfo>>(new Map())
const tabChannelNames = ref<Map<string, string[]>>(new Map())
const showAddModal = ref(false)
const showTabSelector = ref(false)

// ---- Sidebar collapse ----
const SIDEBAR_COLLAPSE_KEY = 'twirchat:sidebar-collapsed'
const sidebarCollapsed = ref(localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === 'true')

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, String(sidebarCollapsed.value))
}

const connectedAccountsCount = computed(() => accounts.value.length)
const youtubeAuthenticated = computed(() => accounts.value.some((a) => a.platform === 'youtube'))

// ----------------------------------------------------------------
// Load initial data
// ----------------------------------------------------------------

async function loadInitialData() {
  try {
    const [accs, , setts, statList, watched] = await Promise.all([
      rpc.request.getAccounts(),
      aliasStore.loadAliases(),
      rpc.request.getSettings(),
      rpc.request.getStatuses(),
      rpc.request.getWatchedChannels(),
    ])
    if (accs !== undefined) {
      accountsStore.setAccounts(accs)
    }
    if (setts !== undefined) {
      settings.value = setts
    }
    if (statList !== undefined) {
      channelStatusStore.setStatuses(statList)
    }
    if (watched !== undefined) {
      watchedChannels.value = watched
      const persistedTabIds = await rpc.request.getTabChannelIds?.()
      if (persistedTabIds !== null && persistedTabIds !== undefined && persistedTabIds.length > 0) {
        tabChannelIds.value = new Set(
          persistedTabIds.filter((id) => watched.some((ch) => ch.id === id)),
        )
      } else {
        // Backward compat: first run or migration — use all watched channels
        tabChannelIds.value = new Set(watched.map((ch) => ch.id))
        await rpc.request.setTabChannelIds?.({ ids: watched.map((ch) => ch.id) })
      }
    }

    // Eagerly pre-populate tab channel names from persisted layouts
    {
      const collectNames = (node: LayoutNode, channels: WatchedChannel[]): string[] => {
        if (node.type === 'panel' && node.content.type === 'watched') {
          const ch = channels.find(
            (c) => c.id === (node.content as { type: 'watched'; channelId: string }).channelId,
          )
          return ch ? [ch.displayName] : []
        }
        if (node.type === 'split') {
          return node.children.flatMap((child) => collectNames(child, channels))
        }
        return []
      }

      const nameMap = new Map<string, string[]>(tabChannelNames.value)
      for (const tabId of tabChannelIds.value) {
        try {
          const layout = await rpc.request.getWatchedChannelsLayout?.({ tabId })
          if (layout) {
            const names = collectNames(layout.root, watchedChannels.value)
            if (names.length > 0) {
              nameMap.set(tabId, names)
            }
          }
        } catch {
          // not fatal — tab will show single-channel name as fallback
        }
      }
      tabChannelNames.value = nameMap
    }

    // Load current watched channel statuses (emitted before webview was ready)
    try {
      const watchedStats = await rpc.request.getWatchedChannelStatuses()
      if (watchedStats !== undefined && watchedStats.length > 0) {
        const map = new Map<string, PlatformStatusInfo>(watchedStatuses.value)
        for (const { channelId, status } of watchedStats) {
          map.set(channelId, status)
        }
        watchedStatuses.value = map
      }
    } catch {
      // Not fatal
    }
  } catch (error) {
    console.warn('[App] Initial data load failed, retrying in 1s...', error)
    setTimeout(loadInitialData, 1000)
    return
  }

  // Load recent messages separately so a failure here doesn't block the rest
  try {
    const recentMsgs = await rpc.request.getRecentMessages({})
    if (recentMsgs !== undefined && recentMsgs.length > 0) {
      messages.value = [...recentMsgs]
    }
  } catch (error) {
    console.warn('[App] Failed to load recent messages:', error)
  }

  // Load buffered messages for all persisted watched channels
  for (const ch of watchedChannels.value) {
    try {
      const msgs = await rpc.request.getWatchedChannelMessages({ id: ch.id })
      if (msgs && msgs.length > 0) {
        watchedMessages.value.set(ch.id, msgs)
        triggerRef(watchedMessages)
      }
    } catch {
      // Not fatal
    }
  }

  streamStatusStore.startPolling(
    () => accounts.value,
    () => watchedChannels.value,
  )

  // Attempt migration from legacy layout format
  await attemptMigration()
}

useHotkeys(settings, {
  newTab: () => {
    showAddModal.value = true
  },
  nextTab: () => {
    cycleTab(1)
  },
  prevTab: () => {
    cycleTab(-1)
  },
  tabSelector: () => {
    showTabSelector.value = true
  },
})

onMounted(() => {
  loadInitialData()
})

// ----------------------------------------------------------------
// RPC listeners
// ----------------------------------------------------------------

const updateState = ref<{
  show: boolean
  status: string
  message: string
  progress?: number
  hash?: string
}>({
  message: '',
  progress: undefined,
  show: false,
  status: '',
  hash: undefined,
})

// All Electrobun statuses that indicate a download is actively in progress
const DOWNLOAD_IN_PROGRESS_STATUSES = new Set([
  'download-starting',
  'checking-local-tar',
  'local-tar-found',
  'local-tar-missing',
  'fetching-patch',
  'patch-found',
  'patch-not-found',
  'downloading-patch',
  'applying-patch',
  'patch-applied',
  'extracting-version',
  'patch-chain-complete',
  'downloading-full-bundle',
  'download-progress',
  'decompressing',
])

useRpcListener('chat_message', (msg: NormalizedChatMessage) => {
  messages.value.push(msg)
  if (messages.value.length > 500) messages.value.splice(0, messages.value.length - 500)
})

useRpcListener('chat_event', (ev: NormalizedEvent) => {
  events.value.push(ev)
  if (events.value.length > 200) events.value.splice(0, events.value.length - 200)
  if (activeTab.value !== 'events') {
    unreadEvents.value++
  }
})

useRpcListener('platform_status', (s: PlatformStatusInfo) => {
  channelStatusStore.setStatus(s.platform, s)
})

useRpcListener(
  'auth_success',
  ({ platform, displayName }: { platform: string; username: string; displayName: string }) => {
    console.log(`[Auth] Authenticated as ${displayName} on ${platform}`)
    rpc.request.getAccounts().then((a) => {
      if (a !== undefined) accountsStore.setAccounts(a)
    })
  },
)

useRpcListener('auth_error', ({ platform, error }: { platform: string; error: string }) => {
  console.error(`[Auth] Error on ${platform}: ${error}`)
})

useRpcListener(
  'update_status',
  (status: { status: string; message: string; progress?: number; hash?: string }) => {
    console.log(`[Update] ${status.status}: ${status.message}`)
    updateState.value.status = status.status
    updateState.value.message = status.message
    updateState.value.progress = status.progress
    if (status.hash !== undefined) {
      updateState.value.hash = status.hash
    }

    if (
      status.status === 'checking' ||
      status.status === 'update-available' ||
      status.status === 'download-complete' ||
      DOWNLOAD_IN_PROGRESS_STATUSES.has(status.status)
    ) {
      updateState.value.show = true
    } else if (status.status === 'no-update') {
      updateState.value.show = true
      setTimeout(() => {
        updateState.value.show = false
      }, 2000)
    } else if (status.status === 'error') {
      updateState.value.show = true
      setTimeout(() => {
        updateState.value.show = false
      }, 4000)
    } else if (
      status.status === 'applying' ||
      status.status === 'extracting' ||
      status.status === 'replacing-app' ||
      status.status === 'launching-new-version' ||
      status.status === 'complete'
    ) {
      updateState.value.show = true
    }
  },
)

useRpcListener(
  'watched_channel_message',
  ({ channelId, message }: { channelId: string; message: NormalizedChatMessage }) => {
    const prev = watchedMessages.value.get(channelId) ?? []
    prev.push(message)
    if (prev.length > 200) prev.splice(0, prev.length - 200)
    watchedMessages.value.set(channelId, prev)
    triggerRef(watchedMessages)
  },
)

useRpcListener(
  'watched_channel_status',
  ({ channelId, status }: { channelId: string; status: PlatformStatusInfo }) => {
    watchedStatuses.value = new Map(watchedStatuses.value).set(channelId, status)
  },
)

onMounted(() => {
  checkForUpdates()
})

async function checkForUpdates() {
  try {
    const result = await rpc.request.checkForUpdate()
    if (result.updateAvailable) {
      await rpc.request.downloadUpdate()
    }
  } catch (error) {
    console.warn('[Update] Failed to check for updates:', error)
  }
}

async function applyUpdate() {
  try {
    await rpc.request.applyUpdate()
  } catch (error) {
    console.error('[Update] Failed to apply update:', error)
  }
}

function switchTab(tab: typeof activeTab.value) {
  activeTab.value = tab
  if (tab === 'events') {
    unreadEvents.value = 0
  }
}

function cycleTab(direction: 1 | -1) {
  if (activeTab.value !== 'chat') {
    activeTab.value = 'chat'
  }
  const tabList = ['home', ...[...tabChannelIds.value]]
  if (tabList.length <= 1) return
  const currentIdx = tabList.indexOf(activeWatchedTab.value)
  const nextIdx = (currentIdx + direction + tabList.length) % tabList.length
  activeWatchedTab.value = tabList[nextIdx]!
}

function onSettingsSaved(s: AppSettings) {
  settings.value = s
}

function onSettingsChange(s: AppSettings) {
  settings.value = s
}

function dismissUpdate() {
  updateState.value.show = false
}

async function skipUpdate() {
  const hash = updateState.value.hash
  if (!hash) return
  try {
    await rpc.request.skipUpdate({ hash })
  } catch (error) {
    console.error('[Update] Failed to skip update:', error)
  }
  updateState.value.show = false
}

function onTabChannelsUpdated({ tabId, channelNames }: { tabId: string; channelNames: string[] }) {
  tabChannelNames.value = new Map(tabChannelNames.value).set(tabId, channelNames)
}

// ----------------------------------------------------------------
// Watched channel actions
// ----------------------------------------------------------------

async function doAddWatchedChannel(
  platform: 'twitch' | 'kick' | 'youtube',
  channelSlug: string,
): Promise<WatchedChannel> {
  const ch = await rpc.request.addWatchedChannel({ channelSlug, platform })
  if (!watchedChannels.value.find((c: WatchedChannel) => c.id === ch.id)) {
    watchedChannels.value = [...watchedChannels.value, ch]
  }
  void streamStatusStore.refresh(accounts.value, watchedChannels.value)
  return ch
}

async function onAddChannel(platform: 'twitch' | 'kick' | 'youtube', channelSlug: string) {
  showAddModal.value = false
  try {
    const ch = await doAddWatchedChannel(platform, channelSlug)
    tabChannelIds.value = new Set([...tabChannelIds.value, ch.id])
    await rpc.request.setTabChannelIds?.({ ids: [...tabChannelIds.value] })
  } catch (error) {
    console.error('[App] addWatchedChannel failed:', error)
  }
}

function onTabReorder(fromId: string, toId: string) {
  const ids = [...tabChannelIds.value]
  const fromIdx = ids.indexOf(fromId)
  const toIdx = ids.indexOf(toId)
  if (fromIdx === -1 || toIdx === -1) return
  ids.splice(fromIdx, 1)
  ids.splice(toIdx, 0, fromId)
  tabChannelIds.value = new Set(ids)
  rpc.request
    .setTabChannelIds?.({ ids })
    .catch((e) => console.warn('[App] reorder tabs failed:', e))
}

async function onRemoveChannel(id: string) {
  try {
    const ch = watchedChannels.value.find((c: WatchedChannel) => c.id === id)
    await rpc.request.removeWatchedChannel({ id })
    watchedChannels.value = watchedChannels.value.filter((c: WatchedChannel) => c.id !== id)
    tabChannelIds.value = new Set([...tabChannelIds.value].filter((i) => i !== id))
    await rpc.request.setTabChannelIds?.({ ids: [...tabChannelIds.value] })
    watchedMessages.value = new Map([...watchedMessages.value].filter(([k]) => k !== id))
    watchedStatuses.value = new Map([...watchedStatuses.value].filter(([k]) => k !== id))
    if (ch && ch.platform !== 'youtube') {
      streamStatusStore.removeChannel(ch.platform as 'twitch' | 'kick', ch.channelSlug)
    }
  } catch (error) {
    console.error('[App] removeWatchedChannel failed:', error)
  }
}

async function onSendWatched({ text, channelId }: { text: string; channelId?: string }) {
  // channelId is required in the new layout system
  if (!channelId) {
    return
  }
  try {
    await rpc.request.sendWatchedChannelMessage({ id: channelId, text })
  } catch (error) {
    console.error('[App] sendWatchedChannelMessage failed:', error)
  }
}
</script>

<template>
  <div
    class="app"
    :class="[
      settings?.theme ?? 'dark',
      settings?.fontFamily ? `font-${settings.fontFamily}` : 'font-inter',
    ]"
  >
    <!-- Left icon navigation -->
    <nav class="nav-rail" :class="{ collapsed: sidebarCollapsed }">
      <div class="nav-logo">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="3" width="20" height="14" rx="3" fill="currentColor" opacity=".9" />
          <path
            d="M7 21h10M12 17v4"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </div>

      <div class="nav-items">
        <button
          class="nav-item"
          :class="{ active: activeTab === 'chat' }"
          title="Chat"
          @click="switchTab('chat')"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span class="nav-label">Chat</span>
        </button>

        <button
          class="nav-item"
          :class="{ active: activeTab === 'events' }"
          title="Events"
          @click="switchTab('events')"
        >
          <div class="nav-item-inner">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span v-if="unreadEvents > 0" class="badge">{{
              unreadEvents > 99 ? '99+' : unreadEvents
            }}</span>
          </div>
          <span class="nav-label">Events</span>
        </button>

        <button
          class="nav-item"
          :class="{ active: activeTab === 'platforms' }"
          title="Platforms"
          @click="switchTab('platforms')"
        >
          <div class="nav-item-inner">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path
                d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
              />
            </svg>
            <span v-if="connectedAccountsCount > 0" class="badge badge-green">
              {{ connectedAccountsCount }}
            </span>
          </div>
          <span class="nav-label">Platforms</span>
        </button>

        <button
          class="nav-item"
          :class="{ active: activeTab === 'settings' }"
          title="Settings"
          @click="switchTab('settings')"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
          <span class="nav-label">Settings</span>
        </button>
      </div>

      <!-- Collapse toggle button -->
      <button
        class="nav-collapse-btn"
        :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggleSidebar"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          :class="{ 'icon-flipped': sidebarCollapsed }"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    </nav>

    <!-- Main content area -->
    <main class="content">
      <!-- Channel tab bar for watched channels -->
      <ChannelTabBar
        v-if="activeTab === 'chat'"
        :watched-channels="tabWatchedChannels"
        :active-tab-id="activeWatchedTab"
        :watched-statuses="watchedStatuses"
        :watched-live-statuses="watchedLiveStatuses"
        :tab-channel-names="tabChannelNames"
        @select-tab="activeWatchedTab = $event"
        @add-channel="showAddModal = true"
        @remove-channel="onRemoveChannel"
        @reorder="onTabReorder"
      />

      <!-- Home tab: combined chat across all own channels -->
      <ChatList
        v-if="activeTab === 'chat' && activeWatchedTab === 'home' && settings"
        :messages="messages"
        :settings="settings"
        :accounts="accounts"
        :statuses="statuses"
        @settings-change="onSettingsChange"
      />

      <!-- Watched channel tab: per-tab independent layout -->
      <WatchedChannelsView
        v-if="activeTab === 'chat' && activeWatchedTab !== 'home' && settings"
        :tab-id="activeWatchedTab"
        :messages="messages"
        :settings="settings"
        :accounts="accounts"
        :statuses="statuses"
        :watched-messages="watchedMessages"
        :watched-statuses="watchedStatuses"
        :watched-channels="watchedChannels"
        :on-add-watched-channel="doAddWatchedChannel"
        @tab-channels-updated="onTabChannelsUpdated"
        @settings-change="onSettingsChange"
        @send-watched="onSendWatched"
      />

      <EventsFeed v-show="activeTab === 'events'" :events="events" />

      <PlatformsPanel
        v-show="activeTab === 'platforms'"
        :accounts="accounts"
        :statuses="statuses"
        @accounts-updated="accountsStore.setAccounts($event)"
      />

      <SettingsPanel
        v-show="activeTab === 'settings'"
        :settings="settings"
        @saved="onSettingsSaved"
        @change="onSettingsChange"
      />
    </main>

    <!-- Add channel modal -->
    <AddChannelModal
      data-testid="add-channel-modal"
      v-if="showAddModal"
      :youtube-authenticated="youtubeAuthenticated"
      @confirm="onAddChannel"
      @cancel="showAddModal = false"
    />

    <TabSelectorModal
      v-if="showTabSelector"
      :tabs="tabSelectorItems"
      :active-tab-id="activeWatchedTab"
      @select="
        (id) => {
          activeWatchedTab = id
          activeTab = 'chat'
        }
      "
      @close="showTabSelector = false"
    />

    <!-- Update notification toast -->
    <div v-if="updateState.show" class="update-toast">
      <div class="update-content">
        <div class="update-icon">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
        </div>
        <div class="update-info">
          <div class="update-title">{{ updateState.message }}</div>
          <div v-if="updateState.progress !== undefined" class="update-progress">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: updateState.progress + '%' }" />
            </div>
            <span class="progress-text">{{ updateState.progress }}%</span>
          </div>
        </div>
        <button
          v-if="updateState.status === 'download-complete'"
          class="update-btn"
          @click="applyUpdate"
        >
          Restart
        </button>
        <button
          v-if="updateState.status === 'update-available' && updateState.hash"
          class="update-btn update-btn-skip"
          @click="skipUpdate"
        >
          Skip
        </button>
        <button class="update-close" @click="dismissUpdate">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style>
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body.light {
  --c-bg: #f0eff4;
  --c-surface: #faf9fc;
  --c-surface-2: #e8e7ed;
  --c-border: #d8d6e0;
  --c-text: #1c1b22;
  --c-text-2: #6b6878;
  --c-nav-bg: #faf9fc;
  --c-nav-text: rgba(28, 27, 34, 0.45);
  --c-nav-active: #1c1b22;
}

body {
  --c-bg: #0f0f11;
  --c-surface: #18181b;
  --c-surface-2: #1f1f24;
  --c-border: #2a2a33;
  --c-text: #e2e2e8;
  --c-text-2: #8b8b99;
  --c-nav-bg: #111114;
  --c-nav-text: rgba(255, 255, 255, 0.45);
  --c-nav-active: #fff;

  font-family:
    var(--font-family, 'Inter'),
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
  background: #0f0f11;
  color: #e2e2e8;
  height: 100vh;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.22);
}
</style>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #0f0f11;
  color: #e2e2e8;
}

/* Light theme overrides */
.app.light {
  --c-bg: #f0eff4;
  --c-surface: #faf9fc;
  --c-surface-2: #e8e7ed;
  --c-border: #d8d6e0;
  --c-text: #1c1b22;
  --c-text-2: #6b6878;
  --c-nav-bg: #faf9fc;
  --c-nav-text: rgba(28, 27, 34, 0.45);
  --c-nav-active: #1c1b22;
  background: var(--c-bg);
  color: var(--c-text);
}

.app.font-inter {
  --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.app.font-manrope {
  --font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.app.font-system {
  --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.app.light .nav-rail {
  border-right: 1px solid var(--c-border);
}

.app.light .nav-item:hover {
  background: rgba(28, 27, 34, 0.06);
  color: rgba(28, 27, 34, 0.75);
}

.app.light .nav-item.active {
  background: rgba(124, 90, 234, 0.12);
  color: #7c5aea;
}

.app.light ::-webkit-scrollbar-thumb {
  background: rgba(28, 27, 34, 0.14);
}
.app.light ::-webkit-scrollbar-thumb:hover {
  background: rgba(28, 27, 34, 0.24);
}

.app.dark {
  --c-bg: #0f0f11;
  --c-surface: #18181b;
  --c-surface-2: #1f1f24;
  --c-border: #2a2a33;
  --c-text: #e2e2e8;
  --c-text-2: #8b8b99;
  --c-nav-bg: #111114;
  --c-nav-text: rgba(255, 255, 255, 0.45);
  --c-nav-active: #fff;
}

/* ---- Nav rail ---- */
.nav-rail {
  width: 68px;
  flex-shrink: 0;
  background: var(--c-nav-bg, #111114);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0 16px;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  gap: 4px;
  overflow: hidden;
  transition: width 0.2s ease;
}

.nav-rail.collapsed {
  width: 44px;
}

.nav-logo {
  color: #a78bfa;
  margin-bottom: 12px;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 0 8px;
  flex: 1;
}

.nav-item {
  background: none;
  border: none;
  color: var(--c-nav-text, rgba(255, 255, 255, 0.45));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px 4px;
  border-radius: 10px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
  width: 100%;
  position: relative;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.8);
}

.nav-item.active {
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
}

.nav-item-inner {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.01em;
  transition:
    opacity 0.15s ease,
    max-height 0.15s ease;
}

.nav-rail.collapsed .nav-label {
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  pointer-events: none;
}

/* ---- Collapse toggle button ---- */
.nav-collapse-btn {
  background: none;
  border: none;
  color: var(--c-nav-text, rgba(255, 255, 255, 0.35));
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
  flex-shrink: 0;
  margin-top: auto;
}

.nav-collapse-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}

.nav-collapse-btn .icon-flipped {
  transform: rotate(180deg);
}

.app.light .nav-collapse-btn {
  color: var(--c-nav-text, rgba(28, 27, 34, 0.4));
}

.app.light .nav-collapse-btn:hover {
  background: rgba(28, 27, 34, 0.07);
  color: rgba(28, 27, 34, 0.7);
}

.badge {
  position: absolute;
  top: -6px;
  right: -8px;
  background: #ef4444;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  border-radius: 10px;
  padding: 1px 4px;
  min-width: 16px;
  text-align: center;
  line-height: 14px;
}

.badge-green {
  background: #22c55e;
}

/* ---- Content area ---- */
.content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--c-bg, #0f0f11);
}

/* ---- Update toast ---- */
.update-toast {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 1000;
  background: var(--c-surface, #18181b);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 12px;
  padding: 16px;
  min-width: 300px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.update-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.update-icon {
  color: #a78bfa;
  flex-shrink: 0;
}

.update-info {
  flex: 1;
  min-width: 0;
}

.update-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text, #e2e2e8);
}

.update-progress {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--c-surface-2, #1f1f24);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #a78bfa;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 11px;
  color: var(--c-text-2, #8b8b99);
  min-width: 32px;
  text-align: right;
}

.update-btn {
  background: #a78bfa;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.update-btn-skip {
  background: transparent;
  color: var(--c-text-2, #8b8b99);
  border: 1px solid var(--c-border, #2a2a33);
}

.update-btn-skip:hover {
  color: var(--c-text, #e2e2e8);
  border-color: var(--c-text-2, #8b8b99);
}

.update-btn:hover {
  opacity: 0.9;
}

.update-close {
  background: none;
  border: none;
  color: var(--c-text-2, #8b8b99);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition:
    background 0.15s,
    color 0.15s;
  flex-shrink: 0;
}

.update-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--c-text, #e2e2e8);
}

/* ---- Maximize restore bar ---- */
.maximize-restore-bar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--c-surface, #18181b);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 24px;
  padding: 8px 16px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}

.maximize-restore-label {
  font-size: 13px;
  color: var(--c-text-2, #8b8b99);
}

.maximize-restore-btn {
  background: #a78bfa;
  color: #fff;
  border: none;
  border-radius: 14px;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.maximize-restore-btn:hover {
  opacity: 0.9;
}
</style>
