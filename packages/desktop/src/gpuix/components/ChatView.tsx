/**
 * Chat pane — port of ChatList.vue (header + virtualized list + composer)
 * onto GPUIX's native <virtual-list> (alignment="bottom" followTail replaces
 * the virtua VList + manual at-bottom tracking).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger, useGpuixRequired } from '@gpuix/react'
import type {
  Account,
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
import type { ChannelStatus } from '@twirchat/shared/protocol'

import { useBackend } from '../backend/context'
import { useStore } from '../state/create-store'
import {
  accountsStore,
  aliasesStore,
  applyModerationOutcome,
  channelStatusStore,
  homeMessagesStore,
  moderationOutcomeFor,
  moderationRevisionStore,
  settingsStore,
  streamStatusStore,
  watchedMessagesStore,
  watchedStatusesStore,
  showNotice,
} from '../state/app'
import { accent, platformColor, withAlpha } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { ownChatSendTargets } from '../../views/main/utils/chat-send-targets'
import { useOverlayClose } from '../state/overlays'
import { buildChattersTargets } from '../../views/main/utils/chatters'
import type { UserCardTarget } from '../../views/main/utils/chatCommands'
import {
  confirmDelivery,
  createPendingMessage,
  failDelivery,
  reconcilePendingMessages,
  type DeliveryMessage,
} from '../../views/main/utils/message-delivery'
import type { ModerationDragAction } from '../../views/main/utils/moderation-drag'
import { Icon, PlatformIcon } from './ui/Icon'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ChatAppearancePopover } from './ChatAppearancePopover'
import { UserCardDialog } from './UserCardDialog'
import { ChattersDialog } from './ChattersDialog'
import { MessageModerationRail } from './MessageModerationRail'

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
  const color = platformColor(ch.platform)

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
            backgroundColor: ch.isLive ? withAlpha(color, 0.12) : 'rgba(255, 255, 255, 0.05)',
            borderColor: ch.isLive ? withAlpha(color, 0.35) : 'rgba(255, 255, 255, 0.08)',
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
          {ch.isLive && ch.viewerCount !== undefined ? (
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
          backgroundColor: '#1e1e30',
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.1)',
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
                color: ch.isLive ? '#22c55e' : '#8b8b99',
                fontFamily: font,
              }}
            >
              {ch.isLive ? 'LIVE' : 'Offline'}
            </text>
          </div>
          {ch.title ? (
            <text style={{ fontSize: 12, color: '#e2e2e8', fontFamily: font }}>{ch.title}</text>
          ) : null}
          {ch.categoryName ? (
            <text style={{ fontSize: 11, color: '#8b8b99', fontFamily: font }}>
              {`Category  ${ch.categoryName}`}
            </text>
          ) : null}
          {ch.isLive && ch.viewerCount !== undefined ? (
            <text style={{ fontSize: 11, color: '#8b8b99', fontFamily: font }}>
              {`Viewers  ${ch.viewerCount.toLocaleString()}`}
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
  /** null/undefined = the combined "My channels" home pane */
  watchedChannel?: WatchedChannel | null
  isMain?: boolean
  onGoToPlatforms?: () => void
  onSplitRight?: () => void
  onChangeChannel?: () => void
  onClosePanel?: () => void
}

export function ChatView({
  watchedChannel,
  isMain,
  onGoToPlatforms,
  onSplitRight,
  onChangeChannel,
  onClosePanel,
}: ChatViewProps) {
  const backend = useBackend()
  const theme = useTheme()
  const renderer = useGpuixRequired()

  const settings = useStore(settingsStore)
  const accounts = useStore(accountsStore)
  const aliases = useStore(aliasesStore)
  const statuses = useStore(channelStatusStore)
  const homeMessages = useStore(homeMessagesStore)
  const watchedMessagesMap = useStore(watchedMessagesStore)
  const watchedStatuses = useStore(watchedStatusesStore)
  const streamStatuses = useStore(streamStatusStore)
  useStore(moderationRevisionStore) // re-resolve outcomes on change

  const watchedChannelStatus = watchedChannel
    ? (watchedStatuses.get(watchedChannel.id) ?? null)
    : null

  // ── Messages + optimistic delivery ─────────────────────────────────────────

  const [deliveryMessages, setDeliveryMessages] = useState<DeliveryMessage[]>([])

  const providerMessages = useMemo(
    () => (watchedChannel ? (watchedMessagesMap.get(watchedChannel.id) ?? []) : homeMessages),
    [watchedChannel, watchedMessagesMap, homeMessages],
  )

  // Drop optimistic echoes once the provider message arrives.
  useEffect(() => {
    setDeliveryMessages((current) => reconcilePendingMessages(current, providerMessages))
  }, [providerMessages])

  const activeMessages = useMemo(
    () => [...providerMessages, ...deliveryMessages],
    [providerMessages, deliveryMessages],
  )

  // ── Virtual list + scroll pill ─────────────────────────────────────────────

  const listRef = useRef<import('@gpuix/react').PublicInstance | null>(null)
  const [atBottom, setAtBottom] = useState(true)

  const scrollToLatest = () => {
    if (listRef.current) {
      renderer.scrollToItem?.(listRef.current.id, activeMessages.length)
      setAtBottom(true)
    }
  }

  // ── Reply / moderation / dialogs ───────────────────────────────────────────

  const [replyTarget, setReplyTarget] = useState<NormalizedChatMessage | null>(null)
  const [userCardTarget, setUserCardTarget] = useState<UserCardTarget | null>(null)
  const [chattersOpen, setChattersOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  useOverlayClose(menuOpen, () => setMenuOpen(false))
  const [watchedModerationAllowed, setWatchedModerationAllowed] = useState(false)
  const [moderationPendingIds, setModerationPendingIds] = useState<Set<string>>(new Set())

  function getChannelSlugForPlatform(platform: Platform): string | undefined {
    if (watchedChannel?.platform === platform) return watchedChannel.channelSlug
    return statuses[platform]?.channelLogin
  }

  const moderationPlatform = (platform: Platform): 'twitch' | 'kick' | undefined =>
    platform === 'twitch' || platform === 'kick' ? platform : undefined

  const canShowModerationRail = (message: NormalizedChatMessage): boolean => {
    if (
      !moderationPlatform(message.platform) ||
      message.type === 'system' ||
      message.delivery ||
      !message.id ||
      !message.author.id
    ) {
      return false
    }
    return !watchedChannel || watchedModerationAllowed
  }

  // Refresh the watched-channel moderation capability when inputs change.
  const accountsKey = accounts.map((a) => `${a.platform}:${a.id}`).join('|')
  useEffect(() => {
    let cancelled = false
    const platform = watchedChannel ? moderationPlatform(watchedChannel.platform) : undefined
    const account = platform ? accounts.find((a) => a.platform === platform) : undefined
    if (!watchedChannel || !platform || !account) {
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
  }, [watchedChannel?.id, watchedChannel?.platform, watchedChannel?.channelSlug, accountsKey])

  async function onModerate(message: NormalizedChatMessage, action: ModerationDragAction) {
    const platform = moderationPlatform(message.platform)
    if (!platform) return
    const channelSlug =
      watchedChannel?.channelSlug ?? getChannelSlugForPlatform(platform) ?? message.channelId
    if (!channelSlug) {
      showNotice('error', 'Could not determine the channel for this moderation action.', 3500)
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
  }

  // ── Sending (optimistic) ───────────────────────────────────────────────────

  function deliveryErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return message.replace(/^Error:\s*/, '').replace(/^send (Twitch|Kick) message:\s*/i, '')
  }

  function pendingReply(): NormalizedChatMessage['reply'] | undefined {
    if (!replyTarget) return undefined
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
    const account = accounts.find((candidate) => candidate.platform === platform)
    if (!account || (platform !== 'twitch' && platform !== 'kick')) {
      console.warn(`[chat] cannot prepare ${platform} optimistic message: no authenticated account`)
      return
    }
    const message = createPendingMessage({ account, channelId, text, reply: pendingReply() })
    setDeliveryMessages((current) => [...current, message])
    try {
      if (watchedChannelId) {
        await backend.api.sendWatchedChannelMessage({
          id: watchedChannelId,
          text,
          replyToMessageId,
        })
      } else {
        await backend.api.sendMessage({ channelId, platform, text, replyToMessageId })
      }
      setDeliveryMessages((current) => confirmDelivery(current, message.id))
    } catch (error) {
      setDeliveryMessages((current) =>
        failDelivery(current, message.id, deliveryErrorMessage(error)),
      )
    }
  }

  async function onSend(
    targets: { platform: string; channelLogin: string; text: string; replyToMessageId?: string }[],
  ) {
    await Promise.all(
      targets.map((target) =>
        submitDelivery(
          target.platform as Platform,
          target.channelLogin,
          target.text,
          target.replyToMessageId,
        ),
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

  const hasAnyConnection = ['twitch', 'youtube', 'kick'].some(
    (p) => statuses[p as Platform]?.status === 'connected',
  )

  const aliasFor = (msg: NormalizedChatMessage): string | undefined =>
    msg.author.id
      ? aliases.find((a) => a.platform === msg.platform && a.platformUserId === msg.author.id)
          ?.alias
      : undefined

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
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
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 16,
          paddingRight: 16,
          borderBottomWidth: 1,
          borderColor: theme.border,
          flexShrink: 0,
          minHeight: 44,
          userSelect: 'none',
        }}
      >
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
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flexShrink: 1,
              }}
            >
              {watchedChannel.displayName.toUpperCase()}
            </Text>
            {watchedStreamStatus?.isLive ? (
              <>
                {watchedStreamStatus.viewerCount !== undefined ? (
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
            {watchedChannelStatus ? (
              <div
                style={{
                  borderRadius: 10,
                  paddingTop: 2,
                  paddingBottom: 2,
                  paddingLeft: 7,
                  paddingRight: 7,
                  borderWidth: 1,
                  flexShrink: 0,
                  ...(watchedChannelStatus.mode === 'authenticated'
                    ? {
                        borderColor: 'rgba(34, 197, 94, 0.25)',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                      }
                    : {
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      }),
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    color: watchedChannelStatus.mode === 'authenticated' ? '#22c55e' : theme.text2,
                  }}
                >
                  {watchedChannelStatus.mode === 'authenticated' ? 'authenticated' : 'read-only'}
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
              {'Live Chat'.toUpperCase()}
            </Text>
            {displayedChannels.length > 0 ? (
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
              </div>
            ) : null}
          </>
        )}

        {/* Right side */}
        <div style={{ flexGrow: 1 }} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
          }}
        >
          {activeMessages.length > 0 ? (
            <Text style={{ fontSize: 11, color: theme.text2, flexShrink: 0 }}>
              {`${activeMessages.length} messages`}
            </Text>
          ) : null}

          {chattersTargets.length > 0 ? (
            <HeaderButton testId="chatters-button" onClick={() => setChattersOpen(true)}>
              <Icon name="users" size={14} color={theme.text2} />
            </HeaderButton>
          ) : null}

          {settings ? <ChatAppearancePopover settings={settings} /> : null}

          {!isMain ? (
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'row', gap: 2 }}>
              <HeaderButton testId="split-right" onClick={() => onSplitRight?.()}>
                <Icon name="plus" size={14} color={theme.text2} />
              </HeaderButton>
              <HeaderButton testId="panel-menu" onClick={() => setMenuOpen((open) => !open)}>
                <Icon name="moreVertical" size={14} color={theme.text2} />
              </HeaderButton>
              {menuOpen ? (
                <anchored
                  deferred
                  side="bottom"
                  align="end"
                  gap={4}
                  onMouseDownOutside={() => setMenuOpen(false)}
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
                  {watchedChannel ? (
                    <MenuItem
                      label="📺 Change channel"
                      onClick={() => {
                        setMenuOpen(false)
                        onChangeChannel?.()
                      }}
                    />
                  ) : null}
                  {watchedChannel ? (
                    <div
                      style={{
                        height: 1,
                        backgroundColor: theme.border,
                        marginTop: 4,
                        marginBottom: 4,
                      }}
                    />
                  ) : null}
                  <MenuItem
                    label="✕ Close panel"
                    danger
                    onClick={() => {
                      setMenuOpen(false)
                      onClosePanel?.()
                    }}
                  />
                </anchored>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Messages + scroll pill */}
      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {activeMessages.length > 0 ? (
          <virtual-list
            ref={listRef}
            alignment="bottom"
            followTail
            estimatedItemHeight={56}
            onVisibleRange={(event) => {
              const end = event.endIndex ?? 0
              setAtBottom(end >= activeMessages.length - 1)
            }}
            style={{ flexGrow: 1, minHeight: 0 }}
          >
            {activeMessages.map((message) => {
              const outcome = moderationOutcomeFor(message)
              return (
                // Plain block wrapper: flex containers shrink to content in
                // virtual-list rows, block divs stretch to the list width.
                <div key={message.id} style={{ width: '100%' }}>
                  <ChatMessage
                    message={message}
                    channelSlug={getChannelSlugForPlatform(message.platform)}
                    alias={aliasFor(message)}
                    showPlatformColorStripe={
                      watchedChannel ? false : settings?.showPlatformColorStripe
                    }
                    showPlatformIcon={watchedChannel ? false : settings?.showPlatformIcon}
                    showTimestamp={settings?.showTimestamp}
                    showAvatar={settings?.showAvatars}
                    showBadges={settings?.showBadges}
                    fontSize={settings?.fontSize}
                    chatTheme={settings?.chatTheme}
                    accounts={accounts}
                    selfPingEnabled={settings?.selfPing?.enabled}
                    selfPingColor={settings?.selfPing?.color}
                    moderationOutcome={outcome}
                    onOpenUserCard={(target) =>
                      setUserCardTarget({
                        ...target,
                        channelSlug:
                          target.channelSlug ?? getChannelSlugForPlatform(target.platform),
                      })
                    }
                    onReply={setReplyTarget}
                    moderationRail={
                      canShowModerationRail(message) && (!outcome || outcome.isTombstone) ? (
                        <MessageModerationRail
                          disabled={moderationPendingIds.has(message.id)}
                          platform={moderationPlatform(message.platform)!}
                          onModerate={(action) => void onModerate(message, action)}
                        />
                      ) : undefined
                    }
                  />
                </div>
              )
            })}
          </virtual-list>
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
        {!atBottom && activeMessages.length > 0 ? (
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
              onClick={scrollToLatest}
              style={{
                pointerEvents: 'auto',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: 'rgba(15, 15, 17, 0.92)',
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.12)',
                borderRadius: 20,
                paddingTop: 6,
                paddingBottom: 6,
                paddingLeft: 14,
                paddingRight: 14,
                cursor: 'pointer',
                hover: { backgroundColor: 'rgba(30, 30, 36, 0.96)' },
              }}
            >
              <Icon name="chevronDown" size={14} color={theme.text} />
              <Text style={{ fontSize: 12, fontWeight: 500, color: theme.text }}>
                Scroll to latest
              </Text>
            </div>
          </div>
        ) : null}
      </div>

      {/* Composer */}
      {settings ? (
        <ChatInput
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
        />
      ) : null}

      {/* Dialogs */}
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
}: {
  children: React.ReactNode
  onClick?: () => void
  testId?: string
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 26,
        height: 26,
        borderRadius: 4,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hovered ? 'rgba(255, 255, 255, 0.1)' : undefined,
      }}
    >
      {/* re-tint the icon on hover by cloning with a different color is the
          caller's concern; icons here read text2 which is close enough to
          the Vue hover target (theme.text) */}
      {children}
    </div>
  )
}

function MenuItem({
  label,
  danger,
  onClick,
}: {
  label: string
  danger?: boolean
  onClick?: () => void
}) {
  const theme = useTheme()
  return (
    <div
      onClick={onClick}
      style={{
        paddingTop: 7,
        paddingBottom: 7,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 5,
        cursor: 'pointer',
        hover: { backgroundColor: danger ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.1)' },
      }}
    >
      <Text style={{ fontSize: 13, color: danger ? '#ef4444' : theme.text }}>{label}</Text>
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
              ? 'Connecting…'
              : watchedChannelStatus?.status === 'connected'
                ? 'No messages yet'
                : watchedChannelStatus?.status === 'error'
                  ? 'Connection failed'
                  : 'Waiting for connection…'}
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
              ? watchedChannelStatus.error || 'The chat transport returned an unknown error.'
              : `Messages from ${watchedChannel.displayName} will appear here.`}
          </Text>
        </>
      ) : accounts.length === 0 && !hasAnyConnection ? (
        <>
          <Text style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
            No accounts connected
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
            Connect your streaming accounts to start reading chat.
          </Text>
          <div
            testId="go-to-platforms"
            onClick={onGoToPlatforms}
            style={{
              marginTop: 4,
              backgroundColor: accent.tint15,
              borderWidth: 1,
              borderColor: accent.tint45,
              borderRadius: 8,
              paddingTop: 7,
              paddingBottom: 7,
              paddingLeft: 16,
              paddingRight: 16,
              cursor: 'pointer',
              hover: { backgroundColor: accent.tint25 },
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: 600, color: accent.primary }}>
              Go to Platforms →
            </Text>
          </div>
        </>
      ) : !hasAnyConnection ? (
        <>
          <Text style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
            Waiting for connection…
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
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.08)',
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
                      {acc.displayName.charAt(0).toUpperCase()}
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
            Join a channel in Platforms to see chat.
          </Text>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>No messages yet</Text>
          <Text
            style={{
              fontSize: 13,
              color: theme.text2,
              maxWidth: 280,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            Chat messages will appear here in real time.
          </Text>
        </>
      )}
    </div>
  )
}
