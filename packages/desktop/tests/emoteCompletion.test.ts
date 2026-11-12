import { describe, expect, test } from 'bun:test'

import { bareEmoteQuery, rankEmoteMatches } from '../src/views/main/utils/emoteCompletion'

const ranked = (labels: string[], query: string) =>
  rankEmoteMatches(
    labels.map((label) => ({ label })),
    query,
  ).map((item) => item.label)

describe('emote completion ranking', () => {
  test('exact channel alias survives a crowded suggestion cap', () => {
    const catalog = Array.from({ length: 30 }, (_, index) => `Pa${index}alert`)
    expect(ranked([...catalog, 'Paa'], 'Paa').slice(0, 15)[0]).toBe('Paa')
  })

  test('exact, prefix, substring and ordered subsequence are distinct tiers', () => {
    expect(ranked(['P_a_a', 'xPaax', 'PaaLong', 'paa', 'unrelated'], 'Paa')).toEqual([
      'paa',
      'PaaLong',
      'xPaax',
      'P_a_a',
    ])
  })

  test('compact spans win, then matching case and shorter aliases', () => {
    expect(ranked(['P___aa', 'p_aa', 'P_aaLong', 'P_aa'], 'Paa')).toEqual([
      'P_aa',
      'P_aaLong',
      'p_aa',
      'P___aa',
    ])
    expect(ranked(['paa', 'Paa', 'PaaLong', 'paaX'], 'Paa')).toEqual([
      'Paa',
      'paa',
      'PaaLong',
      'paaX',
    ])
  })

  test('preserves favorite and source ordering for equal matches without mutating input', () => {
    const items = [
      { label: 'Paa', source: 'favorite' },
      { label: 'Paa', source: 'channel' },
    ]
    expect(rankEmoteMatches(items, 'paa')).toEqual(items)
    expect(rankEmoteMatches(items, 'paa')[0]).toBe(items[0])
  })

  test('matches unicode code points and rejects missing or out-of-order characters', () => {
    expect(ranked(['😀x猫', '😀猫', '猫😀', '😀'], '😀猫')).toEqual(['😀猫', '😀x猫'])
    expect(ranked(['ПРИВЕТ', 'Привет'], 'Прив')[0]).toBe('Привет')
    expect(ranked(['Paa'], '')).toEqual([])
  })
})

test('bare completion only considers a final plain word', () => {
  expect(bareEmoteQuery('earlier text paa')).toBe('paa')
  expect(bareEmoteQuery('Привет')).toBe('Привет')
  for (const text of ['', 'paa ', ':paa', '@paa', '/paa', '!paa', 'https://paa']) {
    expect(bareEmoteQuery(text)).toBeUndefined()
  }
})
