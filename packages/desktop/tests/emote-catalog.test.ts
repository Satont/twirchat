import { expect, test } from 'bun:test'

import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'

import {
  applyLiveEmoteLocks,
  filterEmoteEntries,
  groupEmoteCatalog,
} from '../src/views/main/utils/emote-catalog'

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

test('keeps the Global, 7TV, FFZ and BTTV tabs even when the catalog is empty', () => {
  expect(groupEmoteCatalog([]).map((group) => group.label)).toEqual([
    'Global',
    '7TV',
    'FFZ',
    'BTTV',
  ])
})

test('includes provider globals in both Global and their provider tab', () => {
  const groups = groupEmoteCatalog([
    emote('global', 'TwitchGlobal'),
    { ...emote('global', 'SevenGlobal'), provider: 'seventv' },
    { ...emote('global', 'FrankerGlobal'), imageUrl: 'https://cdn.frankerfacez.com/emote/1/1' },
    { ...emote('global', 'BetterGlobal'), provider: 'bttv' },
    emote('channel', 'TwitchChannel'),
    emote('seventv', 'SevenChannel'),
    { ...emote('channel', 'LegacySevenChannel'), imageUrl: 'https://cdn.7tv.app/emote/1/1x.webp' },
    emote('ffz', 'FrankerChannel'),
    emote('bttv', 'BetterChannel'),
    emote('collectibles', 'Collectible'),
    emote('personal', 'Personal'),
  ])
  expect(groups.map(({ label, entries }) => [label, entries.map((entry) => entry.alias)])).toEqual([
    ['Channel', ['TwitchChannel', 'LegacySevenChannel']],
    ['Global', ['TwitchGlobal', 'SevenGlobal', 'FrankerGlobal', 'BetterGlobal']],
    ['7TV', ['SevenGlobal', 'SevenChannel', 'LegacySevenChannel']],
    ['FFZ', ['FrankerGlobal', 'FrankerChannel']],
    ['BTTV', ['BetterGlobal', 'BetterChannel']],
    ['Collectibles', ['Collectible']],
    ['Personal', ['Personal']],
  ])
})

test('filters tab entries by fuzzy alias without changing the tab order', () => {
  const groups = groupEmoteCatalog([emote('ffz', 'FrankerWave'), emote('ffz', 'FrankerStop')])
  expect(groups.map(({ label, entries }) => [label, filterEmoteEntries(entries, 'fwa')])).toEqual([
    ['Global', []],
    ['7TV', []],
    ['FFZ', [emote('ffz', 'FrankerWave')]],
    ['BTTV', []],
  ])
})

test('reflects live channel locks on favorite copies', () => {
  const favorite = { ...emote('channel', 'SubWave'), alias: 'SavedName' }
  const unlocked = { ...emote('channel', 'FreeWave') }
  const catalog = [{ ...emote('channel', 'SubWave'), locked: true }, emote('channel', 'FreeWave')]
  expect(applyLiveEmoteLocks([favorite, unlocked], catalog)).toEqual([
    { ...favorite, locked: true },
    unlocked,
  ])
})
