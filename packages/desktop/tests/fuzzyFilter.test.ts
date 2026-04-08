import { describe, expect, test } from 'bun:test'
import { fuzzyFilter } from '../src/views/main/utils/fuzzyFilter'

describe('fuzzyFilter', () => {
  test('empty query returns all items unchanged', () => {
    const items = [{ label: 'home' }, { label: 'channel1' }]

    expect(fuzzyFilter(items, '')).toEqual(items)
  })

  test("query 'hm' matches 'home' but not 'ch1'", () => {
    const items = [{ label: 'home' }, { label: 'ch1' }]

    expect(fuzzyFilter(items, 'hm')).toEqual([{ label: 'home' }])
  })

  test('matches case-insensitively', () => {
    const items = [{ label: 'home' }]

    expect(fuzzyFilter(items, 'HOME')).toEqual([{ label: 'home' }])
  })

  test("sorts 'channel1' before 'mychannels' for query 'ch'", () => {
    const items = [{ label: 'mychannels' }, { label: 'channel1' }]

    expect(fuzzyFilter(items, 'ch')).toEqual([{ label: 'channel1' }, { label: 'mychannels' }])
  })

  test('no match returns empty array', () => {
    const items = [{ label: 'home' }, { label: 'channel1' }]

    expect(fuzzyFilter(items, 'zzz')).toEqual([])
  })

  test('unicode characters do not throw', () => {
    const items = [{ label: 'héllo' }, { label: 'こんにちは' }]

    expect(() => fuzzyFilter(items, 'hé')).not.toThrow()
  })
})
