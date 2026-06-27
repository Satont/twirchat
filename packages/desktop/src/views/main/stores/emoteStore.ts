import { ref } from 'vue'
import { defineStore } from 'pinia'
import { eventSource } from '../main'

import type { Platform } from '@twirchat/shared/types'
import type { SevenTVEmote } from '@twirchat/shared/protocol'

export const useEmoteStore = defineStore('emotes', () => {
  const emoteMap = ref<Map<string, SevenTVEmote[]>>(new Map())
  const inflight = ref<Map<string, Promise<void>>>(new Map())
  const listenersRegistered = ref(false)

  function _setEmotes(platform: Platform, channelId: string, emotes: SevenTVEmote[]): void {
    const key = `${platform}:${channelId}`
    const next = new Map(emoteMap.value)
    next.set(key, emotes)
    emoteMap.value = next
  }

  function _addEmote(platform: Platform, channelId: string, emote: SevenTVEmote): void {
    const key = `${platform}:${channelId}`
    const next = new Map(emoteMap.value)
    next.set(key, [...(emoteMap.value.get(key) ?? []), emote])
    emoteMap.value = next
  }

  function _removeEmote(platform: Platform, channelId: string, emoteId: string): void {
    const key = `${platform}:${channelId}`
    const existing = emoteMap.value.get(key)
    if (!existing) return

    const next = new Map(emoteMap.value)
    next.set(
      key,
      existing.filter((e: SevenTVEmote) => e.id !== emoteId),
    )
    emoteMap.value = next
  }

  function _updateEmote(
    platform: Platform,
    channelId: string,
    emoteId: string,
    newAlias: string,
  ): void {
    const key = `${platform}:${channelId}`
    const existing = emoteMap.value.get(key)
    if (!existing) return

    const next = new Map(emoteMap.value)
    next.set(
      key,
      existing.map((e: SevenTVEmote) => {
        if (e.id !== emoteId) return e
        return Object.assign({}, e, { alias: newAlias })
      }),
    )
    emoteMap.value = next
  }

  function ensureListeners(): void {
    if (listenersRegistered.value) return
    listenersRegistered.value = true

    eventSource.addEventListener('channel_emotes_set', (e: MessageEvent) => {
      const payload = JSON.parse(e.data)
      _setEmotes(payload.platform, payload.channelId, payload.emotes)
    })
    eventSource.addEventListener('channel_emote_added', (e: MessageEvent) => {
      const payload = JSON.parse(e.data)
      _addEmote(payload.platform, payload.channelId, payload.emote)
    })
    eventSource.addEventListener('channel_emote_removed', (e: MessageEvent) => {
      const payload = JSON.parse(e.data)
      _removeEmote(payload.platform, payload.channelId, payload.emoteId)
    })
    eventSource.addEventListener('channel_emote_updated', (e: MessageEvent) => {
      const payload = JSON.parse(e.data)
      _updateEmote(payload.platform, payload.channelId, payload.emoteId, payload.newAlias)
    })
  }

  function loadEmotes(platform: string, channelId: string): Promise<void> {
    ensureListeners()

    const key = `${platform}:${channelId}`
    const existing = emoteMap.value.get(key)

    if (existing && existing.length > 0) {
      return Promise.resolve()
    }

    if (inflight.value.has(key)) {
      return inflight.value.get(key)!
    }

    const promise = (async () => {
      try {
        const emotes = await bindings.getChannelEmotes({
          platform: platform as Platform,
          channelId,
        })
        if (emotes.length > 0) {
          const next = new Map(emoteMap.value)
          next.set(key, emotes)
          emoteMap.value = next
        }
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
    loadEmotes,
  }
})
