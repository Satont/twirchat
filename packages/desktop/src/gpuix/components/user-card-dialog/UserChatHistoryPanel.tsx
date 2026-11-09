import type { UserChatHistoryCursor, UserChatHistoryPage } from '@desktop/shared/rpc'
import { useBackend, useBackendEvent } from '@gpuix/backend/context'
import { chatMessageKey } from '@gpuix/chat-tools'
import { ChatMessage } from '@gpuix/components/ChatMessage'
import { Text } from '@gpuix/components/ui/Text'
import { errorText } from '@gpuix/components/user-card/format'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import type { PublicInstance } from '@gpuix/react'
import { platformColor } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import {
  HISTORY_DISPLAY_LIMIT,
  appendLiveHistoryMessage,
  formatHistoryTimestamp,
  historyRowVisible,
  historySourceNotice,
  matchesHistoryUser,
  mergeHistoryMessages,
  type HistoryUserTarget,
  type HistoryVisibleRange,
} from '@views/main/utils/history-display'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

const PAGE_SIZE = 50
type UserChatHistoryProps = HistoryUserTarget & {
  username?: string
  onViewport?: (viewport: PublicInstance | null) => void
}

export function UserChatHistoryPanel(props: UserChatHistoryProps) {
  return (
    <UserChatHistoryContent
      key={JSON.stringify([props.platform, props.platformUserId, props.channelId, props.username])}
      {...props}
    />
  )
}

function UserChatHistoryContent({
  platform,
  platformUserId,
  channelId,
  username,
  onViewport,
}: UserChatHistoryProps) {
  const theme = useTheme()
  const backend = useBackend()
  const [messages, setMessages] = useState<NormalizedChatMessage[]>([])
  const [loadingInitial, setLoadingInitial] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [history, setHistory] = useState<UserChatHistoryPage['history']>()
  const [visibleRange, setVisibleRange] = useState<HistoryVisibleRange | null>(null)
  const nextCursorRef = useRef<UserChatHistoryCursor | null>(null)
  const generationRef = useRef(0)

  const loadInitial = useCallback(async (): Promise<void> => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    setLoadingInitial(true)
    setLoadingOlder(false)
    setError(null)

    try {
      const page = await backend.api.getUserChatHistory({
        platform,
        platformUserId,
        channelId,
        username,
        limit: PAGE_SIZE,
      })
      if (generation !== generationRef.current) return
      setMessages((current) => mergeHistoryMessages(current, page.messages))
      setHistory(page.history)
      setHasMore(page.hasMore)
      nextCursorRef.current = page.nextCursor
    } catch (loadError) {
      if (generation !== generationRef.current) return
      setError(errorText(loadError))
    } finally {
      if (generation === generationRef.current) {
        setLoadingInitial(false)
      }
    }
  }, [backend, platform, platformUserId, channelId, username])

  const loadOlder = useCallback(async (): Promise<void> => {
    const cursor = nextCursorRef.current
    if (
      loadingInitial ||
      loadingOlder ||
      !hasMore ||
      !cursor ||
      messages.length >= HISTORY_DISPLAY_LIMIT
    )
      return

    setLoadingOlder(true)
    setError(null)
    const generation = generationRef.current

    try {
      const page = await backend.api.getUserChatHistory({
        platform,
        platformUserId,
        channelId,
        username,
        limit: PAGE_SIZE,
        cursor,
      })
      if (generation !== generationRef.current) return
      setMessages((current) => mergeHistoryMessages(current, page.messages))
      setHistory(page.history)
      setHasMore(page.hasMore)
      nextCursorRef.current = page.nextCursor
    } catch (loadError) {
      if (generation !== generationRef.current) return
      setError(errorText(loadError))
    } finally {
      if (generation === generationRef.current) {
        setLoadingOlder(false)
      }
    }
  }, [
    backend,
    platform,
    platformUserId,
    channelId,
    username,
    loadingInitial,
    loadingOlder,
    hasMore,
    messages.length,
  ])

  useEffect(() => {
    runUiTask(loadInitial())
    return () => {
      generationRef.current += 1
    }
  }, [loadInitial])

  const appendLive = (message: NormalizedChatMessage) => {
    if (!matchesHistoryUser(message, { platform, platformUserId, channelId })) return
    setMessages((current) => appendLiveHistoryMessage(current, message))
  }
  useBackendEvent('chat_message', appendLive)
  useBackendEvent('watched_channel_message', ({ message }) => appendLive(message))

  const isEmpty = !loadingInitial && messages.length === 0 && !error
  const sourceNotice = historySourceNotice(history)
  const canLoadOlder = hasMore && messages.length < HISTORY_DISPLAY_LIMIT

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderTopWidth: 1,
        borderColor: theme.hairline,
        paddingTop: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>Chat logs</Text>
          <Text style={{ fontSize: 12, color: theme.text2, marginTop: 4 }}>
            {channelId ? `Messages from this user in ${channelId}` : 'Messages from this user'}
          </Text>
        </div>

        <div
          tabIndex={loadingInitial ? -1 : 0}
          onClick={loadingInitial ? undefined : () => void loadInitial()}
          onKeyDown={(event) => {
            if (!loadingInitial && (event.key === 'enter' || event.key === 'space')) {
              event.preventDefault()
              runUiTask(loadInitial())
            }
          }}
          style={{
            borderRadius: 6,
            backgroundColor: theme.fill,
            paddingTop: 7,
            paddingBottom: 7,
            paddingLeft: 10,
            paddingRight: 10,
            cursor: loadingInitial ? 'default' : 'pointer',
            opacity: loadingInitial ? 0.6 : 1,
            flexShrink: 0,
            hover: loadingInitial ? {} : { backgroundColor: theme.fillHover },
          }}
        >
          <Text style={{ fontSize: 12, color: theme.text }}>Refresh</Text>
        </div>
      </div>

      {sourceNotice ? (
        <Text
          testId="user-card-history-source-status"
          style={{ fontSize: 11, color: theme.text2, marginBottom: 8 }}
        >
          {sourceNotice}
        </Text>
      ) : null}
      {error && messages.length ? (
        <Text style={{ fontSize: 12, color: theme.dangerText, marginBottom: 8 }}>{error}</Text>
      ) : null}
      {messages.length >= HISTORY_DISPLAY_LIMIT ? (
        <Text style={{ fontSize: 11, color: theme.text2, marginBottom: 8 }}>
          Showing the newest 2,000 loaded messages. Use channel history to filter or export older
          logs.
        </Text>
      ) : null}
      {loadingInitial && !messages.length ? (
        <HistoryState minHeight={160}>
          <Text style={{ fontSize: 13, color: theme.text2 }}>Loading messages…</Text>
        </HistoryState>
      ) : error && !messages.length ? (
        <HistoryState minHeight={160} error>
          <Text style={{ fontSize: 13, color: theme.dangerText }}>{error}</Text>
          <HistoryRetryButton onClick={() => void loadInitial()} />
        </HistoryState>
      ) : isEmpty ? (
        <HistoryState minHeight={160}>
          <Text style={{ fontSize: 13, color: theme.text2 }}>
            No messages are available for this user in the selected history.
          </Text>
        </HistoryState>
      ) : (
        <div
          style={{
            minHeight: 0,
            borderWidth: 1,
            borderColor: theme.hairline,
            borderRadius: 10,
            overflow: 'hidden',
            backgroundColor: theme.fill,
          }}
        >
          <virtual-list
            ref={onViewport}
            testId="user-card-history-viewport"
            alignment="bottom"
            estimatedItemHeight={44}
            onVisibleRange={(event) => {
              const start = event.startIndex ?? 0
              const end = event.endIndex ?? 0
              setVisibleRange((current) =>
                current?.start === start && current.end === end ? current : { start, end },
              )
            }}
            style={{ height: 260, scrollbarColor: theme.scrollbar, scrollbarWidth: 4 }}
          >
            {canLoadOlder || loadingOlder ? (
              <div
                key="load-older"
                tabIndex={canLoadOlder && !loadingOlder ? 0 : -1}
                onClick={canLoadOlder && !loadingOlder ? () => void loadOlder() : undefined}
                onKeyDown={(event) => {
                  if (
                    canLoadOlder &&
                    !loadingOlder &&
                    (event.key === 'enter' || event.key === 'space')
                  ) {
                    event.preventDefault()
                    runUiTask(loadOlder())
                  }
                }}
                style={{
                  minHeight: 32,
                  display: 'flex',
                  alignItems: 'center',
                  paddingTop: 8,
                  paddingBottom: 8,
                  paddingLeft: 12,
                  paddingRight: 12,
                  borderBottomWidth: 1,
                  borderColor: theme.divider,
                  cursor: canLoadOlder && !loadingOlder ? 'pointer' : 'default',
                  hover: canLoadOlder && !loadingOlder ? { backgroundColor: theme.rowHover } : {},
                }}
              >
                <Text style={{ fontSize: 11, color: theme.text2 }}>
                  {loadingOlder ? 'Loading older messages…' : 'Load older messages'}
                </Text>
              </div>
            ) : null}
            {messages.map((message, index) => (
              <HistoryMessageRow
                key={chatMessageKey(message)}
                message={message}
                visible={historyRowVisible(
                  index,
                  messages.length,
                  visibleRange,
                  canLoadOlder || loadingOlder ? 1 : 0,
                )}
              />
            ))}
          </virtual-list>
        </div>
      )}
    </div>
  )
}

function HistoryState({
  minHeight,
  error,
  children,
}: {
  minHeight: number
  error?: boolean
  children: React.ReactNode
}) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: error ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        minHeight,
        padding: 16,
        borderWidth: 1,
        borderColor: theme.hairline,
        borderRadius: 10,
        backgroundColor: theme.fill,
      }}
    >
      {children}
    </div>
  )
}

function HistoryRetryButton({ onClick }: { onClick: () => void }) {
  const theme = useTheme()
  return (
    <div
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          onClick()
        }
      }}
      style={{
        borderRadius: 6,
        backgroundColor: theme.fill,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        cursor: 'pointer',
        hover: { backgroundColor: theme.fillHover },
      }}
    >
      <Text style={{ fontSize: 12, color: theme.text }}>Retry</Text>
    </div>
  )
}

const HistoryMessageRow = memo(function HistoryMessageRow({
  message,
  visible,
}: {
  message: NormalizedChatMessage
  visible: boolean
}) {
  const theme = useTheme()
  const typeColor =
    message.type === 'action'
      ? theme.link
      : message.type === 'system'
        ? theme.warningText
        : theme.text2

  return (
    <div
      testId={`user-history-message-${chatMessageKey(message)}`}
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 10,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 12,
        paddingRight: 12,
        borderBottomWidth: 1,
        borderColor: theme.divider,
      }}
    >
      <div
        style={{
          width: 3,
          alignSelf: 'stretch',
          flexShrink: 0,
          borderRadius: 999,
          backgroundColor: platformColor(message.platform),
        }}
      />

      <div style={{ minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 4,
          }}
        >
          <Text style={{ fontSize: 11, color: theme.text2 }}>
            {formatHistoryTimestamp(message.timestamp)}
          </Text>
          <div
            style={{
              paddingTop: 1,
              paddingBottom: 1,
              paddingLeft: 6,
              paddingRight: 6,
              borderRadius: 999,
              backgroundColor: theme.fill,
            }}
          >
            <Text style={{ fontSize: 11, color: theme.text2 }}>{message.channelId}</Text>
          </div>
          <div
            style={{
              paddingTop: 1,
              paddingBottom: 1,
              paddingLeft: 6,
              paddingRight: 6,
              borderRadius: 999,
              backgroundColor: theme.fill,
            }}
          >
            <Text style={{ fontSize: 11, color: typeColor }}>{message.type}</Text>
          </div>
        </div>

        <ChatMessage
          message={message}
          channelSlug={message.channelId}
          chatTheme="compact"
          fontSize={13}
          showTimestamp={false}
          showAvatar={false}
          showPlatformColorStripe={false}
          visible={visible}
        />
      </div>
    </div>
  )
})
