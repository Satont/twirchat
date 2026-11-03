import { afterEach, expect, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import {
  classifyIncomingSimilarity,
  getMessageSimilarity,
  hydrateSimilarityHistory,
  messageSimilarityStore,
  resetSimilarityHistory,
  similarityRevisionStore,
} from '../src/gpuix/state/message-similarity'
import {
  createMessageSimilarityClassifier,
  DEFAULT_MESSAGE_SIMILARITY_SETTINGS,
  exceedsMessageSimilarity,
  messageSimilarityScore,
  similarityChannelKey,
  validateMessageSimilaritySettings,
} from '../src/services/message-similarity'
import { literal, required } from './fixture-values'
const settings = { ...DEFAULT_MESSAGE_SIMILARITY_SETTINGS, enabled: true }
const message = (
  id: string,
  text = 'same text',
  time = 0,
  username = 'viewer',
  extra: Partial<NormalizedChatMessage> = {},
): NormalizedChatMessage => ({
  id,
  platform: 'twitch',
  channelId: 'channel',
  author: { id: username, username, displayName: username, badges: [] },
  text,
  timestamp: new Date(time),
  type: 'message',
  emotes: [],
  ...extra,
})
const initial = messageSimilarityStore.get()
afterEach(() => {
  resetSimilarityHistory()
  messageSimilarityStore.set(initial)
})

test('scores longest common contiguous raw UTF-16 substring, not subsequence or normalized text', () => {
  expect(messageSimilarityScore('abcXdef', 'abcYdef')).toBe(3 / 7)
  expect(messageSimilarityScore('', '')).toBe(0)
  expect(messageSimilarityScore('ABC', 'abc')).toBe(0)
  expect(messageSimilarityScore('a  b', 'a b')).toBe(0.5)
  expect(messageSimilarityScore('😀a', '😁a')).toBe(1 / 3)
  for (const [left, right] of [
    ['same', 'same'],
    ['abcde', 'xbcdy'],
    ['abc', 'ABC'],
    ['😀a', '😁a'],
    ['', ''],
  ]) {
    for (const threshold of [0, 0.1, 0.5, 0.9, 1])
      expect(exceedsMessageSimilarity(required(left), required(right), threshold)).toBe(
        messageSimilarityScore(required(left), required(right)) > threshold,
      )
  }
})
test('threshold and whole-second delay comparisons are strictly upstream compatible', () => {
  const exact = createMessageSimilarityClassifier({ ...settings, threshold: 0.9 })
  exact.classifyIncoming(message('1', '123456789X', 0))
  expect(exact.classifyIncoming(message('2', '123456789Y', 100)).similar).toBe(false)
  const age = createMessageSimilarityClassifier(settings)
  age.classifyIncoming(message('a', 'same text', 0))
  expect(age.classifyIncoming(message('b', 'same text', 4999)).similar).toBe(true)
  const expired = createMessageSimilarityClassifier(settings)
  expired.classifyIncoming(message('a', 'same text', 0))
  expect(expired.classifyIncoming(message('b', 'same text', 5000)).similar).toBe(false)
})
test('takes underlying preceding messages before filtering users and stops at the first expired record', () => {
  const classifier = createMessageSimilarityClassifier(settings)
  classifier.hydrate('channel', [
    message('a', 'different', 4900, 'other'),
    message('b', 'different', 4800, 'other'),
    message('c', 'different', 4700, 'other'),
    message('d', 'same text', 4600),
  ])
  expect(
    classifier.classifyIncoming(message('incoming', 'same text', 5000), 'channel').similar,
  ).toBe(false)
  classifier.reset('channel')
  classifier.hydrate('channel', [
    message('old', 'different', 0),
    message('newer-behind-old', 'same text', 100),
  ])
  expect(classifier.classifyIncoming(message('later', 'same text', 6000), 'channel').similar).toBe(
    false,
  )
})
test('own exclusion is platform aware, systems occupy history but never receive Similar flags', () => {
  const own = [{ platform: literal('twitch'), platformUserId: 'same-id', username: 'own' }]
  const classifier = createMessageSimilarityClassifier(settings, own)
  classifier.classifyIncoming(
    message('first', 'same text', 0, 'own', {
      author: { id: 'same-id', username: 'own', displayName: 'Own', badges: [] },
    }),
  )
  expect(
    classifier.classifyIncoming(
      message('second', 'same text', 100, 'own', {
        author: { id: 'same-id', username: 'own', displayName: 'Own', badges: [] },
      }),
    ).similar,
  ).toBe(false)
  classifier.classifyIncoming(message('kick1', 'same text', 0, 'own', { platform: 'kick' }))
  expect(
    classifier.classifyIncoming(message('kick2', 'same text', 100, 'own', { platform: 'kick' }))
      .similar,
  ).toBe(true)
  expect(
    classifier.classifyIncoming(
      message('system', 'same text', 200, 'own', { platform: 'kick', type: 'system' }),
    ).similar,
  ).toBe(false)
})
test('duplicate events never occupy another history slot or reclassify their immutable flag', () => {
  const classifier = createMessageSimilarityClassifier({ ...settings, maxMessages: 1 })
  const first = message('1')
  expect(classifier.classifyIncoming(first).similar).toBe(false)
  expect(classifier.classifyIncoming(first).similar).toBe(false)
  expect(classifier.classifyIncoming(message('2', 'different', 100, 'other')).similar).toBe(false)
  expect(classifier.classifyIncoming(message('3', 'same text', 200)).similar).toBe(false)
})
test('hidden messages never alert, presentation flags follow settings without reclassifying similarity', () => {
  messageSimilarityStore.update({ value: { ...settings, shownSimilarTriggerHighlights: true } })
  classifyIncomingSimilarity(message('one'))
  const second = message('two', 'same text', 100)
  classifyIncomingSimilarity(second)
  expect(getMessageSimilarity(second)).toEqual({
    similar: true,
    gray: true,
    triggerHighlights: true,
  })
  messageSimilarityStore.update({
    value: {
      ...settings,
      enabled: false,
      hideSimilar: true,
      graySimilar: false,
      shownSimilarTriggerHighlights: true,
    },
  })
  expect(getMessageSimilarity(second)).toEqual({
    similar: true,
    gray: false,
    triggerHighlights: false,
  })
})
test('cold snapshot hydration classifies unknown messages once and preserves newer live arrival history', () => {
  messageSimilarityStore.update({ value: settings })
  const old = message('old', 'old text', 1000)
  const repeat = message('repeat', 'old text', 1100)
  const live = message('live', 'new live text', 10000)
  const channel = similarityChannelKey(live)
  classifyIncomingSimilarity(live)
  const before = similarityRevisionStore.get()
  hydrateSimilarityHistory(channel, [repeat, old])
  expect(getMessageSimilarity(repeat)?.similar).toBe(true)
  expect(getMessageSimilarity(live)?.similar).toBe(false)
  expect(classifyIncomingSimilarity(message('next', 'new live text', 10100)).similar).toBe(true)
  expect(similarityRevisionStore.get()).toBe(before + 1)
  messageSimilarityStore.update({ value: { ...settings, threshold: 1 } })
  hydrateSimilarityHistory(channel, [repeat, old])
  expect(getMessageSimilarity(repeat)?.similar).toBe(true)
})
test('fresh incoming flags do not fan out global UI notifications', () => {
  const before = similarityRevisionStore.get()
  classifyIncomingSimilarity(message('fresh'))
  expect(similarityRevisionStore.get()).toBe(before)
})
test('settings validation rejects unbounded history and invalid thresholds', () => {
  expect(() => validateMessageSimilaritySettings({ ...settings, maxMessages: 101 })).toThrow()
  expect(() => validateMessageSimilaritySettings({ ...settings, threshold: NaN })).toThrow()
  expect(() => validateMessageSimilaritySettings({ ...settings, delaySeconds: -1 })).toThrow()
  expect(DEFAULT_MESSAGE_SIMILARITY_SETTINGS).toMatchObject({
    enabled: false,
    hideSimilar: false,
    threshold: 0.9,
    maxMessages: 3,
    delaySeconds: 5,
    sameUserOnly: true,
    excludeOwn: true,
    graySimilar: true,
    shownSimilarTriggerHighlights: false,
  })
})

test('threshold predicate equals exact scores at division boundaries and random UTF-16 pairs', () => {
  let seed = 317
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    return seed >>> 0
  }
  const alphabet = 'abAB 😀'
  for (let index = 0; index < 300; index++) {
    const left = Array.from(
      { length: random() % 25 },
      () => alphabet[random() % alphabet.length],
    ).join('')
    const right = Array.from(
      { length: random() % 25 },
      () => alphabet[random() % alphabet.length],
    ).join('')
    const score = messageSimilarityScore(left, right)
    for (const threshold of [score, Math.max(0, score - Number.EPSILON), 0.9, 1])
      expect(exceedsMessageSimilarity(left, right, threshold)).toBe(score > threshold)
  }
})
test('visibility alone does not enable checks; system rows occupy the limited underlying history', () => {
  const disabled = createMessageSimilarityClassifier({
    ...DEFAULT_MESSAGE_SIMILARITY_SETTINGS,
    hideSimilar: true,
  })
  disabled.classifyIncoming(message('a'))
  expect(disabled.classifyIncoming(message('b', 'same text', 100)).similar).toBe(false)
  const classifier = createMessageSimilarityClassifier({ ...settings, maxMessages: 1 })
  classifier.classifyIncoming(message('a'))
  classifier.classifyIncoming(message('system', 'system row', 100, 'viewer', { type: 'system' }))
  expect(classifier.classifyIncoming(message('b', 'same text', 200)).similar).toBe(false)
})
