import { describe, expect, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import {
  compileFilterExpression,
  compileRuleRegex,
  type FilterContext,
} from '../src/gpuix/filter-expression'

const message: NormalizedChatMessage = {
  id: 'test',
  platform: 'twitch',
  channelId: 'streamer',
  text: 'Hello WORLD 123',
  author: {
    id: '42',
    username: 'Alice',
    displayName: 'Alice',
    color: '#FF0000',
    badges: [{ id: 'vip', type: 'VIP', text: 'VIP' }],
  },
  emotes: [],
  type: 'message',
  timestamp: new Date(),
}
function matches(source: string, value = message, context: FilterContext = {}) {
  const compiled = compileFilterExpression(source)
  expect(compiled.error).toBeUndefined()
  return compiled.matches(value, context)
}

describe('Chatterino filter language', () => {
  test('evaluates arithmetic left to right, with parentheses and truncated integer division', () => {
    expect(matches('2 + 3 * 4 == 20')).toBe(true)
    expect(matches('2 + 3 * 4 == 14')).toBe(false)
    expect(matches('2 + (3 * 4) == 14')).toBe(true)
    expect(matches('10 / 3 == 3 && 10 % 3 == 1')).toBe(true)
    expect(matches('10 / 0 == 3')).toBe(false)
  })

  test('negates the whole condition and gives AND priority over OR', () => {
    expect(matches('!message.content contains "spam"')).toBe(true)
    expect(matches('!message.length > 3')).toBe(false)
    expect(matches('flags.action || message.length > 3 && !flags.reply')).toBe(true)
    expect(matches('(flags.action || message.length > 3) && flags.reply')).toBe(false)
    expect(matches('!!message.length > 3')).toBe(true)
  })

  test('strings compare case-insensitively while literal list membership preserves case', () => {
    expect(matches('author.name == "alice"')).toBe(true)
    expect(matches('author.name != "ALICE"')).toBe(false)
    expect(matches('message.content startswith "hello" && message.content endswith "123"')).toBe(
      true,
    )
    expect(matches('message.content contains "world"')).toBe(true)
    expect(matches('{"Alice", "Bob"} contains author.name')).toBe(true)
    expect(matches('{"alice", "Bob"} contains author.name')).toBe(false)
    expect(matches('author.badges contains "vip"')).toBe(true)
    expect(matches('author.badges == {"VIP"}')).toBe(true)
    expect(
      matches('author.badges == {}', { ...message, author: { ...message.author, badges: [] } }),
    ).toBe(true)
    expect(
      matches('author.external_badges startswith "FOUNDATION"', message, {
        externalBadges: ['foundation'],
      }),
    ).toBe(true)
    expect(matches('{} == {}')).toBe(true)
  })

  test('supports list values, scalar conversions, colors and string concatenation', () => {
    expect(matches('{123, author.name} endswith "Alice"')).toBe(true)
    expect(matches('1 == "01"')).toBe(true)
    expect(matches('"01" == 1')).toBe(false)
    expect(matches('author.color == "#ff0000"')).toBe(true)
    expect(matches('!author.no_color')).toBe(true)
    expect(matches('"length=" + message.length == "length=15"')).toBe(true)
  })

  test('supports case-sensitive/insensitive regex literals and numbered capture extraction', () => {
    expect(matches('message.content match r"WORLD"')).toBe(true)
    expect(matches('message.content match r"world"')).toBe(false)
    expect(matches('message.content match ri"world"')).toBe(true)
    expect(matches('(message.content match {r"(Hello) (WORLD)", 2}) == "world"')).toBe(true)
    expect(matches('(message.content match {r"missing (text)", 1}) == ""')).toBe(true)
    expect(matches('message.content match r"\\d+"')).toBe(true)
  })

  test('requires a boolean result and typed logical conditions', () => {
    for (const source of [
      '1',
      '"hello"',
      '{}',
      'r"test"',
      '1 && flags.action',
      '!1',
      'true',
      '-1 == 1',
      '1.5 == 1',
    ]) {
      expect(compileFilterExpression(source).error).toBeString()
      expect(compileFilterExpression(source).matches(message)).toBe(false)
    }
    expect(matches('flags.action')).toBe(false)
    expect(matches('!flags.action')).toBe(true)
    expect(compileFilterExpression('author.name < 5').error).toContain('integers')
  })

  test('resolves built-in and fork metadata flags with context overrides', () => {
    const rich = {
      ...message,
      metadata: {
        firstMessage: true,
        bits: 100,
        subscriptionMonths: 12,
        rewardCost: 500,
        rewardId: 'reward',
        rewardTitle: 'Song request',
        clientDetection: 'Chatterino',
        flags: {
          automod: true,
          restricted: true,
          monitored: true,
          sub_message: true,
          watch_streak: true,
          follow_message: true,
          repeated_messages: true,
          webchat_detected: true,
        },
      },
    }
    expect(matches('flags.first_message && flags.cheer_message && bits.amount == 100', rich)).toBe(
      true,
    )
    expect(
      matches(
        'author.sub_length == 12 && reward.cost == 500 && reward.title contains "song"',
        rich,
      ),
    ).toBe(true)
    for (const flag of [
      'automod',
      'restricted',
      'monitored',
      'sub_message',
      'watch_streak',
      'follow_message',
      'repeated_message',
      'repeated_messages',
      'webchat_detected',
    ])
      expect(matches(`flags.${flag}`, rich)).toBe(true)
    for (const fork of ['leafyrino', 'moltorino', 'dankerino'])
      expect(matches(`${fork}.client_detection == "chatterino"`, rich)).toBe(true)
    expect(
      matches('flags.deleted && channel.live && channel.watching', rich, {
        deleted: true,
        channelLive: true,
        channelWatching: true,
      }),
    ).toBe(true)
    expect(matches('author.sub_length == 6', rich, { subscriptionMonths: 6 })).toBe(true)
  })

  test('rejects malformed and excessive expressions with visible errors', () => {
    for (const source of [
      '',
      'missing.variable',
      'message.content contains "unterminated',
      'message.length >',
      '('.repeat(70) + '1 == 1' + ')'.repeat(70),
      ' '.repeat(8193),
    ])
      expect(compileFilterExpression(source).error).toBeString()
    expect(compileRuleRegex('(a+)+$', false).test('aaaa')).toBe(true)
    expect(compileRuleRegex('(a)\\1', false).test('aa')).toBe(true)
    expect(() => compileRuleRegex('a'.repeat(513), false)).toThrow('512')
  })
})
