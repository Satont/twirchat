import { afterEach, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
import { rpc } from '../src/views/main/services/desktop-api'
import { useEmoteStore } from '../src/views/main/stores/emoteStore'

const originalGetChannelEmotes = rpc.request.getChannelEmotes

afterEach(() => {
  rpc.request.getChannelEmotes = originalGetChannelEmotes
})

function entry(source: EmoteCatalogEntry['source'], id: string): EmoteCatalogEntry {
  return {
    id,
    alias: id,
    name: id,
    imageUrl: `https://cdn.test/${id}.webp`,
    animated: false,
    zeroWidth: false,
    aspectRatio: 1,
    source,
  }
}

test('uses the completed session cache unless the preference requests a reload', async () => {
  let calls = 0
  rpc.request.getChannelEmotes = async () => {
    calls++
    return [entry('seventv', 'seven')]
  }
  setActivePinia(createPinia())
  const store = useEmoteStore()

  await store.loadEmotes('kick', 'channel', true)
  await store.loadEmotes('kick', 'channel', true)
  expect(calls).toBe(1)

  await store.loadEmotes('kick', 'channel', false)
  expect(calls).toBe(2)
})

test('a 7TV removal leaves a same-id channel emote intact', () => {
  setActivePinia(createPinia())
  const store = useEmoteStore()
  store.setCatalog('kick', 'channel', [entry('channel', 'same-id'), entry('seventv', 'same-id')])

  store.removeSevenTVEmote('kick', 'channel', 'same-id')

  expect(store.emoteMap.get('kick:channel')).toEqual([entry('channel', 'same-id')])
})
