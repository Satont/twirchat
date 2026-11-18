import type { UserChatHistoryCursor, UserChatHistoryPage } from '@desktop/shared/rpc'
import { useBackend, useBackendEvent } from '@gpuix/backend/context'
import { errorText } from '@gpuix/components/user-card/format'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'
import {
  HISTORY_DISPLAY_LIMIT,
  appendLiveHistoryMessage,
  matchesHistoryUser,
  mergeHistoryMessages,
  type HistoryVisibleRange,
} from '@views/main/utils/history-display'
import { useCallback, useEffect, useRef, useState } from 'react'

import { PAGE_SIZE } from './constants'

export interface ChatHistoryState {
  messages: NormalizedChatMessage[]
  loadingInitial: boolean
  loadingOlder: boolean
  error: string | null
  history: UserChatHistoryPage['history']
  visibleRange: HistoryVisibleRange | null
  canLoadOlder: boolean
  loadInitial: () => Promise<void>
  loadOlder: () => Promise<void>
  updateVisibleRange: (start: number, end: number) => void
}

export function useChatHistory(
  platform: Platform,
  platformUserId: string,
  channelId: string | undefined,
  username: string | undefined,
): ChatHistoryState {
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

  const appendLive = useCallback(
    (message: NormalizedChatMessage): void => {
      if (!matchesHistoryUser(message, { platform, platformUserId, channelId })) return
      setMessages((current) => appendLiveHistoryMessage(current, message))
    },
    [platform, platformUserId, channelId],
  )
  useBackendEvent('chat_message', appendLive)
  useBackendEvent('watched_channel_message', ({ message }) => appendLive(message))

  const updateVisibleRange = useCallback((start: number, end: number): void => {
    setVisibleRange((current) =>
      current?.start === start && current.end === end ? current : { start, end },
    )
  }, [])

  return {
    messages,
    loadingInitial,
    loadingOlder,
    error,
    history,
    visibleRange,
    canLoadOlder: hasMore && messages.length < HISTORY_DISPLAY_LIMIT,
    loadInitial,
    loadOlder,
    updateVisibleRange,
  }
}
