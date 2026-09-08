/**
 * React port of composables/useAutocomplete.ts.
 * Logic unchanged; Vue refs become React state + memos.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'

import { fuzzyFilter } from '../../views/main/utils/fuzzyFilter'
import {
  parseToken,
  replaceToken,
  type AutocompleteSuggestion,
  type CommandSuggestion,
  type EmoteSuggestion,
  type MentionSuggestion,
} from '../../views/main/utils/autocompleteUtils'
import { mentionColor } from '../state/caches'
import { emoteStore, loadEmotes } from '../state/app'
import { useBackend } from '../backend/context'
import { useStore } from '../state/create-store'

export { parseToken, replaceToken }
export type { AutocompleteSuggestion, EmoteSuggestion, MentionSuggestion }

type AliasMap = Map<Platform, Map<string, string>>

const COMMAND_SUGGESTIONS: CommandSuggestion[] = [
  { type: 'command', label: '/user', insertText: '/user', description: 'Open user card' },
]

export function useAutocomplete(params: {
  text: string
  setText: (next: string) => void
  messages: NormalizedChatMessage[]
  watchedChannel: WatchedChannel | null | undefined
  statuses: Partial<Record<Platform, PlatformStatusInfo>>
  aliasMap: AliasMap | undefined
}) {
  const { text, setText, messages, watchedChannel, statuses, aliasMap } = params
  const backend = useBackend()
  const emotes = useStore(emoteStore)

  const [closedQuery, setClosedQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const token = useMemo(() => parseToken(text), [text])
  const mode = token.mode
  const query = token.query
  const queryKey = mode === 'command' ? `/${query}` : query

  const mentionSuggestions = useMemo((): MentionSuggestion[] => {
    const seen = new Set<string>()
    const result: MentionSuggestion[] = []

    // Newest authors first.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (!msg) continue
      const displayName = msg.author.displayName
      const lower = displayName.toLowerCase()
      const dedupKey = msg.author.id
        ? `${msg.platform}:${msg.author.id}`
        : `${msg.platform}:${lower}`
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)

      const alias = msg.author.id ? aliasMap?.get(msg.platform)?.get(msg.author.id) : undefined
      result.push({
        type: 'mention',
        label: alias || displayName,
        insertLabel: displayName,
        color: mentionColor(msg.platform, lower) ?? null,
        description: msg.author.username
          ? `@${msg.author.username} • ${msg.platform}`
          : msg.platform,
        platform: msg.platform,
        platformUserId: msg.author.id,
        displayName,
        username: msg.author.username,
        avatarUrl: msg.author.avatarUrl,
        currentAlias: alias,
      })
    }
    return result
  }, [messages, aliasMap])

  function getCurrentChannelKey(): { platform: string; channelId: string } | null {
    if (watchedChannel) {
      return { platform: watchedChannel.platform, channelId: watchedChannel.channelSlug }
    }
    for (const info of Object.values(statuses)) {
      if (info?.channelLogin && info.status === 'connected') {
        return { platform: info.platform, channelId: info.channelLogin }
      }
    }
    return null
  }

  const emoteSuggestions = useMemo((): EmoteSuggestion[] => {
    const ch = getCurrentChannelKey()
    if (!ch) return []
    return (emotes.get(`${ch.platform}:${ch.channelId}`) ?? []).map((e) => ({
      type: 'emote',
      label: e.alias,
      imageUrl: e.imageUrl,
      animated: e.animated,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emotes, watchedChannel?.id, statuses])

  const suggestions = useMemo((): AutocompleteSuggestion[] => {
    if (!mode) return []
    if (mode === 'command') {
      if (!query) return COMMAND_SUGGESTIONS.slice(0, 15)
      return fuzzyFilter(COMMAND_SUGGESTIONS, query).slice(0, 15) as AutocompleteSuggestion[]
    }
    if (!query) return []
    if (mode === 'mention') {
      return fuzzyFilter(mentionSuggestions, query).slice(0, 15) as AutocompleteSuggestion[]
    }
    return fuzzyFilter(emoteSuggestions, query).slice(0, 15) as AutocompleteSuggestion[]
  }, [mode, query, mentionSuggestions, emoteSuggestions])

  const isOpen = suggestions.length > 0 && queryKey !== closedQuery

  // Reset the closed memory on every edit.
  const prevText = useRef(text)
  useEffect(() => {
    if (prevText.current !== text) {
      prevText.current = text
      setClosedQuery('')
      setSelectedIndex(0)
    }
  }, [text])

  // Load emotes for the active channel.
  const channelKey = watchedChannel
    ? `${watchedChannel.platform}:${watchedChannel.channelSlug}`
    : getCurrentChannelKey()
      ? `${getCurrentChannelKey()!.platform}:${getCurrentChannelKey()!.channelId}`
      : null
  useEffect(() => {
    if (!channelKey) return
    const [platform, channelId] = channelKey.split(':') as [string, string]
    void loadEmotes(backend, platform, channelId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey, backend])

  function selectSuggestion(index: number): void {
    const s = suggestions[index]
    if (!s) return
    setText(replaceToken(text, s))
    setSelectedIndex(0)
    setClosedQuery('')
  }

  function moveUp(): void {
    if (suggestions.length === 0) return
    setSelectedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
  }

  function moveDown(): void {
    if (suggestions.length === 0) return
    setSelectedIndex((i) => (i >= suggestions.length - 1 ? 0 : i + 1))
  }

  function close(): void {
    setClosedQuery(queryKey)
    setSelectedIndex(0)
  }

  return {
    suggestions,
    isOpen,
    selectedIndex,
    mode,
    selectSuggestion,
    moveUp,
    moveDown,
    close,
  }
}
