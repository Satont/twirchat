import { expect, test } from 'bun:test'
import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
import { groupEmoteCatalog } from '../src/views/main/utils/emote-catalog'

function emote(source: EmoteCatalogEntry['source'], alias: string): EmoteCatalogEntry {
  return {
    id: `${source}-${alias}`,
    alias,
    name: alias,
    imageUrl: `https://cdn.test/${alias}.webp`,
    animated: false,
    zeroWidth: false,
    aspectRatio: 1,
    source,
  }
}

const entries = [
  emote('global', 'GlobalWave'),
  emote('seventv', 'SevenWave'),
  emote('channel', 'ChannelWave'),
  emote('collectibles', 'CollectibleWave'),
]

test('groups the catalog in the approved source order', () => {
  expect(groupEmoteCatalog(entries, '').map((group) => group.source)).toEqual([
    'channel',
    'seventv',
    'collectibles',
    'global',
  ])
})

test('search removes empty groups while retaining the source order', () => {
  expect(groupEmoteCatalog(entries, 'wave').map((group) => group.source)).toEqual([
    'channel',
    'seventv',
    'collectibles',
    'global',
  ])
  expect(groupEmoteCatalog(entries, 'collect').map((group) => group.source)).toEqual([
    'collectibles',
  ])
})
