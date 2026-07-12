import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

import type {
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
import type { SevenTVEmote } from '@twirchat/shared/protocol'

import { fuzzyFilter } from '../utils/fuzzyFilter'
import { mentionColorCache } from './useMessageParsing'
import { useEmoteStore } from '../stores/emoteStore'
import {
  parseToken,
  replaceToken,
  type AutocompleteSuggestion,
  type CommandSuggestion,
  type EmoteSuggestion,
  type MentionSuggestion,
  type ParsedToken,
} from '../utils/autocompleteUtils'

export type { AutocompleteSuggestion, EmoteSuggestion, MentionSuggestion, ParsedToken }
export { parseToken, replaceToken }

export function useAutocomplete(params: {
  text: Ref<string>
  messages: Ref<NormalizedChatMessage[]>
  watchedChannel: Ref<WatchedChannel | null | undefined>
  statuses: Ref<Map<string, PlatformStatusInfo>>
  aliasMap?: Ref<Map<Platform, Map<string, string>>>
}): {
  suggestions: ComputedRef<AutocompleteSuggestion[]>
  isOpen: ComputedRef<boolean>
  selectedIndex: Ref<number>
  mode: ComputedRef<'mention' | 'emote' | 'command' | null>
  selectSuggestion: (index: number) => void
  moveUp: () => void
  moveDown: () => void
  close: () => void
} {
  const { text, messages, watchedChannel, statuses, aliasMap } = params

  const emoteStore = useEmoteStore()
  const closedQuery = ref('')
  const selectedIndex = ref(0)

  const token = computed(() => parseToken(text.value))
  const mode = computed(() => token.value.mode)
  const query = computed(() => token.value.query)
  const queryKey = computed(() => {
    if (mode.value === 'command') {
      return `/${query.value}`
    }

    return query.value
  })

  const mentionSuggestions = computed((): MentionSuggestion[] => {
    const seen = new Set<string>()
    const result: MentionSuggestion[] = []

    for (const msg of messages.value) {
      const displayName = msg.author.displayName
      const lower = displayName.toLowerCase()
      const dedupKey = msg.author.id
        ? `${msg.platform}:${msg.author.id}`
        : `${msg.platform}:${lower}`

      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)

      const alias = msg.author.id
        ? aliasMap?.value.get(msg.platform)?.get(msg.author.id)
        : undefined

      result.push({
        type: 'mention',
        label: alias || displayName,
        insertLabel: displayName,
        color: mentionColorCache.get(`${msg.platform}:${lower}`) ?? null,
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
  })

  const commandSuggestions = computed((): CommandSuggestion[] => [
    {
      type: 'command',
      label: '/user',
      insertText: '/user',
      description: 'Open user card',
    },
  ])

  function getCurrentChannelKey(): { platform: string; channelId: string } | null {
    const wc = watchedChannel.value
    if (wc) {
      return { platform: wc.platform, channelId: wc.channelSlug }
    }

    for (const [_key, info] of statuses.value) {
      if (info.channelLogin && info.status === 'connected') {
        return { platform: info.platform, channelId: info.channelLogin }
      }
    }

    return null
  }

  const emoteSuggestions = computed((): EmoteSuggestion[] => {
    const ch = getCurrentChannelKey()
    if (!ch) return []

    const emotes = emoteStore.emoteMap.get(`${ch.platform}:${ch.channelId}`) ?? []

    return emotes.map(
      (e: SevenTVEmote): EmoteSuggestion => ({
        type: 'emote',
        label: e.alias,
        imageUrl: e.imageUrl,
        animated: e.animated,
      }),
    )
  })

  const suggestions = computed((): AutocompleteSuggestion[] => {
    const m = mode.value
    const q = query.value

    if (!m) return []

    if (m === 'command') {
      if (!q) {
        return commandSuggestions.value.slice(0, 15)
      }

      return fuzzyFilter(commandSuggestions.value, q).slice(0, 15) as AutocompleteSuggestion[]
    }

    if (!q) return []

    if (m === 'mention') {
      return fuzzyFilter(mentionSuggestions.value, q).slice(0, 15) as AutocompleteSuggestion[]
    }

    return fuzzyFilter(emoteSuggestions.value, q).slice(0, 15) as AutocompleteSuggestion[]
  })

  const isOpen = computed(
    () => suggestions.value.length > 0 && queryKey.value !== closedQuery.value,
  )

  watch(text, () => {
    closedQuery.value = ''
  })

  watch(
    watchedChannel,
    (wc: WatchedChannel | null | undefined) => {
      if (wc) {
        void emoteStore.loadEmotes(wc.platform, wc.channelSlug)
      }
    },
    { immediate: true },
  )

  watch(
    statuses,
    () => {
      if (watchedChannel.value) return

      const ch = getCurrentChannelKey()
      if (ch) {
        void emoteStore.loadEmotes(ch.platform, ch.channelId)
      }
    },
    { immediate: true },
  )

  function selectSuggestion(index: number): void {
    const s = suggestions.value[index]
    if (!s) return
    text.value = replaceToken(text.value, s)
    selectedIndex.value = 0
    closedQuery.value = ''
  }

  function moveUp(): void {
    const len = suggestions.value.length
    if (len === 0) return
    selectedIndex.value = selectedIndex.value <= 0 ? len - 1 : selectedIndex.value - 1
  }

  function moveDown(): void {
    const len = suggestions.value.length
    if (len === 0) return
    selectedIndex.value = selectedIndex.value >= len - 1 ? 0 : selectedIndex.value + 1
  }

  function close(): void {
    closedQuery.value = queryKey.value
    selectedIndex.value = 0
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
