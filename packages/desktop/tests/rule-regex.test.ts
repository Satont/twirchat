import { expect, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { compileFilterExpression } from '../src/gpuix/filter-expression'
import { replaceMessageText } from '../src/gpuix/message-rules'
import { compileRuleRegex } from '../src/gpuix/rule-regex'

test('PCRE captures, lookbehind, backreferences and Unicode word boundaries', () => {
  const regex = compileRuleRegex('(?<=say: )(?<word>\\w+) \\k<word>', true)
  expect(regex.exec('say: Привет привет')).toEqual(['Привет привет', 'Привет'])
  expect(compileRuleRegex('(ab+)+$', false).test('ababb')).toBe(true)
  expect(compileRuleRegex('(?-i:BUILD)', true).test('build')).toBe(false)
  expect(
    compileFilterExpression('(message.content match {r"(?<=id: )(\\d+)", 1}) == "42"').error,
  ).toBeUndefined()
})

test('LRU eviction leaves retained filters usable and recompiles them', () => {
  const first = compileRuleRegex('^retained$', false)
  for (let i = 0; i < 160; i++) compileRuleRegex(`pattern${i}`, false)
  expect(first.test('retained')).toBe(true)
  expect(first.test('pattern159')).toBe(false)
})

test('pathological patterns exhaust bounded PCRE work without blocking chat', () => {
  const start = performance.now()
  expect(compileRuleRegex('(*NO_START_OPT)(a+)+$', false).test('a'.repeat(8191) + '!')).toBe(false)
  expect(
    compileRuleRegex('(*NO_START_OPT)(a|aa)+$', false).matchAll('a'.repeat(8191) + '!'),
  ).toEqual([])
  expect(performance.now() - start).toBeLessThan(250)
})

test('global replacement keeps UTF-16 emote offsets after astral and Cyrillic text', () => {
  const message: NormalizedChatMessage = {
    id: 'm',
    channelId: 'c',
    platform: 'twitch',
    timestamp: new Date(),
    type: 'message',
    author: { id: 'a', displayName: 'A', badges: [] },
    text: '🙂 слово слово Kappa',
    emotes: [{ id: 'k', name: 'Kappa', imageUrl: '', positions: [{ start: 15, end: 19 }] }],
  }
  const result = replaceMessageText(
    message,
    compileRuleRegex('(?<=🙂 )слово|(?<=слово )слово', false),
    'x',
  )
  expect(result.text).toBe('🙂 x x Kappa')
  expect(result.emotes[0]?.positions).toEqual([{ start: 7, end: 11 }])
  expect(
    compileRuleRegex('слово', false)
      .matchAll(message.text)
      .map((m) => m.index),
  ).toEqual([3, 9])
  expect(compileRuleRegex('(?=.)', false).matchAll('a'.repeat(300))).toEqual([])
})
