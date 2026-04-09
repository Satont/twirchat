import { describe, expect, test } from 'bun:test'

import {
  parseToken,
  replaceToken,
  type EmoteSuggestion,
  type MentionSuggestion,
} from '../src/views/main/utils/autocompleteUtils'

describe('parseToken', () => {
  test('detects mention mode for "@sa"', () => {
    const result = parseToken('hello @sa')
    expect(result.mode).toBe('mention')
    expect(result.query).toBe('sa')
  })

  test('detects emote mode for ":pe"', () => {
    const result = parseToken('test :pe')
    expect(result.mode).toBe('emote')
    expect(result.query).toBe('pe')
  })

  test('returns null mode for plain text', () => {
    const result = parseToken('hello world')
    expect(result.mode).toBeNull()
    expect(result.query).toBe('')
  })

  test('returns null mode for "@" alone (no chars after)', () => {
    const result = parseToken('hello @')
    expect(result.mode).toBeNull()
    expect(result.query).toBe('')
  })

  test('returns null mode for ":" alone (no chars after)', () => {
    const result = parseToken('hello :')
    expect(result.mode).toBeNull()
    expect(result.query).toBe('')
  })

  test('uses last word, ignores earlier tokens', () => {
    const result = parseToken('@ignore later :emote')
    expect(result.mode).toBe('emote')
    expect(result.query).toBe('emote')
  })

  test('extracts full query after trigger char', () => {
    const result = parseToken('@satont')
    expect(result.mode).toBe('mention')
    expect(result.query).toBe('satont')
  })
})

describe('replaceToken', () => {
  test('replaces mention token with selected displayName + space', () => {
    const suggestion: MentionSuggestion = { type: 'mention', label: 'satont', color: null }
    const result = replaceToken('hello @sa', suggestion)
    expect(result).toBe('hello @satont ')
  })

  test('replaces emote token with alias (no colon) + space', () => {
    const suggestion: EmoteSuggestion = {
      type: 'emote',
      label: 'pepeHands',
      imageUrl: 'https://example.com/pepehands.webp',
      animated: false,
    }
    const result = replaceToken('test :pe', suggestion)
    expect(result).toBe('test pepeHands ')
  })

  test('replaces token at end of longer text', () => {
    const suggestion: MentionSuggestion = { type: 'mention', label: 'alice', color: '#f00' }
    const result = replaceToken('hey there @al', suggestion)
    expect(result).toBe('hey there @alice ')
  })

  test('handles emote at end of sentence', () => {
    const suggestion: EmoteSuggestion = {
      type: 'emote',
      label: 'KEKW',
      imageUrl: 'https://example.com/kekw.webp',
      animated: true,
    }
    const result = replaceToken('lol :kek', suggestion)
    expect(result).toBe('lol KEKW ')
  })

  test('returns original text when no token found', () => {
    const suggestion: MentionSuggestion = { type: 'mention', label: 'nobody', color: null }
    const result = replaceToken('no trigger here', suggestion)
    expect(result).toBe('no trigger here')
  })

  test('replaces full mention token including partial name', () => {
    const suggestion: MentionSuggestion = {
      type: 'mention',
      label: 'testUser',
      color: null,
    }
    const result = replaceToken('@t', suggestion)
    expect(result).toBe('@testUser ')
  })

  test('suggestion type determines which regex is used (mention uses @)', () => {
    const mentionSuggestion: MentionSuggestion = {
      type: 'mention',
      label: 'myuser',
      color: null,
    }
    const result = replaceToken('text @my', mentionSuggestion)
    expect(result).toStartWith('text @myuser')
  })
})

describe('parseToken edge cases', () => {
  test('empty string returns null mode', () => {
    const result = parseToken('')
    expect(result.mode).toBeNull()
    expect(result.query).toBe('')
  })

  test('whitespace only returns null mode', () => {
    const result = parseToken('   ')
    expect(result.mode).toBeNull()
  })

  test('mention with multiple words before it', () => {
    const result = parseToken('one two three @foo')
    expect(result.mode).toBe('mention')
    expect(result.query).toBe('foo')
  })

  test('emote with multiple words before it', () => {
    const result = parseToken('one two three :bar')
    expect(result.mode).toBe('emote')
    expect(result.query).toBe('bar')
  })
})
