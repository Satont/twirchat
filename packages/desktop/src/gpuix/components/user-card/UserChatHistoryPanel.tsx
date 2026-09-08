/**
 * Chat logs panel — port of UserChatHistoryPanel.vue + UserChatHistoryMessage.vue.
 *
 * Paged local history (50 per page, {createdAt,id} cursor) with live appends
 * from the backend `chat_message` event.
 *
 * GPUIX deviations:
 * - Older pages load via a clickable "Load older" trigger row at the top of
 *   the list instead of the Vue scroll-offset (<160px) detection.
 * - Message text renders as plain <text> (no emote substitution).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'
import type { UserChatHistoryCursor } from '../../../shared/rpc'
import { platformColor } from '../../theme'
import { useTheme } from '../../theme-context'
import { useBackend, useBackendEvent } from '../../backend/context'
import { Text } from '../ui/Text'
import { errorText } from './format'

const PAGE_SIZE = 50

function compareMessages(a: NormalizedChatMessage, b: NormalizedChatMessage): number {
  const timestampDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  if (timestampDiff !== 0) return timestampDiff
  return a.id.localeCompare(b.id)
}

function mergeUniqueMessages(
  olderMessages: NormalizedChatMessage[],
  existingMessages: NormalizedChatMessage[],
): NormalizedChatMessage[] {
  const existingIds = new Set(existingMessages.map((message) => message.id))
  const uniqueOlderMessages = olderMessages.filter((message) => !existingIds.has(message.id))
  return [...uniqueOlderMessages, ...existingMessages]
}

function insertMessageInOrder(
  existingMessages: NormalizedChatMessage[],
  incomingMessage: NormalizedChatMessage,
): NormalizedChatMessage[] {
  if (existingMessages.some((entry) => entry.id === incomingMessage.id)) {
    return existingMessages
  }

  const nextMessages = [...existingMessages]
  const insertIndex = nextMessages.findIndex((entry) => compareMessages(incomingMessage, entry) < 0)

  if (insertIndex === -1) {
    nextMessages.push(incomingMessage)
  } else {
    nextMessages.splice(insertIndex, 0, incomingMessage)
  }

  return nextMessages
}

function formatHistoryTimestamp(timestamp: Date): string {
  return new Date(timestamp).toLocaleString([], {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  })
}

export function UserChatHistoryPanel({
  platform,
  platformUserId,
}: {
  platform: Platform
  platformUserId: string
}) {
  const theme = useTheme()
  const backend = useBackend()
  const [messages, setMessages] = useState<NormalizedChatMessage[]>([])
  const [loadingInitial, setLoadingInitial] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const nextCursorRef = useRef<UserChatHistoryCursor | null>(null)
  const generationRef = useRef(0)

  const loadInitial = useCallback(async (): Promise<void> => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    setLoadingInitial(true)
    setError(null)

    try {
      const page = await backend.api.getUserChatHistory({
        platform,
        platformUserId,
        limit: PAGE_SIZE,
      })
      if (generation !== generationRef.current) return
      setMessages(page.messages)
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
  }, [backend, platform, platformUserId])

  const loadOlder = useCallback(async (): Promise<void> => {
    const cursor = nextCursorRef.current
    if (loadingInitial || loadingOlder || !hasMore || !cursor) return

    setLoadingOlder(true)
    setError(null)
    const generation = generationRef.current

    try {
      const page = await backend.api.getUserChatHistory({
        platform,
        platformUserId,
        limit: PAGE_SIZE,
        cursor,
      })
      if (generation !== generationRef.current) return
      setMessages((current) => mergeUniqueMessages(page.messages, current))
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
  }, [backend, platform, platformUserId, loadingInitial, loadingOlder, hasMore])

  // Reset + initial load when the target user changes (and on mount).
  useEffect(() => {
    generationRef.current += 1
    setMessages([])
    setLoadingInitial(false)
    setLoadingOlder(false)
    setError(null)
    setHasMore(false)
    nextCursorRef.current = null
    void loadInitial()
  }, [loadInitial])

  // Live-append new messages from this user while the panel is open.
  useBackendEvent('chat_message', (message) => {
    if (message.platform !== platform || message.author.id !== platformUserId) return
    setMessages((current) => insertMessageInOrder(current, message))
  })

  const isEmpty = !loadingInitial && messages.length === 0 && !error

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderTopWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
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
            Stored local history for this user
          </Text>
        </div>

        <div
          onClick={loadingInitial ? undefined : () => void loadInitial()}
          style={{
            borderRadius: 6,
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            paddingTop: 7,
            paddingBottom: 7,
            paddingLeft: 10,
            paddingRight: 10,
            cursor: loadingInitial ? 'default' : 'pointer',
            opacity: loadingInitial ? 0.6 : 1,
            flexShrink: 0,
            hover: loadingInitial ? {} : { backgroundColor: 'rgba(255, 255, 255, 0.14)' },
          }}
        >
          <Text style={{ fontSize: 12, color: theme.text }}>Refresh</Text>
        </div>
      </div>

      {loadingInitial ? (
        <HistoryState minHeight={160}>
          <Text style={{ fontSize: 13, color: theme.text2 }}>Loading messages…</Text>
        </HistoryState>
      ) : error ? (
        <HistoryState minHeight={160} error>
          <Text style={{ fontSize: 13, color: '#fca5a5' }}>{error}</Text>
          <HistoryRetryButton onClick={() => void loadInitial()} />
        </HistoryState>
      ) : isEmpty ? (
        <HistoryState minHeight={160}>
          <Text style={{ fontSize: 13, color: theme.text2 }}>
            No stored messages for this user yet.
          </Text>
        </HistoryState>
      ) : (
        <div
          style={{
            minHeight: 0,
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.06)',
            borderRadius: 10,
            overflow: 'hidden',
            backgroundColor: 'rgba(0, 0, 0, 0.16)',
          }}
        >
          <virtual-list estimatedItemHeight={44} style={{ height: 260 }}>
            {hasMore || loadingOlder ? (
              <div
                key="load-older"
                onClick={hasMore && !loadingOlder ? () => void loadOlder() : undefined}
                style={{
                  minHeight: 32,
                  display: 'flex',
                  alignItems: 'center',
                  paddingTop: 8,
                  paddingBottom: 8,
                  paddingLeft: 12,
                  paddingRight: 12,
                  borderBottomWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.05)',
                  cursor: hasMore && !loadingOlder ? 'pointer' : 'default',
                  hover:
                    hasMore && !loadingOlder
                      ? { backgroundColor: 'rgba(255, 255, 255, 0.05)' }
                      : {},
                }}
              >
                <Text style={{ fontSize: 11, color: theme.text2 }}>
                  {loadingOlder ? 'Loading older messages…' : 'Load older messages'}
                </Text>
              </div>
            ) : null}
            {messages.map((message) => (
              <HistoryMessageRow key={message.id} message={message} />
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
        borderColor: 'rgba(255, 255, 255, 0.06)',
        borderRadius: 10,
        backgroundColor: 'rgba(0, 0, 0, 0.16)',
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
      onClick={onClick}
      style={{
        borderRadius: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        cursor: 'pointer',
        hover: { backgroundColor: 'rgba(255, 255, 255, 0.14)' },
      }}
    >
      <Text style={{ fontSize: 12, color: theme.text }}>Retry</Text>
    </div>
  )
}

function HistoryMessageRow({ message }: { message: NormalizedChatMessage }) {
  const theme = useTheme()
  const typeColor =
    message.type === 'action' ? '#7dd3fc' : message.type === 'system' ? '#fbbf24' : theme.text2

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 10,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 12,
        paddingRight: 12,
        borderBottomWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.05)',
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
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
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
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
            }}
          >
            <Text style={{ fontSize: 11, color: typeColor }}>{message.type}</Text>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', gap: 6, minWidth: 0 }}>
          <Text
            style={{
              flexShrink: 0,
              fontWeight: 700,
              fontSize: 13,
              lineHeight: 18,
              color: message.author.color ?? theme.text,
            }}
          >
            {message.author.displayName}
          </Text>
          <Text
            style={{
              fontSize: 13,
              lineHeight: 18,
              color: theme.text,
              whiteSpace: 'normal',
              minWidth: 0,
            }}
          >
            {message.text}
          </Text>
        </div>
      </div>
    </div>
  )
}
