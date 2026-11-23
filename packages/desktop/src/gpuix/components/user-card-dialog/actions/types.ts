import type { UserCardTarget } from '@views/main/utils/chatCommands'

import type { UserCardModeration } from './use-user-card-moderation'

export interface UserCardActionsProps {
  target: UserCardTarget
  avatarUrl?: string
  hideAvatar?: boolean
  moderation: UserCardModeration
  onOpenWhispers?: (target: UserCardTarget) => void
}

export interface UserCardSectionHeaderProps {
  text: string
}

export interface ActiveActionsSectionProps {
  target: UserCardTarget
  moderation: UserCardModeration
  bg: string
}

export interface UserActionsSectionProps {
  target: UserCardTarget
  moderation: UserCardModeration
  bg: string
}

export interface WhisperSectionProps {
  target: UserCardTarget
  moderation: UserCardModeration
  bg: string
  onOpenWhispers: (target: UserCardTarget) => void
}

export interface ModerationSectionProps {
  target: UserCardTarget
  channel: string
  moderation: UserCardModeration
  bg: string
}

export interface TwitchModerationActionsProps {
  target: UserCardTarget
  channel: string
  moderation: UserCardModeration
  bg: string
}

export interface ReasonDropdownProps {
  reasons: string[]
  value: string
  onSelect: (value: string) => void
  disabled: boolean
}
