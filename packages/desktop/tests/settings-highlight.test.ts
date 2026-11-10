import { describe, expect, test } from 'bun:test'

import { highlightParts } from '../src/gpuix/settings-highlight'

const render = (text: string, query: string) =>
  highlightParts(text, query)
    .map((part) => (part.highlighted ? `[${part.text}]` : part.text))
    .join('')

describe('settings search highlighting', () => {
  test('highlights the matched word prefix and leaves the rest untouched', () => {
    expect(render('Translation', 'trans')).toBe('[Trans]lation')
    expect(render('Translation', 'TRANSLATION')).toBe('[Translation]')
    expect(render('Azure region', 'azure')).toBe('[Azure] region')
  })

  test('matches every word independently, like the section search', () => {
    expect(render('Ctrl+Tab', 'ctrl tab')).toBe('[Ctrl]+[Tab]')
    expect(render('Save changes', 'save')).toBe('[Save] changes')
    expect(render('overlay.port', 'overlay port')).toBe('[overlay].[port]')
  })

  test('ignores case and diacritics', () => {
    expect(render('Übersetzung', 'uber')).toBe('[Über]setzung')
    expect(render('Перевод', 'ПЕРЕВ')).toBe('[Перев]од')
    expect(render('cafe\u0301', 'cafe')).toBe('[cafe\u0301]')
  })

  test('only highlights whole-word prefixes, not arbitrary substrings', () => {
    expect(render('Translation', 'lation')).toBe('Translation')
    expect(render('interaction', 'action')).toBe('interaction')
  })

  test('returns one plain part when the query is empty or has no match', () => {
    expect(highlightParts('Translation', '')).toEqual([{ text: 'Translation', highlighted: false }])
    expect(highlightParts('Translation', '+++')).toEqual([
      { text: 'Translation', highlighted: false },
    ])
    expect(highlightParts('Translation', 'missing')).toEqual([
      { text: 'Translation', highlighted: false },
    ])
  })

  test('keeps adjacent matches and the text around them in order', () => {
    expect(render('ffz ffz', 'ffz')).toBe('[ffz] [ffz]')
    expect(render('Save the save', 'save')).toBe('[Save] the [save]')
  })
})
