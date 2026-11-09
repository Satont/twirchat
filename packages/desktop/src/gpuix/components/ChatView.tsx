import { Tooltip, TooltipContent, TooltipTrigger, useGpuixRequired } from '@gpuix/react'
/**
 * Chat pane — port of ChatList.vue (header + virtualized list + composer)
 * onto GPUIX's native <virtual-list> (alignment="bottom" followTail replaces
 * the virtua VList + manual at-bottom tracking).
 */
import type { ChannelStatus } from '@twirchat/shared/protocol'
import type {
  Account,
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  createPauseController,
  matchesPauseModifier,
  hoverPauseDurationMs,
  DOUBLE_CLICK_PAUSE_MS,
} from '../../services/chat-pause'
import { appendLiveChatMessages } from '../../views/main/utils/chat-message-buffer'
import { ownChatSendTargets } from '../../views/main/utils/chat-send-targets'
import type { UserCardTarget } from '../../views/main/utils/chatCommands'
import { buildChattersTargets } from '../../views/main/utils/chatters'
import {
  confirmDelivery,
  createPendingMessage,
  failDelivery,
  reconcilePendingMessages,
  type DeliveryMessage,
} from '../../views/main/utils/message-delivery'
import type { ModerationDragAction } from '../../views/main/utils/moderation-drag'
import { publicChannelURL } from '../../views/main/utils/public-channel-url'
import { initialsOf } from '../../views/shared/utils/display-text'
import { useBackend } from '../backend/context'
import { resolveChatAccount } from '../chat-account'
import { mergeChatTimeline, pluginChatSearchMessage, timelineRowKey } from '../chat-timeline'
import { chatMessageKey, compileChatSearch, formatChatTranscript } from '../chat-tools'
import { runUiTask } from '../hooks/run-ui-task'
import { parseHotkeyChoice } from '../hotkey-bindings'
import { useT } from '../i18n'
import { isMessageHiddenForStreamer } from '../message-privacy'
import { compileMessageRules } from '../message-rules'
import { nativeWindow } from '../native-window'
import { useHotkeyContext, useHotkeyRoute, dispatchCustomHotkey } from '../state/action-bindings'
import { activePaneByWindowStore, getActivePane, setActivePane } from '../state/active-pane'
import {
  accountsStore,
  activeTabStore,
  aliasesStore,
  applyModerationOutcome,
  channelStatusStore,
  chatActivityStore,
  chatMessageRate,
  homeMessagesStore,
  moderationViewStore,
  savedAccountsStore,
  settingsStore,
  streamStatusStore,
  watchedMessagesStore,
  watchedStatusesStore,
  showNotice,
} from '../state/app'
import { channelRoomStore, loadRoomState, roomKey } from '../state/channel-state'
import { chatPauseStore } from '../state/chat-pause'
import { chatRulesPreferences, chatRulesStore } from '../state/chat-rules'
import { chatSearchJumpStore, finishChatSearchJump } from '../state/chat-search'
import { composerStore, updateComposer } from '../state/composer'
import { useStore, useStoreSelector } from '../state/create-store'
import { useDesktopWindows } from '../state/desktop-windows'
import { useTextInputFocusTracking } from '../state/focus'
import { highlightFlashStore } from '../state/highlight-notifications'
import { notificationPreferences } from '../state/highlight-notifications'
import {
  homePluginFeedStore,
  setHomePluginChannel,
  type HomePluginRow,
} from '../state/home-plugin-channels'
import { invokeHotkeyUiAction } from '../state/hotkeys'
import { allPanels, layoutStore, focusLayoutPanel } from '../state/layout'
import { messageSimilarityStore, messageSimilarityReaderStore } from '../state/message-similarity'
import { useOverlayClose } from '../state/overlays'
import { streamerModeStore } from '../state/streamer-mode'
import {
  EMPTY_ACTIVITIES,
  loadTwitchActivities,
  twitchActivitiesStore,
} from '../state/twitch-activities'
import { windowActivityStore, updateWindowActivity } from '../state/window-activity'
import { useWindowPresentation } from '../state/window-presentation'
import { useWindowScope } from '../state/window-scope'
import { platformColor, semantic, withAlpha } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { ChatAppearanceDialog } from './ChatAppearanceDialog'
import { ChatHistoryPanel } from './ChatHistoryPanel'
import { ChatInput } from './ChatInput'
import { ChatMessageRow } from './ChatMessageRow'
import { ChattersDialog } from './ChattersDialog'
import { PluginChatRow } from './PluginChatRow'
import { TwitchActivitiesPanel } from './TwitchActivitiesPanel'
import { TwitchAutoMod } from './TwitchAutoMod'
import { Icon, PlatformIcon, type IconName } from './ui/Icon'
import { Modal } from './ui/Modal'
import { RemoteImage } from './ui/RemoteImage'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'
import { UserCardDialog } from './UserCardDialog'

const EMPTY_MESSAGES: NormalizedChatMessage[] = []
const MIN_TAIL_ROWS = 24
const TAIL_OVERSCAN_ROWS = 8
const EMPTY_PLUGIN_ROWS: readonly HomePluginRow[] = []
const EMPTY_PLUGIN_FEED = { channels: [], rows: EMPTY_PLUGIN_ROWS, total: 0 }

interface PausedChat {
  messages: NormalizedChatMessage[]
  pluginRows: readonly HomePluginRow[]
  total: number
}

function platformName(platform: string): string {
  switch (platform) {
    case 'twitch':
      return 'Twitch'
    case 'youtube':
      return 'YouTube'
    case 'kick':
      return 'Kick'
    default:
      return platform
  }
}

/** Live channel chip in the home header, with the rich hover tooltip. */
function HeaderChannelChip({ channel: ch }: { channel: ChannelStatus }) {
  const theme = useTheme()
  const font = useFont()
  const { t } = useT()
  const color = platformColor(ch.platform)
  const hideViewerCount = useStoreSelector(
    streamerModeStore,
    (state) => state.effectiveEnabled && state.settings.hideViewerCountAndDuration,
  )

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            paddingTop: 3,
            paddingBottom: 3,
            paddingLeft: 6,
            paddingRight: 8,
            borderRadius: 20,
            borderWidth: 1,
            flexShrink: 0,
            backgroundColor: ch.isLive ? withAlpha(color, 0.12) : theme.fill,
            borderColor: ch.isLive ? withAlpha(color, 0.35) : theme.hairline,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              flexShrink: 0,
              backgroundColor: ch.isLive ? color : theme.text2,
            }}
          />
          <Text
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: ch.isLive ? theme.text : theme.text2,
              maxWidth: 100,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {ch.channelLogin}
          </Text>
          {ch.isLive && ch.viewerCount !== undefined && !hideViewerCount ? (
            <Text style={{ fontSize: 11, color: theme.text2, opacity: 0.75 }}>
              {formatViewers(ch.viewerCount)}
            </Text>
          ) : null}
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={8}
        style={{
          backgroundColor: theme.popover,
          borderWidth: 1,
          borderColor: theme.dialogBorder,
          borderRadius: 8,
          padding: 10,
          minWidth: 190,
          maxWidth: 270,
          boxShadow: {
            offsetX: 0,
            offsetY: 8,
            blurRadius: 24,
            spreadRadius: 0,
            color: '#00000080',
          },
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <text style={{ fontSize: 11, fontWeight: 700, color, fontFamily: font }}>
              {platformName(ch.platform)}
            </text>
            <text
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: ch.isLive ? semantic.success : theme.text2,
                fontFamily: font,
              }}
            >
              {ch.isLive ? t('chat.header.live') : t('chat.header.offline')}
            </text>
          </div>
          {ch.title ? (
            <text style={{ fontSize: 12, color: '#e2e2e8', fontFamily: font }}>{ch.title}</text>
          ) : null}
          {ch.categoryName ? (
            <text style={{ fontSize: 11, color: '#8b8b99', fontFamily: font }}>
              {t('chat.header.category', { name: ch.categoryName })}
            </text>
          ) : null}
          {ch.isLive && ch.viewerCount !== undefined && !hideViewerCount ? (
            <text style={{ fontSize: 11, color: '#8b8b99', fontFamily: font }}>
              {t('chat.header.viewers', { count: ch.viewerCount.toLocaleString() })}
            </text>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function formatViewers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export interface ChatViewProps {
  headerLeading?: ReactNode
  paneId?: string
  layoutTabId?: string
  layoutPanelId?: string
  /** null/undefined = the combined "My channels" home pane */
  watchedChannel?: WatchedChannel | null
  isMain?: boolean
  onGoToPlatforms?: () => void
  onSplitRight?: () => void
  onChangeChannel?: () => void
  onClosePanel?: () => void
}

export function ChatView({
  headerLeading,
  paneId,
  layoutTabId = 'home',
  layoutPanelId,
  watchedChannel,
  onGoToPlatforms,
  onSplitRight,
  onChangeChannel,
  onClosePanel,
}: ChatViewProps) {
  const backend = useBackend()
  const theme = useTheme()
  const { t, tPlural } = useT()
  const renderer = useGpuixRequired()
  const scope = useWindowScope()
  const windows = useDesktopWindows()
  const presentation = useWindowPresentation()

  const baseSettings = useStore(settingsStore)
  const settings = useMemo(
    () =>
      baseSettings
        ? { ...baseSettings, fontSize: baseSettings.fontSize * presentation.zoom }
        : null,
    [baseSettings, presentation.zoom],
  )
  const accounts = useStore(accountsStore)
  const savedAccounts = useStore(savedAccountsStore)
  const chatAccount = watchedChannel
    ? resolveChatAccount(watchedChannel, savedAccounts, accounts)
    : undefined
  // Mentions of, and messages from, the account this chat sends with count as the user's own.
  const ownAccounts = useMemo(
    () =>
      chatAccount && !accounts.some((account) => account.id === chatAccount.id)
        ? [...accounts, chatAccount]
        : accounts,
    [accounts, chatAccount],
  )
  const aliases = useStore(aliasesStore)
  const rules = useStoreSelector(chatRulesStore, (state) => state.value)
  const similaritySettings = useStoreSelector(messageSimilarityStore, (state) => state.value)
  const similarityReader = useStore(messageSimilarityReaderStore)
  const streamerMode = useStore(streamerModeStore)
  const pausePreferences = useStoreSelector(chatPauseStore, (state) => state.value)
  const windowActivity = useStoreSelector(windowActivityStore, (entries) => entries.get(scope))
  const statuses = useStore(channelStatusStore)
  // A split only observes its channel; activity elsewhere must not repaint it.
  const homeMessages = useStoreSelector(homeMessagesStore, (messages) =>
    watchedChannel ? EMPTY_MESSAGES : messages,
  )
  const pluginFeed = useStoreSelector(homePluginFeedStore, (feed) =>
    watchedChannel ? EMPTY_PLUGIN_FEED : feed,
  )
  const watchedMessages = useStoreSelector(watchedMessagesStore, (messages) =>
    watchedChannel ? (messages.get(watchedChannel.id) ?? EMPTY_MESSAGES) : EMPTY_MESSAGES,
  )
  const watchedChannelStatus = useStoreSelector(watchedStatusesStore, (statuses) =>
    watchedChannel ? (statuses.get(watchedChannel.id) ?? null) : null,
  )
  const streamStatuses = useStore(streamStatusStore)
  const moderationView = useStore(moderationViewStore)
  const activityKey = watchedChannel?.id ?? 'home'
  const flash = useStoreSelector(highlightFlashStore, (entries) =>
    watchedChannel
      ? entries.get(roomKey(watchedChannel.platform, watchedChannel.channelSlug))
      : undefined,
  )
  const activity = useStoreSelector(chatActivityStore, (entries) => entries.get(activityKey))

  // ── Messages + optimistic delivery ─────────────────────────────────────────

  const [deliveryMessages, setDeliveryMessages] = useState<DeliveryMessage[]>([])
  const providerMessages = useMemo(
    () => (watchedChannel ? watchedMessages : homeMessages),
    [watchedChannel, watchedMessages, homeMessages],
  )

  const visibleDeliveries = useMemo(() => {
    // Saved accounts include those chosen for a single chat.
    const own = (message: DeliveryMessage) => (account: Account) =>
      account.platform === message.platform && account.platformUserId === message.author.id
    const retained = deliveryMessages.filter(
      (message) =>
        message.delivery?.scope === activityKey &&
        (accounts.some(own(message)) || savedAccounts.some(own(message))),
    )
    return reconcilePendingMessages(
      retained.length === deliveryMessages.length ? deliveryMessages : retained,
      providerMessages,
    )
  }, [deliveryMessages, providerMessages, accounts, savedAccounts, activityKey])

  useEffect(() => {
    if (visibleDeliveries !== deliveryMessages)
      setDeliveryMessages((current) => (current === deliveryMessages ? visibleDeliveries : current))
  }, [visibleDeliveries, deliveryMessages])

  const activeMessages = useMemo(
    () => appendLiveChatMessages(providerMessages, visibleDeliveries, 0),
    [providerMessages, visibleDeliveries],
  )

  const ruleEngine = useMemo(
    () =>
      compileMessageRules(rules, ownAccounts, (message) => ({
        similar: similarityReader.get(message)?.similar,
      })),
    [rules, ownAccounts, similarityReader],
  )
  const paneKey = paneId ? `${paneId}:${activityKey}` : activityKey
  const twitchChannel = watchedChannel
    ? watchedChannel.platform === 'twitch'
      ? watchedChannel.channelSlug
      : null
    : (accounts.find((account) => account.platform === 'twitch')?.username ?? null)
  const room = useStoreSelector(channelRoomStore, (rooms) =>
    twitchChannel ? rooms.get(roomKey('twitch', twitchChannel)) : undefined,
  )
  const twitchActivity = useStoreSelector(twitchActivitiesStore, (channels) =>
    twitchChannel
      ? (channels.get(twitchChannel.toLowerCase()) ?? EMPTY_ACTIVITIES)
      : EMPTY_ACTIVITIES,
  )
  const [activitiesOpen, setActivitiesOpen] = useState(false)
  const [activitiesTab, setActivitiesTab] = useState<'polls' | 'queue'>('polls')
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [moderationMode, setModerationMode] = useState(true)
  const activePlatform = useStoreSelector(
    composerStore,
    (states) => states.get(paneKey)?.activePlatform,
  )
  const commandRunner = useRef<((text: string) => Promise<void>) | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [bannersHidden, setBannersHidden] = useState(false)
  const bannerSnapshot = bannersHidden ? null : twitchActivity.snapshot
  const pinnedMessage = bannerSnapshot?.pinnedMessage
  const activePolls = bannerSnapshot?.polls.filter((poll) => poll.status === 'ACTIVE')
  const visiblePredictions = bannerSnapshot?.predictions.filter(
    (prediction) => prediction.status === 'ACTIVE' || prediction.status === 'LOCKED',
  )
  useEffect(() => {
    if (!twitchChannel) return
    runUiTask(loadRoomState(backend, 'twitch', twitchChannel))
    runUiTask(loadTwitchActivities(backend, twitchChannel))
    let disposed = false
    let subscribed = false
    runUiTask(
      backend.api
        .watchTwitchActivities({ channelSlug: twitchChannel, watch: true })
        .then(() => {
          if (disposed)
            runUiTask(
              backend.api.watchTwitchActivities({ channelSlug: twitchChannel, watch: false }),
            )
          else subscribed = true
        })
        .catch(() => {}),
    )
    return () => {
      disposed = true
      if (subscribed)
        runUiTask(backend.api.watchTwitchActivities({ channelSlug: twitchChannel, watch: false }))
    }
  }, [backend, twitchChannel])
  const aliasMap = useMemo(
    () =>
      new Map(aliases.map((alias) => [`${alias.platform}:${alias.platformUserId}`, alias.alias])),
    [aliases],
  )
  const [searchOpen, setSearchOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [mentionsOnly, setMentionsOnly] = useState(false)
  const [paused, setPaused] = useState<PausedChat | null>(null)
  const [clearedKeys, setClearedKeys] = useState<Set<string>>(new Set())
  const [revealedMessageKey, setRevealedMessageKey] = useState<string | null>(null)
  const searchJump = useStore(chatSearchJumpStore)
  const pendingJump = useRef<{ requestId: string; messageKey: string } | null>(null)
  const searchRef = useRef<import('@gpuix/react').PublicInstance | null>(null)
  const resumeScrollRequested = useRef(false)
  const activityTotal = (activity?.total ?? 0) + pluginFeed.total
  const pauseSnapshot: PausedChat = {
    messages: activeMessages,
    pluginRows: pluginFeed.rows,
    total: activityTotal,
  }
  const pauseInput = useRef(pauseSnapshot)
  pauseInput.current = pauseSnapshot
  const onPauseChanged = useRef<(value: boolean) => void>(() => {})
  onPauseChanged.current = (value) => {
    if (value) setPaused((current) => current ?? pauseInput.current)
    else {
      setRevealedMessageKey(null)
      resumeScrollRequested.current = true
      setPaused(null)
    }
  }
  const pauseController = useMemo(
    () => createPauseController({ onChange: (value) => onPauseChanged.current(value) }),
    [],
  )
  const pauseForDoubleClick = useCallback(
    () => pauseController.add('doubleClick', DOUBLE_CLICK_PAUSE_MS),
    [pauseController],
  )
  useEffect(() => () => pauseController.dispose(), [pauseController])
  useEffect(() => {
    if (windowActivity?.active === false) {
      pauseController.deactivate()
      return
    }
    if (matchesPauseModifier(pausePreferences.modifier, windowActivity?.modifiers))
      pauseController.add('keyboardModifier')
    else pauseController.remove('keyboardModifier')
  }, [pauseController, pausePreferences.modifier, windowActivity])
  useEffect(() => {
    if (pausePreferences.hoverSeconds === 0) pauseController.remove('mouse')
    if (!pausePreferences.doubleClickLinks) pauseController.remove('doubleClick')
  }, [pauseController, pausePreferences.hoverSeconds, pausePreferences.doubleClickLinks])
  const searchFocus = useTextInputFocusTracking()
  const search = useMemo(() => compileChatSearch(searchQuery), [searchQuery])
  const readingMessages = paused?.messages ?? activeMessages
  const readingPluginRows = paused?.pluginRows ?? pluginFeed.rows
  const displayedMessages = useMemo(
    () =>
      readingMessages.filter((message) => {
        if (isMessageHiddenForStreamer(message, streamerMode)) return false
        if (chatMessageKey(message) === revealedMessageKey) return true
        if (clearedKeys.has(chatMessageKey(message))) return false
        if (similaritySettings.hideSimilar && similarityReader.get(message)?.similar) return false
        const classification = ruleEngine.classify(message)
        if (classification.hidden && !classification.placeholder) return false
        if (
          !ruleEngine.matchesFilters(message, paneKey, {
            channelName: watchedChannel?.channelSlug ?? statuses[message.platform]?.channelLogin,
            deleted: moderationView.outcomeFor(message)?.isTombstone === true,
          })
        )
          return false
        if (
          settings?.platformFilter !== undefined &&
          settings.platformFilter !== 'all' &&
          !settings.platformFilter.includes(message.platform)
        )
          return false
        const highlighted = classification.highlighted
        if (mentionsOnly && !classification.mention) return false
        return search.matches(message, {
          alias: aliasMap.get(`${message.platform}:${message.author.id}`),
          highlighted,
          similar: similarityReader.get(message)?.similar,
          deleted: moderationView.outcomeFor(message)?.isTombstone === true,
          channelName: watchedChannel?.channelSlug ?? statuses[message.platform]?.channelLogin,
        })
      }),
    [
      readingMessages,
      clearedKeys,
      settings?.platformFilter,
      mentionsOnly,
      search,
      aliasMap,
      moderationView,
      watchedChannel?.channelSlug,
      statuses,
      ruleEngine,
      paneKey,
      revealedMessageKey,
      similaritySettings,
      similarityReader,
      streamerMode,
    ],
  )
  const pluginChannelIds = useMemo(
    () => new Set(pluginFeed.channels.map((channel) => channel.id)),
    [pluginFeed.channels],
  )
  const displayedPluginRows = useMemo(() => {
    if (
      readingPluginRows.length === 0 ||
      mentionsOnly ||
      (settings?.platformFilter !== undefined && settings.platformFilter !== 'all')
    )
      return EMPTY_PLUGIN_ROWS
    const searching = searchQuery.trim().length > 0
    return readingPluginRows.filter(
      (row) =>
        pluginChannelIds.has(row.channel.id) &&
        !clearedKeys.has(row.key) &&
        (!searching ||
          search.matches(pluginChatSearchMessage(row), { channelName: row.channel.channelSlug })),
    )
  }, [
    readingPluginRows,
    pluginChannelIds,
    clearedKeys,
    mentionsOnly,
    settings?.platformFilter,
    searchQuery,
    search,
  ])
  const displayedTimeline = useMemo(
    () => mergeChatTimeline(displayedMessages, displayedPluginRows),
    [displayedMessages, displayedPluginRows],
  )
  const mentionsCount = useMemo(
    () => activeMessages.filter((message) => ruleEngine.classify(message).mention).length,
    [activeMessages, ruleEngine],
  )
  const pendingCount = paused ? Math.max(0, activityTotal - paused.total) : 0
  const filtered =
    !!searchQuery.trim() ||
    mentionsOnly ||
    (rules.paneFilters[paneKey]?.length ?? 0) > 0 ||
    (settings?.platformFilter !== undefined && settings.platformFilter !== 'all')

  function changePause(value: boolean) {
    if (value) pauseController.add('manual')
    else pauseController.clear()
  }
  const openSearch = useCallback(
    (query?: string) => {
      if (query !== undefined) setSearchQuery(query)
      setSearchOpen(true)
      if (searchRef.current) renderer.focusElement?.(searchRef.current.id)
    },
    [renderer],
  )
  function closeSearch() {
    setSearchOpen(false)
    setSearchQuery('')
  }
  function clearMessages() {
    const keys = new Set(activeMessages.map(chatMessageKey))
    for (const row of pluginFeed.rows) keys.add(row.key)
    setClearedKeys(keys)
    pauseController.clear()
  }
  function selectFilter(id: string, enabled: boolean) {
    const current = chatRulesStore.get().value
    const ids = current.paneFilters[paneKey] ?? []
    const next = {
      ...current,
      paneFilters: {
        ...current.paneFilters,
        [paneKey]: enabled ? [...new Set([...ids, id])] : ids.filter((entry) => entry !== id),
      },
    }
    void chatRulesPreferences
      .save(backend.api, next)
      .catch((error) => showNotice('error', String(error)))
  }
  function copyMessages() {
    const transcript = displayedTimeline.map((row) =>
      'message' in row
        ? { ...pluginChatSearchMessage(row), timestamp: row.message.timestamp }
        : row,
    )
    void backend.api
      .copyText({ text: formatChatTranscript(transcript) })
      .then(() =>
        showNotice('success', tPlural('chat.notice.copiedMessages', displayedTimeline.length)),
      )
      .catch(() => showNotice('error', t('chat.notice.copyFailed')))
  }

  // ── Virtual list + scroll pill ─────────────────────────────────────────────

  const listRef = useRef<import('@gpuix/react').PublicInstance | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [visibleRange, setVisibleRange] = useState<{ start: number; end: number } | null>(null)
  // Following a flood, rows above the viewport would mount and scroll away unseen.
  const tailRows = Math.max(
    MIN_TAIL_ROWS,
    (visibleRange ? visibleRange.end - visibleRange.start : 0) + TAIL_OVERSCAN_ROWS,
  )
  const renderedTimeline = useMemo(
    () =>
      atBottom && !paused && !revealedMessageKey && displayedTimeline.length > tailRows
        ? displayedTimeline.slice(-tailRows)
        : displayedTimeline,
    [atBottom, paused, revealedMessageKey, displayedTimeline, tailRows],
  )

  useEffect(() => {
    if (
      !searchJump ||
      searchJump.target.tabId !== layoutTabId ||
      (searchJump.target.windowId ?? 'main') !== scope ||
      searchJump.target.paneId !== paneId
    )
      return
    if (pendingJump.current?.requestId === searchJump.requestId) return
    const found = activeMessages.some(
      (message) => chatMessageKey(message) === searchJump.messageKey,
    )
    if (!found) {
      finishChatSearchJump(searchJump.requestId, false)
      return
    }
    pendingJump.current = { requestId: searchJump.requestId, messageKey: searchJump.messageKey }
    resumeScrollRequested.current = false
    // Keep the retained message available while the user reads its context.
    pauseController.add('search')
    setPaused(pauseInput.current)
    setRevealedMessageKey(searchJump.messageKey)
  }, [searchJump, paneId, activeMessages, activity?.total, pauseController, layoutTabId, scope])

  useEffect(() => {
    const pending = pendingJump.current
    if (!pending || revealedMessageKey !== pending.messageKey) return
    const index = displayedTimeline.findIndex((row) => timelineRowKey(row) === pending.messageKey)
    if (index < 0) return
    const timer = setTimeout(() => {
      if (pendingJump.current !== pending) return
      const list = listRef.current
      if (list) renderer.scrollToItem?.(list.id, index)
      pendingJump.current = null
      setAtBottom(index === displayedTimeline.length - 1)
      finishChatSearchJump(pending.requestId, !!list)
    }, 20)
    return () => clearTimeout(timer)
  }, [displayedTimeline, revealedMessageKey, renderer])

  useEffect(() => {
    if (paused || !resumeScrollRequested.current) return
    const timer = setTimeout(() => {
      resumeScrollRequested.current = false
      if (listRef.current)
        renderer.scrollToItem?.(listRef.current.id, Math.max(0, renderedTimeline.length - 1))
      setAtBottom(true)
    }, 0)
    return () => clearTimeout(timer)
  }, [paused, renderedTimeline, renderer])

  const scrollToLatest = () => {
    if (listRef.current) {
      renderer.scrollToItem?.(listRef.current.id, Math.max(0, renderedTimeline.length - 1))
      setAtBottom(true)
    }
  }

  // ── Reply / moderation / dialogs ───────────────────────────────────────────

  const [replyTarget, setReplyTarget] = useState<NormalizedChatMessage | null>(null)
  const [userCardTarget, setUserCardTarget] = useState<UserCardTarget | null>(null)
  const [chattersOpen, setChattersOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // The trigger click that dismissed the menu (mousedown closes, click toggles) must not reopen it.
  const menuDismissedAt = useRef(0)
  useOverlayClose(menuOpen, () => setMenuOpen(false))
  const [watchedModerationAllowed, setWatchedModerationAllowed] = useState(false)
  const [moderationPendingIds, setModerationPendingIds] = useState<Set<string>>(new Set())
  const showModerationRail =
    moderationMode &&
    settings?.showModerationRail !== false &&
    (!watchedChannel || watchedModerationAllowed)

  const getChannelSlugForPlatform = useCallback(
    (platform: Platform): string | undefined => {
      if (watchedChannel?.platform === platform) return watchedChannel.channelSlug
      return statuses[platform]?.channelLogin
    },
    [watchedChannel, statuses],
  )

  const moderationPlatform = (platform: Platform): 'twitch' | 'kick' | undefined =>
    platform === 'twitch' || platform === 'kick' ? platform : undefined

  // Refresh the watched-channel moderation capability when the chat's account changes.
  const watchedAccountId = chatAccount?.id
  useEffect(() => {
    let cancelled = false
    const platform = watchedChannel ? moderationPlatform(watchedChannel.platform) : undefined
    if (!watchedChannel || !platform || !watchedAccountId) {
      setWatchedModerationAllowed(false)
      return
    }
    backend.api
      .getModerationCapabilities({ channelSlug: watchedChannel.channelSlug, platform })
      .then((cap) => {
        if (!cancelled) setWatchedModerationAllowed(cap.canModerate)
      })
      .catch(() => {
        if (!cancelled) setWatchedModerationAllowed(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedChannel?.id, watchedChannel?.platform, watchedChannel?.channelSlug, watchedAccountId])

  const onModerate = useCallback(
    async (message: NormalizedChatMessage, action: ModerationDragAction) => {
      const platform = moderationPlatform(message.platform)
      if (!platform) return
      const channelSlug =
        watchedChannel?.channelSlug ?? getChannelSlugForPlatform(platform) ?? message.channelId
      if (!channelSlug) {
        showNotice('error', t('chat.notice.moderationChannelUnknown'), 3500)
        return
      }

      setModerationPendingIds((current) => new Set(current).add(message.id))
      try {
        await backend.api.moderateMessage({
          action: action.action,
          channelSlug,
          messageId: message.id,
          platform,
          targetUserId: message.author.id,
          ...(action.action === 'timeout' ? { durationSeconds: action.durationSeconds } : {}),
        })
        // Mirror the outcome into every open pane via the shared store.
        applyModerationOutcome({
          action: action.action,
          channelId: message.channelId,
          platform,
          ...(action.action === 'delete_message'
            ? { messageId: message.id }
            : {
                targetUserId: message.author.id,
                ...(action.action === 'timeout' ? { durationSeconds: action.durationSeconds } : {}),
              }),
        })
        showNotice('success', action.label, 3500)
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        showNotice('error', text.replace(/^Error:\s*/, ''), 3500)
      } finally {
        setModerationPendingIds((current) => {
          const next = new Set(current)
          next.delete(message.id)
          return next
        })
      }
    },
    [backend, watchedChannel?.channelSlug, getChannelSlugForPlatform, t],
  )
  const handleModeration = useCallback(
    (...args: Parameters<typeof onModerate>) => runUiTask(onModerate(...args)),
    [onModerate],
  )

  // ── Sending (optimistic) ───────────────────────────────────────────────────

  function deliveryErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return message.replace(/^Error:\s*/, '').replace(/^send (Twitch|Kick) message:\s*/i, '')
  }

  function pendingReply(replyToMessageId?: string): NormalizedChatMessage['reply'] {
    if (!replyTarget || replyTarget.id !== replyToMessageId) return undefined
    return {
      parentMessageId: replyTarget.id,
      parentMessageText: replyTarget.text,
      parentAuthor: {
        id: replyTarget.author.id,
        username: replyTarget.author.username ?? replyTarget.author.displayName,
        displayName: replyTarget.author.displayName,
      },
    }
  }

  async function submitDelivery(
    platform: Platform,
    channelId: string,
    text: string,
    replyToMessageId?: string,
    watchedChannelId?: string,
  ): Promise<void> {
    // A chat may send with its own chosen account rather than the platform default.
    const account =
      watchedChannelId && watchedChannel
        ? chatAccount
        : accounts.find((candidate) => candidate.platform === platform)
    if (!account || (platform !== 'twitch' && platform !== 'kick')) {
      console.warn(`[chat] cannot prepare ${platform} optimistic message: no authenticated account`)
      return
    }
    const canonicalChannelId =
      platform === 'kick'
        ? watchedChannelId
          ? (watchedChannelStatus?.channelId ?? channelId)
          : account.platformUserId
        : channelId
    const reply = pendingReply(replyToMessageId)
    const replyTo = reply ?? replyToMessageId
    const message = createPendingMessage({
      account,
      channelId: canonicalChannelId,
      text,
      reply,
      providerMessages,
      scope: activityKey,
    })
    setDeliveryMessages((current) => [...current, message])
    try {
      const receipt = watchedChannelId
        ? await backend.api.sendWatchedChannelMessage({
            id: watchedChannelId,
            text,
            replyTo,
          })
        : await backend.api.sendMessage({ channelId, platform, text, replyTo })
      if (receipt?.held) {
        setDeliveryMessages((current) => current.filter((entry) => entry.id !== message.id))
        if (!account.scopes.includes('user:read:chat'))
          showNotice('info', 'AutoMod held your Twitch message for moderator review.', 6000)
        return
      }
      setDeliveryMessages((current) => confirmDelivery(current, message.id, receipt))
    } catch (error) {
      setDeliveryMessages((current) =>
        failDelivery(current, message.id, deliveryErrorMessage(error)),
      )
    }
  }

  async function onSend(
    targets: {
      platform: Platform
      channelLogin: string
      text: string
      replyToMessageId?: string
    }[],
  ) {
    await Promise.all(
      targets.map((target) =>
        submitDelivery(target.platform, target.channelLogin, target.text, target.replyToMessageId),
      ),
    )
    setReplyTarget(null)
  }

  async function onSendWatched(payload: {
    text: string
    channelId: string
    replyToMessageId?: string
  }) {
    if (!watchedChannel) return
    await submitDelivery(
      watchedChannel.platform,
      watchedChannel.channelSlug,
      payload.text,
      payload.replyToMessageId,
      watchedChannel.id,
    )
    setReplyTarget(null)
  }

  // ── Header data ────────────────────────────────────────────────────────────

  const allChannels = useMemo(() => ownChatSendTargets(accounts), [accounts])
  const chattersTargets = useMemo(
    () => buildChattersTargets(watchedChannel, allChannels),
    [watchedChannel, allChannels],
  )

  const displayedChannels = allChannels.map((ch) => {
    const stored = streamStatuses.get(`${ch.platform}:${ch.channelLogin.toLowerCase()}`)
    return (
      stored ?? {
        channelLogin: ch.channelLogin,
        isLive: false,
        platform: ch.platform,
        title: '',
      }
    )
  })

  const watchedStreamStatus =
    watchedChannel && watchedChannel.platform !== 'youtube'
      ? streamStatuses.get(`${watchedChannel.platform}:${watchedChannel.channelSlug.toLowerCase()}`)
      : undefined

  const hasAnyConnection =
    pluginFeed.channels.length > 0 ||
    (['twitch', 'youtube', 'kick'] satisfies Platform[]).some(
      (platform) => statuses[platform]?.status === 'connected',
    )

  const activePane = useStoreSelector(activePaneByWindowStore, (entries) => entries.get(scope))
  const paneLayout = useStoreSelector(layoutStore, (entries) => entries.get(layoutTabId)?.layout)
  const paneIdentity = paneId ?? 'home'
  const splitContextId = `split:${paneIdentity}`
  useEffect(() => {
    const panels = allPanels(paneLayout ?? null)
    const current = getActivePane(scope)
    if (
      current?.tabId === layoutTabId &&
      panels.some((panel) => `${layoutTabId}:${panel.id}` === current.paneId)
    )
      return
    if (!panels.length || panels[0]?.id === layoutPanelId)
      setActivePane({ tabId: layoutTabId, paneId: paneIdentity }, scope)
  }, [scope, layoutTabId, layoutPanelId, paneIdentity, paneLayout])
  const actionTarget = watchedChannel
    ? { platform: watchedChannel.platform, channelSlug: watchedChannel.channelSlug }
    : allChannels.find((channel) => channel.platform === activePlatform)
      ? {
          platform: activePlatform!,
          channelSlug: allChannels.find((channel) => channel.platform === activePlatform)!
            .channelLogin,
        }
      : allChannels[0]
        ? { platform: allChannels[0].platform, channelSlug: allChannels[0].channelLogin }
        : undefined
  const setEnabledArgument = (argument: string | undefined, enabled: boolean) =>
    argument === 'on' ? true : argument === 'off' ? false : !enabled
  const openTargetUrl = (url: string | undefined) => {
    if (!url) throw new Error(t('chat.error.noPublicUrl'))
    return backend.api.openExternalUrl({ url })
  }
  useHotkeyContext({
    id: splitContextId,
    category: 'split',
    handlers: {
      cancelReply: replyTarget ? () => setReplyTarget(null) : null,
      changeChannel: onChangeChannel ?? null,
      clearMessages,
      createClip:
        actionTarget?.platform === 'twitch'
          ? async () => {
              const result = await backend.api.executePlatformCommand({
                ...actionTarget,
                text: '/clip',
              })
              if (result.message) showNotice('info', result.message, 6000)
            }
          : null,
      delete:
        layoutTabId !== 'home' || (paneLayout && allPanels(paneLayout).length > 1)
          ? async () => {
              if (
                windows?.descriptor.kind !== 'main' &&
                paneLayout &&
                allPanels(paneLayout).length === 1
              )
                await windows?.close()
              else onClosePanel?.()
            }
          : null,
      openInBrowser: actionTarget
        ? () => openTargetUrl(publicChannelURL(actionTarget.platform, actionTarget.channelSlug))
        : null,
      openPlayerInBrowser: actionTarget
        ? () => backend.api.openChannelPlayer({ ...actionTarget, mode: 'browser' })
        : null,
      openInCustomPlayer: actionTarget
        ? () => backend.api.openChannelPlayer({ ...actionTarget, mode: 'custom' })
        : null,
      openInStreamlink: actionTarget
        ? () => backend.api.openChannelPlayer({ ...actionTarget, mode: 'streamlink' })
        : null,
      openModView:
        actionTarget?.platform === 'twitch'
          ? () =>
              openTargetUrl(
                `https://www.twitch.tv/moderator/${encodeURIComponent(actionTarget.channelSlug)}`,
              )
          : null,
      openRewardQueue: twitchChannel
        ? () => {
            setActivitiesTab('queue')
            setActivitiesOpen(true)
          }
        : null,
      openUnbanRequests:
        actionTarget?.platform === 'twitch'
          ? () =>
              openTargetUrl(
                `https://www.twitch.tv/popout/moderator/${encodeURIComponent(actionTarget.channelSlug)}/unban-requests`,
              )
          : null,
      openViewerList: chattersTargets.length ? () => setChattersOpen(true) : null,
      pickFilters: () => setFiltersOpen(true),
      reconnect: watchedChannel
        ? () => backend.api.reconnectChat({ watchedChannelId: watchedChannel.id })
        : () => backend.api.reconnectChat({}),
      scrollToBottom: () => {
        changePause(false)
        scrollToLatest()
      },
      scrollToTop: () => {
        changePause(true)
        if (listRef.current) renderer.scrollToItem?.(listRef.current.id, 0)
      },
      showSearch: () => openSearch(),
      showGlobalSearch: () => invokeHotkeyUiAction('openAllChatSearch', scope),
      debug: () => setDiagnosticsOpen(true),
      popupOverlay: windows ? () => windows.openChat(layoutTabId, layoutPanelId, true) : null,
      openSubscriptionPage: twitchChannel
        ? () => openTargetUrl(`https://www.twitch.tv/subs/${encodeURIComponent(twitchChannel)}`)
        : null,
      focus: layoutPanelId
        ? ([direction]) => {
            focusLayoutPanel(
              backend,
              layoutTabId,
              layoutPanelId,
              parseHotkeyChoice(direction, ['left', 'right', 'up', 'above', 'down', 'below']),
              scope,
            )
          }
        : null,
      reloadEmotes: actionTarget
        ? ([kind]) =>
            backend.api.reloadChatEmotes({
              ...actionTarget,
              kind:
                kind === undefined ? undefined : parseHotkeyChoice(kind, ['channel', 'subscriber']),
            })
        : null,
      runCommand: async ([text]) => {
        if (!commandRunner.current) throw new Error(t('chat.error.composerNotReady'))
        await commandRunner.current(text!)
      },
      scrollPage: ([direction]) => {
        if (!listRef.current) return
        const id = listRef.current.id
        const anchor = renderer.getListScrollTop?.(id)
        const height = nativeWindow(renderer).getPaintedElementBounds(id)?.height ?? anchor?.[2]
        if (!anchor || !height) return
        changePause(true)
        renderer.scrollToItem?.(
          id,
          anchor[0] ?? 0,
          (anchor[1] ?? 0) + (direction === 'up' ? -height : height),
        )
      },
      setChannelNotification: actionTarget
        ? async ([argument]) => {
            await notificationPreferences.load(backend.api)
            const value = notificationPreferences.store.get().value
            const key = `${actionTarget.platform}:${actionTarget.channelSlug.toLowerCase()}`
            const enabled = !value.mutedChannels.includes(key)
            const next = setEnabledArgument(argument, enabled)
            await notificationPreferences.save(backend.api, {
              ...value,
              mutedChannels: next
                ? value.mutedChannels.filter((entry) => entry !== key)
                : [...new Set([...value.mutedChannels, key])],
            })
          }
        : null,
      setModerationMode: ([argument]) =>
        setModerationMode((value) => setEnabledArgument(argument, value)),
      toggleOverlayInertia: windows
        ? ([target]) =>
            windows.toggleOverlayInertia(parseHotkeyChoice(target, ['this', 'thisOrAll', 'all']))
        : null,
      setHighlightSounds: async ([argument]) => {
        await notificationPreferences.load(backend.api)
        const value = notificationPreferences.store.get().value
        await notificationPreferences.save(backend.api, {
          ...value,
          soundEnabled: setEnabledArgument(argument, value.soundEnabled),
        })
      },
      changeMultichannelContext:
        !watchedChannel && allChannels.length > 1
          ? ([argument]) => {
              updateComposer(paneKey, (current) => {
                const index = allChannels.findIndex(
                  (channel) => channel.platform === current.activePlatform,
                )
                const target =
                  argument === 'next'
                    ? (index + 1) % allChannels.length
                    : argument === 'prev'
                      ? (index - 1 + allChannels.length) % allChannels.length
                      : Number(argument)
                const channel = allChannels[target]
                return channel ? { ...current, activePlatform: channel.platform } : current
              })
            }
          : null,
    },
  })
  useHotkeyRoute(
    [splitContextId, 'window'],
    activePane?.tabId === layoutTabId && activePane.paneId === paneIdentity,
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      testId="chat-pane"
      onMouseDown={() => setActivePane({ tabId: layoutTabId, paneId: paneIdentity }, scope)}
      onKeyDown={(event) => {
        if (dispatchCustomHotkey(event, scope)) return
        if (
          event.modifiers?.ctrl &&
          !event.modifiers.alt &&
          !event.modifiers.shift &&
          event.key === 'f'
        ) {
          event.preventDefault()
          openSearch()
        }
      }}
      style={{
        flexGrow: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div
        testId="chat-header"
        style={{
          backgroundColor: flash
            ? withAlpha(flash.color?.slice(0, 7) ?? theme.accent.primary, 0.22)
            : undefined,
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 12,
          paddingRight: 12,
          borderBottomWidth: 1,
          borderColor: theme.border,
          flexShrink: 0,
          minHeight: 44,
          userSelect: 'none',
        }}
      >
        {headerLeading}
        {watchedChannel ? (
          <>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                flexShrink: 0,
                backgroundColor:
                  watchedChannelStatus?.status === 'connected'
                    ? '#22c55e'
                    : watchedChannelStatus?.status === 'connecting'
                      ? '#f59e0b'
                      : theme.text2,
              }}
            />
            <PlatformIcon platform={watchedChannel.platform} size={14} />
            <Text
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: theme.text2,
                // The channel name wins over the stream title/category,
                // which absorb the squeeze in narrow split panes.
                maxWidth: 160,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {watchedChannel.displayName.toUpperCase()}
            </Text>
            {watchedStreamStatus?.isLive ? (
              <>
                {watchedStreamStatus.viewerCount !== undefined &&
                !(
                  streamerMode.effectiveEnabled && streamerMode.settings.hideViewerCountAndDuration
                ) ? (
                  <Text style={{ fontSize: 11, fontWeight: 600, color: '#22c55e', flexShrink: 0 }}>
                    {formatViewers(watchedStreamStatus.viewerCount)}
                  </Text>
                ) : null}
                {watchedStreamStatus.categoryName ? (
                  <Text
                    style={{
                      fontSize: 11,
                      color: theme.text2,
                      minWidth: 0,
                      flexShrink: 1,
                      maxWidth: 100,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {watchedStreamStatus.categoryName}
                  </Text>
                ) : null}
                {watchedStreamStatus.title ? (
                  <Text
                    style={{
                      fontSize: 11,
                      color: theme.text2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flexGrow: 1,
                      minWidth: 0,
                    }}
                  >
                    {watchedStreamStatus.title}
                  </Text>
                ) : null}
              </>
            ) : null}
            {/* Authenticated is the normal state — only flag read-only. */}
            {watchedChannelStatus && watchedChannelStatus.mode !== 'authenticated' ? (
              <div
                style={{
                  borderRadius: 10,
                  paddingTop: 2,
                  paddingBottom: 2,
                  paddingLeft: 7,
                  paddingRight: 7,
                  borderWidth: 1,
                  flexShrink: 0,
                  borderColor: theme.border,
                }}
              >
                <Text style={{ fontSize: 11, color: theme.text2 }}>
                  {t('chat.header.readOnly')}
                </Text>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <Text
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: theme.text2,
                flexShrink: 0,
              }}
            >
              {t('chat.header.liveChat').toUpperCase()}
            </Text>
            {displayedChannels.length > 0 || pluginFeed.channels.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  flexGrow: 1,
                  minWidth: 0,
                  overflowX: 'scroll',
                }}
              >
                {displayedChannels.map((ch) => (
                  <HeaderChannelChip key={`${ch.platform}:${ch.channelLogin}`} channel={ch} />
                ))}
                {pluginFeed.channels.map((channel) => (
                  <div
                    key={channel.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      flexShrink: 0,
                      paddingLeft: 8,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: theme.hairline,
                      backgroundColor: theme.fill,
                    }}
                  >
                    <Text style={{ fontSize: 12, color: theme.text2 }}>
                      {`${channel.transportName} · ${channel.displayName}`}
                    </Text>
                    <HeaderButton
                      testId={`home-plugin-remove-${channel.id}`}
                      title={t('chat.header.removePluginChannel', {
                        name: channel.displayName,
                      })}
                      onClick={() =>
                        runUiTask(setHomePluginChannel(backend.api, channel.id, false))
                      }
                    >
                      <Icon name="close" size={12} color={theme.text2} />
                    </HeaderButton>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}

        {/* Right side */}
        <div style={{ flexGrow: 1 }} />
        <div
          testId="chat-header-actions"
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 2,
            maxWidth: '100%',
            minWidth: 0,
          }}
        >
          <MessageRate activityKey={activityKey} />
          <HeaderButton
            testId="chat-history-button"
            title={t('chat.tooltip.searchHistory')}
            onClick={() => setHistoryOpen(true)}
          >
            <Icon name="clock" size={14} color={theme.text2} />
          </HeaderButton>
          {twitchChannel ? (
            <HeaderButton
              testId="twitch-activities-button"
              title={t('chat.tooltip.activities')}
              onClick={() => setActivitiesOpen(true)}
            >
              <Icon name="globe" size={14} color={theme.text2} />
            </HeaderButton>
          ) : null}
          <HeaderButton
            testId="chat-filters-button"
            title={t('chat.tooltip.filters')}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            <Icon
              name="sliders"
              size={14}
              color={rules.paneFilters[paneKey]?.length ? theme.accent.primary : theme.text2}
            />
          </HeaderButton>
          <HeaderButton
            testId="chat-search-button"
            title={t('chat.tooltip.searchMessages')}
            onClick={() => openSearch()}
          >
            <Icon name="search" size={14} color={searchOpen ? theme.accent.primary : theme.text2} />
          </HeaderButton>
          <HeaderButton
            testId="chat-mentions-button"
            title={t('chat.tooltip.mentions')}
            onClick={() => setMentionsOnly((value) => !value)}
          >
            <Icon name="bell" size={14} color={mentionsOnly ? theme.accent.primary : theme.text2} />
          </HeaderButton>
          <HeaderButton
            testId="chat-pause-button"
            title={paused ? t('chat.tooltip.resume') : t('chat.tooltip.pause')}
            onClick={() => changePause(!paused)}
          >
            <Icon
              name={paused ? 'play' : 'pause'}
              size={14}
              color={paused ? theme.accent.primary : theme.text2}
            />
          </HeaderButton>

          {chattersTargets.length > 0 ? (
            <HeaderButton testId="chatters-button" onClick={() => setChattersOpen(true)}>
              <Icon name="users" size={14} color={theme.text2} />
            </HeaderButton>
          ) : null}

          {settings ? <ChatAppearanceDialog settings={settings} /> : null}

          {onSplitRight || onClosePanel || windows ? (
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'row', gap: 2 }}>
              <HeaderButton testId="split-right" onClick={() => onSplitRight?.()}>
                <Icon name="plus" size={14} color={theme.text2} />
              </HeaderButton>
              <HeaderButton
                testId="panel-menu"
                onClick={() => {
                  if (Date.now() - menuDismissedAt.current < 250) return
                  setMenuOpen((open) => !open)
                }}
              >
                <Icon name="moreVertical" size={14} color={theme.text2} />
              </HeaderButton>
              {menuOpen ? (
                <anchored deferred side="bottom" align="end" gap={4}>
                  <div
                    onMouseDownOutside={() => {
                      menuDismissedAt.current = Date.now()
                      setMenuOpen(false)
                    }}
                    style={{
                      backgroundColor: theme.surface,
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 8,
                      padding: 4,
                      minWidth: 180,
                      display: 'flex',
                      flexDirection: 'column',
                      boxShadow: {
                        offsetX: 0,
                        offsetY: 4,
                        blurRadius: 12,
                        spreadRadius: 0,
                        color: '#00000066',
                      },
                    }}
                  >
                    {onChangeChannel ? (
                      <MenuItem
                        icon="refresh"
                        label={t('chat.menu.changeChannel')}
                        onClick={() => {
                          setMenuOpen(false)
                          onChangeChannel?.()
                        }}
                      />
                    ) : null}
                    {windows ? (
                      <>
                        <MenuItem
                          icon="externalLink"
                          label={t('chat.menu.openWindow')}
                          onClick={() => {
                            setMenuOpen(false)
                            void windows
                              .openChat(layoutTabId, layoutPanelId)
                              .catch((error) => showNotice('error', String(error)))
                          }}
                        />
                        <MenuItem
                          icon="externalLink"
                          label={t('chat.menu.openOverlay')}
                          onClick={() => {
                            setMenuOpen(false)
                            void windows
                              .openChat(layoutTabId, layoutPanelId, true)
                              .catch((error) => showNotice('error', String(error)))
                          }}
                        />
                      </>
                    ) : null}
                    {onChangeChannel || windows ? (
                      <div
                        style={{
                          height: 1,
                          backgroundColor: theme.border,
                          marginTop: 4,
                          marginBottom: 4,
                        }}
                      />
                    ) : null}
                    {layoutTabId !== 'home' || (paneLayout && allPanels(paneLayout).length > 1) ? (
                      <MenuItem
                        icon="close"
                        label={t('chat.menu.closePanel')}
                        danger
                        onClick={() => {
                          setMenuOpen(false)
                          if (
                            windows?.descriptor.kind !== 'main' &&
                            paneLayout &&
                            allPanels(paneLayout).length === 1
                          )
                            void windows
                              ?.close()
                              .catch((error) => showNotice('error', String(error)))
                          else onClosePanel?.()
                        }}
                      />
                    ) : null}
                  </div>
                </anchored>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {room &&
      (room.slowSeconds ||
        (room.followersOnlyMinutes !== undefined && room.followersOnlyMinutes !== null) ||
        room.subscribersOnly ||
        room.emoteOnly ||
        room.uniqueChat) ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 5,
            paddingBottom: 5,
            backgroundColor: theme.surface,
            borderBottomWidth: 1,
            borderColor: theme.border,
          }}
        >
          {room.slowSeconds ? (
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              {t('chat.room.slow', { seconds: room.slowSeconds })}
            </Text>
          ) : null}
          {room.followersOnlyMinutes !== undefined && room.followersOnlyMinutes !== null ? (
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              {t('chat.room.followers', { minutes: room.followersOnlyMinutes })}
            </Text>
          ) : null}
          {room.subscribersOnly ? (
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              {t('chat.room.subscribersOnly')}
            </Text>
          ) : null}
          {room.emoteOnly ? (
            <Text style={{ fontSize: 11, color: theme.text2 }}>{t('chat.room.emoteOnly')}</Text>
          ) : null}
          {room.uniqueChat ? (
            <Text style={{ fontSize: 11, color: theme.text2 }}>{t('chat.room.uniqueChat')}</Text>
          ) : null}
        </div>
      ) : null}
      {pinnedMessage || activePolls?.length || visiblePredictions?.length ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            backgroundColor: theme.surface,
            borderBottomWidth: 1,
            borderColor: theme.border,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 0,
            }}
          >
            {pinnedMessage ? (
              <div
                onClick={() => setActivitiesOpen(true)}
                style={{ padding: 8, cursor: 'pointer' }}
              >
                <Text style={{ fontSize: 12, color: theme.text }}>
                  {t('chat.banner.pinned', {
                    author: pinnedMessage.authorName ?? '',
                    text: pinnedMessage.text,
                  })}
                </Text>
              </div>
            ) : null}
            {activePolls?.map((poll) => (
              <div
                key={poll.id}
                onClick={() => setActivitiesOpen(true)}
                style={{ padding: 8, cursor: 'pointer' }}
              >
                <Text style={{ fontSize: 12, color: theme.text }}>
                  {tPlural(
                    'chat.banner.poll',
                    poll.choices.reduce((total, choice) => total + choice.votes, 0),
                    {
                      title: poll.title,
                    },
                  )}
                </Text>
              </div>
            ))}
            {visiblePredictions?.map((prediction) => (
              <div
                key={prediction.id}
                onClick={() => setActivitiesOpen(true)}
                style={{ padding: 8, cursor: 'pointer' }}
              >
                <Text style={{ fontSize: 12, color: theme.text }}>
                  {t('chat.banner.prediction', {
                    title: prediction.title,
                    status: prediction.status,
                  })}
                </Text>
              </div>
            ))}
          </div>
          <div style={{ paddingTop: 4, paddingRight: 4, flexShrink: 0 }}>
            <HeaderButton
              title={t('chat.banner.hide')}
              testId="hide-activity-banners"
              onClick={() => setBannersHidden(true)}
            >
              <Icon name="close" size={13} color={theme.text2} />
            </HeaderButton>
          </div>
        </div>
      ) : null}
      {bannersHidden ? (
        <Text
          onClick={() => setBannersHidden(false)}
          style={{ fontSize: 11, color: theme.link, padding: 6, cursor: 'pointer' }}
        >
          {t('chat.banner.restore')}
        </Text>
      ) : null}
      {filtersOpen ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            padding: 10,
            flexShrink: 0,
            maxHeight: 220,
            overflowY: 'scroll',
            backgroundColor: theme.surface,
            borderBottomWidth: 1,
            borderColor: theme.border,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 12, color: theme.text, flexGrow: 1 }}>
              {t('chat.filters.title')}
            </Text>
            <HeaderButton title={t('chat.filters.close')} onClick={() => setFiltersOpen(false)}>
              <Icon name="close" size={13} color={theme.text2} />
            </HeaderButton>
          </div>
          {rules.filters.map((filter) => (
            <div
              key={filter.id}
              style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <Text style={{ fontSize: 12, color: theme.text, flexGrow: 1 }}>{filter.name}</Text>
              <Switch
                checked={(rules.paneFilters[paneKey] ?? []).includes(filter.id)}
                onChange={(enabled) => selectFilter(filter.id, enabled)}
              />
            </div>
          ))}
          <Text
            onClick={() => activeTabStore.set('settings')}
            style={{ fontSize: 12, color: theme.link, cursor: 'pointer' }}
          >
            {rules.filters.length ? t('chat.filters.edit') : t('chat.filters.create')}
          </Text>
        </div>
      ) : null}
      {searchOpen ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            padding: 8,
            borderBottomWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              ref={searchRef}
              testId="chat-search"
              autoFocus
              value={searchQuery}
              placeholder={t('chat.search.placeholder')}
              {...searchFocus}
              onChange={(event) => setSearchQuery(event.value ?? '')}
              onKeyDown={(event) => {
                if (event.key === 'escape') {
                  event.preventDefault()
                  closeSearch()
                }
              }}
              theme={{ caret: theme.accent.primary }}
              style={{
                flexGrow: 1,
                minWidth: 0,
                fontSize: 12,
                color: theme.text,
                backgroundColor: theme.surface2,
                borderRadius: 5,
                padding: 6,
              }}
            />
            <Text
              testId="chat-search-count"
              style={{ fontSize: 11, color: theme.text2, flexShrink: 0 }}
            >
              {`${displayedTimeline.length} / ${readingMessages.length + readingPluginRows.length}`}
            </Text>
            <HeaderButton
              testId="chat-search-close"
              title={t('chat.search.close')}
              onClick={closeSearch}
            >
              <Icon name="close" size={14} color={theme.text2} />
            </HeaderButton>
          </div>
          <Text style={{ fontSize: 11, color: search.error ? theme.warningText : theme.text2 }}>
            {search.error ?? t('chat.search.help')}
          </Text>
        </div>
      ) : null}
      {mentionsOnly ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            padding: 8,
            backgroundColor: theme.surface,
            borderBottomWidth: 1,
            borderColor: theme.border,
            flexShrink: 0,
          }}
        >
          <Text style={{ fontSize: 12, color: theme.text, flexGrow: 1 }}>
            {t('chat.mentions.title', { count: mentionsCount })}
          </Text>
          <HeaderButton title={t('chat.mentions.showAll')} onClick={() => setMentionsOnly(false)}>
            <Icon name="close" size={13} color={theme.text2} />
          </HeaderButton>
        </div>
      ) : null}

      {/* Messages + scroll pill */}
      {revealedMessageKey ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            padding: 8,
            backgroundColor: theme.surface,
            borderBottomWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Text style={{ fontSize: 12, color: theme.text2, flexGrow: 1 }}>
            {t('chat.reveal.title')}
          </Text>
          <Text
            onClick={() => changePause(false)}
            style={{ fontSize: 12, color: theme.link, cursor: 'pointer' }}
          >
            {t('chat.reveal.return')}
          </Text>
        </div>
      ) : null}
      <div
        testId="chat-messages"
        onMouseMove={(event) => {
          updateWindowActivity(scope, windowActivity?.active ?? true, event.modifiers)
          if (pausePreferences.hoverSeconds !== 0)
            pauseController.add('mouse', hoverPauseDurationMs(pausePreferences.hoverSeconds))
        }}
        onMouseLeave={() => pauseController.remove('mouse')}
        style={{
          flexGrow: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {displayedTimeline.length > 0 ? (
          <virtual-list
            ref={listRef}
            alignment="bottom"
            followTail={!paused}
            estimatedItemHeight={56}
            onVisibleRange={(event) => {
              const end = event.endIndex ?? 0
              const start = event.startIndex ?? 0
              setVisibleRange((current) =>
                current?.start === start && current.end === end ? current : { start, end },
              )
              setAtBottom(end >= renderedTimeline.length)
            }}
            style={{
              flexGrow: 1,
              minHeight: 0,
              scrollbarColor: theme.scrollbar,
              scrollbarWidth: 5,
            }}
          >
            {renderedTimeline.map((message, index) => {
              if ('message' in message) {
                return (
                  <PluginChatRow
                    key={message.key}
                    message={message.message}
                    source={
                      pluginFeed.channels.length > 1
                        ? `${message.channel.transportName} · ${message.channel.displayName}`
                        : message.channel.transportName
                    }
                    fontSize={settings?.fontSize}
                    showTimestamp={settings?.showTimestamp}
                    chatTheme={settings?.chatTheme}
                  />
                )
              }
              const key = chatMessageKey(message)
              const revealed = revealedMessageKey === key
              const outcome = moderationView.outcomeFor(message)
              const classification = ruleEngine.classify(message)
              return (
                <ChatMessageRow
                  key={key}
                  gray={similarityReader.get(message)?.gray ?? false}
                  revealedColor={revealed ? theme.accent.primary : undefined}
                  onPauseDoubleClick={
                    pausePreferences.doubleClickLinks && !classification.hidden
                      ? pauseForDoubleClick
                      : undefined
                  }
                  visible={
                    visibleRange
                      ? index >= visibleRange.start - 4 && index < visibleRange.end + 4
                      : index >= renderedTimeline.length - 32
                  }
                  message={revealed ? message : classification.message}
                  hiddenLabel={
                    classification.hidden && !revealed ? t('chat.message.hidden') : undefined
                  }
                  channelSlug={getChannelSlugForPlatform(message.platform)}
                  alias={aliasMap.get(`${message.platform}:${message.author.id}`)}
                  showPlatformColorStripe={
                    watchedChannel ? false : settings?.showPlatformColorStripe
                  }
                  showPlatformIcon={watchedChannel ? false : settings?.showPlatformIcon}
                  showTimestamp={settings?.showTimestamp}
                  showAvatar={settings?.showAvatars}
                  showBadges={settings?.showBadges}
                  fontSize={settings?.fontSize}
                  chatTheme={settings?.chatTheme}
                  accounts={ownAccounts}
                  selfPingEnabled={settings?.selfPing?.enabled}
                  selfPingColor={
                    classification.color
                      ? classification.color.length === 7
                        ? withAlpha(classification.color, 0.16)
                        : classification.color
                      : settings?.selfPing?.color
                  }
                  highlighted={
                    classification.highlighted &&
                    (classification.rules.length > 0 ||
                      message.metadata?.highlighted === true ||
                      settings?.selfPing?.enabled === true)
                  }
                  moderationOutcome={outcome}
                  onOpenUserCard={setUserCardTarget}
                  onReply={setReplyTarget}
                  onSearch={openSearch}
                  canModerate={showModerationRail}
                  moderationPending={moderationPendingIds.has(message.id)}
                  onModerate={handleModeration}
                />
              )
            })}
          </virtual-list>
        ) : filtered || clearedKeys.size > 0 || paused ? (
          <div
            style={{
              flexGrow: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
          >
            <Text style={{ fontSize: 13, color: theme.text2 }}>
              {filtered
                ? t('chat.empty.noMatch')
                : paused
                  ? t('chat.empty.paused')
                  : t('chat.empty.cleared')}
            </Text>
          </div>
        ) : (
          <EmptyState
            watchedChannel={watchedChannel}
            watchedChannelStatus={watchedChannelStatus}
            accounts={accounts}
            hasAnyConnection={hasAnyConnection}
            onGoToPlatforms={onGoToPlatforms}
          />
        )}

        {/* Scroll-to-latest pill */}
        {paused || (!atBottom && displayedTimeline.length > 0) ? (
          <div
            style={{
              position: 'absolute',
              bottom: 14,
              left: 0,
              right: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              testId="scroll-to-latest"
              onClick={() => (paused ? changePause(false) : scrollToLatest())}
              style={{
                pointerEvents: 'auto',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: theme.popover,
                borderWidth: 1,
                borderColor: theme.dialogBorder,
                borderRadius: 20,
                paddingTop: 6,
                paddingBottom: 6,
                paddingLeft: 14,
                paddingRight: 14,
                cursor: 'pointer',
                hover: { backgroundColor: theme.surface2 },
              }}
            >
              <Icon name="chevronDown" size={14} color={theme.text} />
              <Text style={{ fontSize: 12, fontWeight: 500, color: theme.text }}>
                {paused
                  ? pendingCount
                    ? t('chat.pill.resumeNew', { count: pendingCount })
                    : t('chat.pill.resume')
                  : t('chat.pill.scrollLatest')}
              </Text>
            </div>
          </div>
        ) : null}
      </div>

      {/* Composer */}
      {twitchChannel && !(streamerMode.effectiveEnabled && streamerMode.settings.hideModActions) ? (
        <TwitchAutoMod
          channelSlug={twitchChannel}
          hideBlockedTerms={
            streamerMode.effectiveEnabled && streamerMode.settings.hideBlockedTermText
          }
        />
      ) : null}
      {settings ? (
        <ChatInput
          hotkeyContextId={`input:${paneKey}`}
          hotkeyParentContextIds={[splitContextId, 'window']}
          onCommandRunnerReady={(runner) => {
            commandRunner.current = runner
          }}
          composerKey={paneKey}
          accounts={accounts}
          settings={settings}
          statuses={statuses}
          watchedChannel={watchedChannel}
          watchedChannelStatus={watchedChannelStatus}
          replyTarget={replyTarget}
          messages={providerMessages}
          onCancelReply={() => setReplyTarget(null)}
          onOpenUserCard={setUserCardTarget}
          onSend={(targets) => void onSend(targets)}
          onSendWatched={(payload) => void onSendWatched(payload)}
          onClearMessages={clearMessages}
          onCopyMessages={copyMessages}
          onPauseChange={changePause}
          onToggleMentions={() => setMentionsOnly((value) => !value)}
          onSearch={openSearch}
          onPlatformCommand={async (text, target) => {
            const result = await backend.api.executePlatformCommand({
              platform: target.platform,
              channelSlug: target.channelSlug,
              text,
            })
            if (result.message) showNotice('info', result.message, 6000)
          }}
        />
      ) : null}

      {/* Dialogs */}
      {diagnosticsOpen ? (
        <Modal width={620} onClose={() => setDiagnosticsOpen(false)}>
          <div
            style={{
              padding: 16,
              maxHeight: 600,
              overflow: 'scroll',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <Text style={{ color: theme.text, fontWeight: 600 }}>
              {t('chat.diagnostics.title')}
            </Text>
            <Text style={{ color: theme.text2, fontSize: 12 }}>
              {JSON.stringify(
                {
                  window: scope,
                  tab: layoutTabId,
                  panel: layoutPanelId,
                  channel: actionTarget,
                  received: activeMessages.length + pluginFeed.rows.length,
                  shown: displayedTimeline.length,
                  paused: !!paused,
                  visibleRange,
                  status: watchedChannelStatus ?? statuses,
                },
                null,
                2,
              )}
            </Text>
          </div>
        </Modal>
      ) : null}
      {historyOpen ? (
        <ChatHistoryPanel
          channel={
            watchedChannel
              ? {
                  platform: watchedChannel.platform,
                  channelId: watchedChannel.channelSlug,
                  displayName: watchedChannel.displayName,
                }
              : undefined
          }
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
      {activitiesOpen && twitchChannel ? (
        <TwitchActivitiesPanel
          channelSlug={twitchChannel}
          initialTab={activitiesTab}
          onClose={() => setActivitiesOpen(false)}
        />
      ) : null}
      {chattersOpen && chattersTargets.length > 0 ? (
        <ChattersDialog targets={chattersTargets} onClose={() => setChattersOpen(false)} />
      ) : null}
      {userCardTarget ? (
        <UserCardDialog
          target={userCardTarget}
          currentAlias={
            aliases.find(
              (a) =>
                a.platform === userCardTarget.platform &&
                a.platformUserId === userCardTarget.platformUserId,
            )?.alias ?? userCardTarget.currentAlias
          }
          onClose={() => setUserCardTarget(null)}
        />
      ) : null}
    </div>
  )
}

function HeaderButton({
  children,
  onClick,
  testId,
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  testId?: string
  title?: string
}) {
  const theme = useTheme()
  const [hovered, setHovered] = useState(false)
  const button = (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 22,
        height: 24,
        flexShrink: 0,
        borderRadius: 4,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hovered ? theme.fillHover : undefined,
      }}
    >
      {/* re-tint the icon on hover by cloning with a different color is the
          caller's concern; icons here read text2 which is close enough to
          the Vue hover target (theme.text) */}
      {children}
    </div>
  )
  return title ? (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        style={{ backgroundColor: theme.popover, color: theme.text, padding: 7, borderRadius: 5 }}
      >
        <Text style={{ fontSize: 12, color: theme.text }}>{title}</Text>
      </TooltipContent>
    </Tooltip>
  ) : (
    button
  )
}

/** The one-second clock only repaints the tiny rate indicator. */
const MessageRate = memo(function MessageRate({ activityKey }: { activityKey: string }) {
  const theme = useTheme()
  const { t } = useT()
  const activity = useStoreSelector(chatActivityStore, (entries) => entries.get(activityKey))
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <Text testId="chat-message-rate" style={{ fontSize: 11, color: theme.text2, flexShrink: 0 }}>
      {t('chat.rate', { rate: chatMessageRate(activity, now).toFixed(1) })}
    </Text>
  )
})

function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: IconName
  label: string
  danger?: boolean
  onClick?: () => void
}) {
  const theme = useTheme()
  const color = danger ? theme.dangerText : theme.text
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingTop: 7,
        paddingBottom: 7,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 5,
        cursor: 'pointer',
        hover: { backgroundColor: danger ? 'rgba(239, 68, 68, 0.15)' : theme.navHover },
      }}
    >
      <Icon name={icon} size={14} color={danger ? color : theme.text2} />
      <Text style={{ fontSize: 13, color }}>{label}</Text>
    </div>
  )
}

function EmptyState({
  watchedChannel,
  watchedChannelStatus,
  accounts,
  hasAnyConnection,
  onGoToPlatforms,
}: {
  watchedChannel?: WatchedChannel | null
  watchedChannelStatus?: PlatformStatusInfo | null
  accounts: Account[]
  hasAnyConnection: boolean
  onGoToPlatforms?: () => void
}) {
  const theme = useTheme()
  const { t } = useT()

  return (
    <div
      style={{
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 32,
      }}
    >
      <div style={{ opacity: 0.35, marginBottom: 4 }}>
        <Icon name="chat" size={48} color={theme.text2} />
      </div>

      {watchedChannel ? (
        <>
          <Text style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
            {watchedChannelStatus?.status === 'connecting'
              ? t('chat.empty.connecting')
              : watchedChannelStatus?.status === 'connected'
                ? t('chat.empty.noMessages')
                : watchedChannelStatus?.status === 'error'
                  ? t('chat.empty.connectionFailed')
                  : t('chat.empty.waitingConnection')}
          </Text>
          <Text
            style={{
              fontSize: 13,
              color: theme.text2,
              maxWidth: 280,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            {watchedChannelStatus?.status === 'error'
              ? watchedChannelStatus.error || t('chat.empty.unknownError')
              : t('chat.empty.channelMessages', { name: watchedChannel.displayName })}
          </Text>
        </>
      ) : accounts.length === 0 && !hasAnyConnection ? (
        <>
          <Text style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
            {t('chat.empty.noAccounts')}
          </Text>
          <Text
            style={{
              fontSize: 13,
              color: theme.text2,
              maxWidth: 280,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            {t('chat.empty.connectAccounts')}
          </Text>
          <div
            testId="go-to-platforms"
            onClick={onGoToPlatforms}
            style={{
              marginTop: 4,
              backgroundColor: theme.accent.tint15,
              borderWidth: 1,
              borderColor: theme.accent.tint45,
              borderRadius: 8,
              paddingTop: 7,
              paddingBottom: 7,
              paddingLeft: 16,
              paddingRight: 16,
              cursor: 'pointer',
              hover: { backgroundColor: theme.accent.tint25 },
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: 600, color: theme.accent.primary }}>
              {t('chat.empty.goToPlatforms')}
            </Text>
          </div>
        </>
      ) : !hasAnyConnection ? (
        <>
          <Text style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
            {t('chat.empty.waitingConnection')}
          </Text>
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 8,
              marginTop: 4,
            }}
          >
            {accounts.map((acc) => (
              <div
                key={acc.id}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: theme.fill,
                  borderWidth: 1,
                  borderColor: theme.hairline,
                  borderRadius: 24,
                  paddingTop: 4,
                  paddingBottom: 4,
                  paddingLeft: 4,
                  paddingRight: 10,
                }}
              >
                {acc.avatarUrl ? (
                  <RemoteImage
                    url={acc.avatarUrl}
                    thumbnailSize={22}
                    objectFit="cover"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      borderWidth: 2,
                      borderColor: platformColor(acc.platform),
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: platformColor(acc.platform),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: 700, color: '#ffffff' }}>
                      {initialsOf(acc.displayName)}
                    </Text>
                  </div>
                )}
                <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>
                  {acc.displayName}
                </Text>
                <Text
                  style={{
                    fontSize: 10,
                    color: platformColor(acc.platform),
                    fontWeight: 500,
                  }}
                >
                  {acc.platform}
                </Text>
              </div>
            ))}
          </div>
          <Text
            style={{
              fontSize: 13,
              color: theme.text2,
              maxWidth: 280,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            {t('chat.empty.joinChannel')}
          </Text>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
            {t('chat.empty.noMessages')}
          </Text>
          <Text
            style={{
              fontSize: 13,
              color: theme.text2,
              maxWidth: 280,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            {t('chat.empty.realtime')}
          </Text>
        </>
      )}
    </div>
  )
}
