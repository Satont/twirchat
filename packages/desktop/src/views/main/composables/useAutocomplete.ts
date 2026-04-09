import { computed, onMounted, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue'

import type {
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
import type { SevenTVEmote } from '@twirchat/shared/protocol'

import { fuzzyFilter } from '../utils/fuzzyFilter'
import { rpc } from '../main'
import { mentionColorCache } from './useMessageParsing'
import {
  parseToken,
  replaceToken,
  type AutocompleteSuggestion,
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
}): {
  suggestions: ComputedRef<AutocompleteSuggestion[]>
  isOpen: ComputedRef<boolean>
  selectedIndex: Ref<number>
  mode: ComputedRef<'mention' | 'emote' | null>
  selectSuggestion: (index: number) => void
  moveUp: () => void
  moveDown: () => void
  close: () => void
} {
  const { text, messages, watchedChannel, statuses } = params

  const emoteCache = ref<Map<string, SevenTVEmote[]>>(new Map())
  const closedQuery = ref('')
  const selectedIndex = ref(0)

  const token = computed(() => parseToken(text.value))
  const mode = computed(() => token.value.mode)
  const query = computed(() => token.value.query)

  const mentionSuggestions = computed((): MentionSuggestion[] => {
    const seen = new Set<string>()
    const result: MentionSuggestion[] = []

    for (const msg of messages.value) {
      const lower = msg.author.displayName.toLowerCase()
      if (seen.has(lower)) continue
      seen.add(lower)

      result.push({
        type: 'mention',
        label: msg.author.displayName,
        color: mentionColorCache.get(`${msg.platform}:${lower}`) ?? null,
      })
    }

    return result
  })

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

    const emotes = emoteCache.value.get(`${ch.platform}:${ch.channelId}`) ?? []

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

    if (!m || !q) return []

    if (m === 'mention') {
      return fuzzyFilter(mentionSuggestions.value, q).slice(0, 15) as AutocompleteSuggestion[]
    }

    return fuzzyFilter(emoteSuggestions.value, q).slice(0, 15) as AutocompleteSuggestion[]
  })

  const isOpen = computed(() => suggestions.value.length > 0 && query.value !== closedQuery.value)

  watch(text, () => {
    closedQuery.value = ''
  })

  async function loadEmotes(platform: string, channelId: string): Promise<void> {
    const key = `${platform}:${channelId}`
    if (emoteCache.value.has(key)) return

    try {
      const emotes = await rpc.request.getChannelEmotes({
        platform: platform as Platform,
        channelId,
      })
      const next = new Map(emoteCache.value)
      next.set(key, emotes)
      emoteCache.value = next
    } catch (err) {
      console.warn('[useAutocomplete] Failed to load emotes:', platform, channelId, err)
    }
  }

  watch(
    watchedChannel,
    (wc: WatchedChannel | null | undefined) => {
      if (wc) {
        void loadEmotes(wc.platform, wc.channelSlug)
      }
    },
    { immediate: false },
  )

  function onEmotesSet(payload: { platform: Platform; channelId: string; emotes: SevenTVEmote[] }) {
    const key = `${payload.platform}:${payload.channelId}`
    const next = new Map(emoteCache.value)
    next.set(key, payload.emotes)
    emoteCache.value = next
  }

  function onEmoteAdded(payload: { platform: Platform; channelId: string; emote: SevenTVEmote }) {
    const key = `${payload.platform}:${payload.channelId}`
    const next = new Map(emoteCache.value)
    next.set(key, [...(emoteCache.value.get(key) ?? []), payload.emote])
    emoteCache.value = next
  }

  function onEmoteRemoved(payload: { platform: Platform; channelId: string; emoteId: string }) {
    const key = `${payload.platform}:${payload.channelId}`
    const existing = emoteCache.value.get(key)
    if (!existing) return
    const next = new Map(emoteCache.value)
    next.set(
      key,
      existing.filter((e: SevenTVEmote) => e.id !== payload.emoteId),
    )
    emoteCache.value = next
  }

  function onEmoteUpdated(payload: {
    platform: Platform
    channelId: string
    emoteId: string
    newAlias: string
  }) {
    const key = `${payload.platform}:${payload.channelId}`
    const existing = emoteCache.value.get(key)
    if (!existing) return
    const next = new Map(emoteCache.value)
    next.set(
      key,
      existing.map((e: SevenTVEmote) => {
        if (e.id !== payload.emoteId) return e
        return Object.assign({}, e, { alias: payload.newAlias })
      }),
    )
    emoteCache.value = next
  }

  onMounted(() => {
    rpc.addMessageListener('channel_emotes_set', onEmotesSet)
    rpc.addMessageListener('channel_emote_added', onEmoteAdded)
    rpc.addMessageListener('channel_emote_removed', onEmoteRemoved)
    rpc.addMessageListener('channel_emote_updated', onEmoteUpdated)

    const ch = getCurrentChannelKey()
    if (ch) {
      void loadEmotes(ch.platform, ch.channelId)
    }
  })

  onUnmounted(() => {
    rpc.removeMessageListener('channel_emotes_set', onEmotesSet)
    rpc.removeMessageListener('channel_emote_added', onEmoteAdded)
    rpc.removeMessageListener('channel_emote_removed', onEmoteRemoved)
    rpc.removeMessageListener('channel_emote_updated', onEmoteUpdated)
  })

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
    closedQuery.value = query.value
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
