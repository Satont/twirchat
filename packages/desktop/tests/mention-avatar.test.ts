import { describe, expect, test } from 'bun:test'

import { MENTION_AVATAR_STYLES } from '@twirchat/shared/types'

import {
  MENTION_AVATAR_OPTION_BY_STYLE,
  MENTION_AVATAR_OPTIONS,
  inlineMentionAvatarSize,
  resolveMentionAvatarStyle,
} from '../src/gpuix/mention-avatar'

describe('mention avatar helpers', () => {
  test('resolveMentionAvatarStyle prefers explicit style over legacy boolean', () => {
    expect(resolveMentionAvatarStyle('pill', false)).toBe('pill')
    expect(resolveMentionAvatarStyle('inline', false)).toBe('inline')
    expect(resolveMentionAvatarStyle('chip', false)).toBe('chip')
    expect(resolveMentionAvatarStyle('off', true)).toBe('off')
  })

  test('resolveMentionAvatarStyle falls back to legacy showMentionAvatar when style is omitted', () => {
    expect(resolveMentionAvatarStyle(undefined, false)).toBe('off')
    expect(resolveMentionAvatarStyle(undefined, true)).toBe('pill')
    expect(resolveMentionAvatarStyle(undefined, undefined)).toBe('pill')
  })

  test('inlineMentionAvatarSize clamps small font sizes and scales proportionally', () => {
    expect(inlineMentionAvatarSize(8)).toBe(12)
    expect(inlineMentionAvatarSize(10)).toBe(12)
    expect(inlineMentionAvatarSize(14)).toBe(16)
    expect(inlineMentionAvatarSize(20)).toBe(23)
  })

  test('option metadata covers every supported mention avatar style in order', () => {
    expect(MENTION_AVATAR_OPTIONS.map((option) => option.value)).toEqual([...MENTION_AVATAR_STYLES])
    for (const style of MENTION_AVATAR_STYLES) {
      expect(MENTION_AVATAR_OPTION_BY_STYLE[style].value).toBe(style)
    }
  })
})
