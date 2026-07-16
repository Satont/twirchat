import { ref } from 'vue'
import { defineStore } from 'pinia'

import type { Platform } from '@twirchat/shared/types'
import type { EmoteCatalogEntry, SevenTVEmote } from '@twirchat/shared/protocol'

import { rpc } from '../services/desktop-api'

export const useEmoteStore = defineStore('emotes', () => {
  const emoteMap = ref<Map<string, EmoteCatalogEntry[]>>(new Map())
  const inflight = ref<Map<string, Promise<void>>>(new Map())
  const sevenTVVersions = ref<Map<string, number>>(new Map())
  const listenersRegistered = ref(false)

  function setCatalog(platform: string, channelId: string, emotes: EmoteCatalogEntry[]): void {
    const key = `${platform}:${channelId}`
    const next = new Map(emoteMap.value)
    next.set(key, emotes)
    emoteMap.value = next
  }

  function sevenTVEntry(emote: SevenTVEmote): EmoteCatalogEntry {
    return { ...emote, source: 'seventv' }
  }

  function markSevenTVMutation(key: string): void {
    const next = new Map(sevenTVVersions.value)
    next.set(key, (next.get(key) ?? 0) + 1)
    sevenTVVersions.value = next
  }

  function setSevenTVEmotes(platform: Platform, channelId: string, emotes: SevenTVEmote[]): void {
    const key = `${platform}:${channelId}`
    markSevenTVMutation(key)
    const existing = emoteMap.value.get(key) ?? []
    setCatalog(platform, channelId, [
      ...existing.filter((entry) => entry.source !== 'seventv'),
      ...emotes.map(sevenTVEntry),
    ])
  }

  function addSevenTVEmote(platform: Platform, channelId: string, emote: SevenTVEmote): void {
    const key = `${platform}:${channelId}`
    markSevenTVMutation(key)
    const existing = emoteMap.value.get(key) ?? []
    setCatalog(platform, channelId, [
      ...existing.filter((entry) => entry.source !== 'seventv' || entry.id !== emote.id),
      sevenTVEntry(emote),
    ])
  }

  function removeSevenTVEmote(platform: Platform, channelId: string, emoteId: string): void {
    const key = `${platform}:${channelId}`
    markSevenTVMutation(key)
    const existing = emoteMap.value.get(key)
    if (!existing) return

    setCatalog(
      platform,
      channelId,
      existing.filter((entry) => entry.source !== 'seventv' || entry.id !== emoteId),
    )
  }

  function updateSevenTVEmote(
    platform: Platform,
    channelId: string,
    emoteId: string,
    newAlias: string,
  ): void {
    const key = `${platform}:${channelId}`
    markSevenTVMutation(key)
    const existing = emoteMap.value.get(key)
    if (!existing) return

    setCatalog(
      platform,
      channelId,
      existing.map((entry) => {
        if (entry.source !== 'seventv' || entry.id !== emoteId) return entry
        return Object.assign({}, entry, { alias: newAlias })
      }),
    )
  }

  function ensureListeners(): void {
    if (listenersRegistered.value) return
    listenersRegistered.value = true

    rpc.addMessageListener('channel_emotes_set', (payload) =>
      setSevenTVEmotes(payload.platform, payload.channelId, payload.emotes),
    )
    rpc.addMessageListener('channel_emote_added', (payload) =>
      addSevenTVEmote(payload.platform, payload.channelId, payload.emote),
    )
    rpc.addMessageListener('channel_emote_removed', (payload) =>
      removeSevenTVEmote(payload.platform, payload.channelId, payload.emoteId),
    )
    rpc.addMessageListener('channel_emote_updated', (payload) =>
      updateSevenTVEmote(payload.platform, payload.channelId, payload.emoteId, payload.newAlias),
    )
  }

  function loadEmotes(platform: string, channelId: string, useSessionCache = true): Promise<void> {
    ensureListeners()

    const key = `${platform}:${channelId}`
    if (useSessionCache && emoteMap.value.has(key)) {
      return Promise.resolve()
    }

    if (inflight.value.has(key)) {
      return inflight.value.get(key)!
    }

    const sevenTVVersion = sevenTVVersions.value.get(key) ?? 0

    const promise = (async () => {
      try {
        const emotes = await rpc.request.getChannelEmotes({
          platform: platform as Platform,
          channelId,
        })
        const liveSevenTV =
          sevenTVVersions.value.get(key) === sevenTVVersion
            ? undefined
            : (emoteMap.value.get(key) ?? []).filter((entry) => entry.source === 'seventv')
        setCatalog(platform, channelId, [
          ...emotes.filter((entry) => entry.source !== 'seventv'),
          ...(liveSevenTV ?? emotes.filter((entry) => entry.source === 'seventv')),
        ])
      } catch (err) {
        console.warn('[useEmoteStore] Failed to load emotes:', platform, channelId, err)
      } finally {
        inflight.value.delete(key)
      }
    })()

    inflight.value.set(key, promise)
    return promise
  }

  return {
    emoteMap,
    inflight,
    listenersRegistered,
    ensureListeners,
    setCatalog,
    setSevenTVEmotes,
    addSevenTVEmote,
    removeSevenTVEmote,
    updateSevenTVEmote,
    loadEmotes,
  }
})
