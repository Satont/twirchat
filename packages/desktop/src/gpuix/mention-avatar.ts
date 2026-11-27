import { DEFAULT_SETTINGS, type MentionAvatarStyle } from '@twirchat/shared/types'

import type { MessageKey } from './i18n'

export interface MentionAvatarOption {
  readonly value: MentionAvatarStyle
  readonly labelKey: MessageKey
  readonly hintKey: MessageKey
}

export const MENTION_AVATAR_OPTION_BY_STYLE: Record<MentionAvatarStyle, MentionAvatarOption> = {
  pill: {
    value: 'pill',
    labelKey: 'chat.appearance.mentionAvatar.pill',
    hintKey: 'chat.appearance.mentionAvatar.pillHint',
  },
  inline: {
    value: 'inline',
    labelKey: 'chat.appearance.mentionAvatar.inline',
    hintKey: 'chat.appearance.mentionAvatar.inlineHint',
  },
  chip: {
    value: 'chip',
    labelKey: 'chat.appearance.mentionAvatar.chip',
    hintKey: 'chat.appearance.mentionAvatar.chipHint',
  },
  off: {
    value: 'off',
    labelKey: 'chat.appearance.mentionAvatar.off',
    hintKey: 'chat.appearance.mentionAvatar.offHint',
  },
}

export const MENTION_AVATAR_OPTIONS: readonly MentionAvatarOption[] = [
  MENTION_AVATAR_OPTION_BY_STYLE.pill,
  MENTION_AVATAR_OPTION_BY_STYLE.inline,
  MENTION_AVATAR_OPTION_BY_STYLE.chip,
  MENTION_AVATAR_OPTION_BY_STYLE.off,
]

/**
 * Resolves the active mention avatar style, honoring the legacy boolean
 * `showMentionAvatar: false` setting when `mentionAvatarStyle` is not yet set.
 */
export function resolveMentionAvatarStyle(
  style: MentionAvatarStyle | undefined,
  legacyShowMentionAvatar?: boolean,
): MentionAvatarStyle {
  if (style) return style
  if (legacyShowMentionAvatar === false) return 'off'
  return DEFAULT_SETTINGS.mentionAvatarStyle ?? 'pill'
}

export function inlineMentionAvatarSize(fontSize: number): number {
  return Math.max(12, Math.round(fontSize * 1.15))
}
