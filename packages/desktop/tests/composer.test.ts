import { describe, expect, test } from 'bun:test'

import {
  appendComposerMention,
  browseComposerHistory,
  completeComposerSend,
  composerTranslationMode,
  findComposerHistory,
  initialComposerHistoryMatch,
  cycleComposerHistoryMatch,
  composerStore,
  editComposer,
  EMPTY_COMPOSER,
  parseComposerCommand,
  rememberComposerMessage,
  retargetComposerForMention,
  updateComposer,
} from '../src/gpuix/state/composer'
import { literal } from './fixture-values'

describe('composer mentions', () => {
  test('appends a platform mention after the draft with one separating space', () => {
    expect(appendComposerMention('', 'viewer')).toBe('@viewer ')
    expect(appendComposerMention('hello', 'viewer')).toBe('hello @viewer ')
    expect(appendComposerMention('hello ', 'viewer')).toBe('hello @viewer ')
    expect(appendComposerMention('hello\n', 'viewer')).toBe('hello\n@viewer ')
    expect(appendComposerMention('hello', '@Viewer')).toBe('hello @Viewer ')
    expect(appendComposerMention('hello', '  ')).toBe('hello')
  })

  test('retargets the composer to the row platform or feed channel', () => {
    const draft = { ...EMPTY_COMPOSER, text: 'hello' }
    const platform = retargetComposerForMention(draft, { kind: 'platform', platform: 'twitch' })
    expect(platform.activePlatform).toBe('twitch')
    expect(platform.text).toBe('hello')
    expect(retargetComposerForMention(platform, { kind: 'platform', platform: 'twitch' })).toBe(
      platform,
    )
    const watched = retargetComposerForMention(draft, { kind: 'watched', channelId: 'kick:1' })
    expect(watched.activeWatchedChannelId).toBe('kick:1')
    expect(retargetComposerForMention(watched, { kind: 'watched', channelId: 'kick:1' })).toBe(
      watched,
    )
  })
})

describe('composer history', () => {
  test('walks newest to oldest and restores the original unsent draft', () => {
    let state = rememberComposerMessage(EMPTY_COMPOSER, 'first')
    state = rememberComposerMessage(state, 'second')
    state = editComposer(state, 'unfinished message')
    state = browseComposerHistory(state, -1)
    expect(state.text).toBe('second')
    state = browseComposerHistory(state, -1)
    expect(state.text).toBe('first')
    expect(browseComposerHistory(state, -1)).toBe(state)
    state = browseComposerHistory(state, 1)
    expect(state.text).toBe('second')
    state = browseComposerHistory(state, 1)
    expect(state.text).toBe('unfinished message')
    expect(state.historyIndex).toBeNull()
    expect(state.savedDraft).toBeNull()
    expect(browseComposerHistory(state, 1)).toBe(state)
  })

  test('editing recalled text exits browsing while preserving the original draft', () => {
    let state = rememberComposerMessage(EMPTY_COMPOSER, 'sent')
    state = editComposer(state, 'original draft')
    state = browseComposerHistory(state, -1)
    state = editComposer(state, 'edited recalled message')
    expect(state.historyIndex).toBeNull()
    expect(state.text).toBe('edited recalled message')
    expect(browseComposerHistory(state, 1).text).toBe('original draft')
  })

  test('retains the newest 100 messages and skips consecutive duplicates and empty sends', () => {
    let state = EMPTY_COMPOSER
    for (let i = 0; i < 110; i++) state = rememberComposerMessage(state, `message ${i}`)
    state = rememberComposerMessage(state, ' message 109 ')
    state = rememberComposerMessage(state, ' ')
    expect(state.history).toHaveLength(100)
    expect(state.history[0]).toBe('message 10')
    expect(state.history.at(-1)).toBe('message 109')
    state = rememberComposerMessage(state, 'message 10')
    expect(state.history).toHaveLength(100)
    expect(state.history.at(-1)).toBe('message 10')
  })

  test('does not browse an empty history or mutate the shared empty state', () => {
    expect(browseComposerHistory(EMPTY_COMPOSER, -1)).toBe(EMPTY_COMPOSER)
    expect(browseComposerHistory(EMPTY_COMPOSER, 1)).toBe(EMPTY_COMPOSER)
    expect(EMPTY_COMPOSER).toEqual({ text: '', history: [], historyIndex: null, savedDraft: null })
  })

  test('keeps drafts and history independent across panes and survives a store reread', () => {
    const firstKey = 'composer-test:first'
    const secondKey = 'composer-test:second'
    try {
      updateComposer(firstKey, (current) => rememberComposerMessage(current, 'first sent'))
      updateComposer(firstKey, (current) => editComposer(current, 'first draft'))
      updateComposer(secondKey, (current) => editComposer(current, 'second draft'))
      expect(composerStore.get().get(firstKey)?.text).toBe('first draft')
      expect(composerStore.get().get(secondKey)?.text).toBe('second draft')
      expect(composerStore.get().get(secondKey)?.history).toEqual([])
      updateComposer(firstKey, (current) => browseComposerHistory(current, -1))
      expect(composerStore.get().get(firstKey)?.text).toBe('first sent')
      expect(composerStore.get().get(secondKey)?.text).toBe('second draft')
      expect(updateComposer(secondKey, (current) => current)).toBe(false)
    } finally {
      composerStore.modify((current) => {
        const next = new Map(current)
        next.delete(firstKey)
        next.delete(secondKey)
        return next
      })
    }
  })
})

describe('local composer commands', () => {
  test('parses every local command, preserving search phrases and filters', () => {
    for (const name of literal([
      'clearmessages',
      'copy',
      'pause',
      'resume',
      'mentions',
      'search',
      'twirreload',
    ])) {
      expect(parseComposerCommand(` /${name.toUpperCase()} `)).toEqual({ name, argument: '' })
    }
    expect(parseComposerCommand('/search from:satont "hello there"')).toEqual({
      name: 'search',
      argument: 'from:satont "hello there"',
    })
  })

  test('never treats server moderation commands or normal text as local actions', () => {
    for (const text of [
      '/clear',
      '/clear all',
      '/ban user',
      'search',
      'hello /pause',
      '/copycat',
      '/twirreloadextra',
    ]) {
      expect(parseComposerCommand(text)).toBeNull()
    }
    expect(parseComposerCommand('/pause unexpected')).toEqual({
      name: 'pause',
      argument: 'unexpected',
    })
  })
})

describe('incremental sent-message history search', () => {
  const history = ['hello world', 'other message', 'HELLO again', 'world news']
  test('matches substrings without case sensitivity and keeps original history indexes', () => {
    expect(findComposerHistory(history, 'Lo')).toEqual([
      { historyIndex: 0, text: 'hello world' },
      { historyIndex: 2, text: 'HELLO again' },
    ])
    expect(findComposerHistory(history, '')).toEqual([])
    expect(findComposerHistory(history, 'absent')).toEqual([])
  })
  test('anchors each changed query at the original history position in either direction', () => {
    const matches = findComposerHistory(history, 'hello')
    expect(initialComposerHistoryMatch(matches, 1, -1, false)).toBe(0)
    expect(initialComposerHistoryMatch(matches, 1, 1, false)).toBe(1)
    expect(initialComposerHistoryMatch(matches, 2, 1, false)).toBe(1)
    expect(initialComposerHistoryMatch(matches, 4, -1, false)).toBe(1)
    expect(initialComposerHistoryMatch(matches, 4, 1, false)).toBe(2)
    expect(initialComposerHistoryMatch(matches, 4, 1, true)).toBe(0)
  })
  test('cycles both ways with optional wrapping and has explicit exhausted/no-match states', () => {
    expect(cycleComposerHistoryMatch(0, 2, -1, true)).toBe(1)
    expect(cycleComposerHistoryMatch(1, 2, 1, true)).toBe(0)
    expect(cycleComposerHistoryMatch(0, 2, -1, false)).toBe(-1)
    expect(cycleComposerHistoryMatch(-1, 2, -1, false)).toBe(-1)
    expect(cycleComposerHistoryMatch(1, 2, 1, false)).toBe(2)
    expect(cycleComposerHistoryMatch(2, 2, 1, false)).toBe(2)
    expect(cycleComposerHistoryMatch(2, 2, -1, false)).toBe(1)
    expect(cycleComposerHistoryMatch(-1, 0, 1, true)).toBe(-1)
  })
})

describe('composer send snapshot completion', () => {
  test('normal successful sends clear only the submitted draft and remember once', () => {
    const draft = { ...editComposer(EMPTY_COMPOSER, 'sent text'), translateOnSend: true }
    const result = completeComposerSend(draft, 'sent text', { keepInput: false, remember: true })
    expect(result.text).toBe('')
    expect(result.history).toEqual(['sent text'])
    expect(result.translateOnSend).toBe(true)
    expect(
      completeComposerSend(result, 'sent text', { keepInput: false, remember: true }).history,
    ).toEqual(['sent text'])
  })
  test('keepInput preserves draft and history navigation through preview confirmation', () => {
    let state = rememberComposerMessage(EMPTY_COMPOSER, 'previous')
    state = editComposer(state, 'unsent draft')
    state = browseComposerHistory(state, -1)
    const result = completeComposerSend(state, 'previous', { keepInput: true, remember: true })
    expect(result.text).toBe('previous')
    expect(result.historyIndex).toBe(state.historyIndex)
    expect(result.savedDraft).toBe('unsent draft')
    expect(browseComposerHistory(result, 1).text).toBe('unsent draft')
  })
  test('async send completion cannot clear newer edits or an unrelated command-runner draft', () => {
    const current = editComposer(EMPTY_COMPOSER, 'newer draft')
    expect(
      completeComposerSend(current, 'old submission', { keepInput: false, remember: true }).text,
    ).toBe('newer draft')
    const command = completeComposerSend(current, '/hello', { keepInput: true, remember: true })
    expect(command.text).toBe('newer draft')
    expect(command.history).toEqual(['/hello'])
    expect(completeComposerSend(current, '/copy', { keepInput: true, remember: false })).toEqual(
      current,
    )
  })
})

test('composer translation toggle overrides only outgoing translation and preserves preview policy', () => {
  expect(composerTranslationMode({}, 'off')).toBe('off')
  expect(composerTranslationMode({ translateOnSend: true }, 'off')).toBe('send')
  expect(composerTranslationMode({ translateOnSend: true }, 'preview')).toBe('preview')
  expect(composerTranslationMode({ translateOnSend: false }, 'preview')).toBe('off')
})
