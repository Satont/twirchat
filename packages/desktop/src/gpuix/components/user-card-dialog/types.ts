import type { MessageKey } from '@desktop/gpuix/i18n'
import type { IconName } from '@desktop/gpuix/icons'
import type { DesktopWindows } from '@desktop/gpuix/state/desktop-windows'
import type { useTextInputFocusTracking } from '@desktop/gpuix/state/focus'
import type { UserCardTarget } from '@desktop/views/main/utils/chatCommands'
import type { Badge as BadgeData, Platform } from '@twirchat/shared/types'

export interface UserProfileProps {
  target: UserCardTarget
  hideAvatar?: boolean
  onAvatarChange?: (url?: string) => void
}

export interface ProfileEntry {
  icon: IconName
  label: string
  value: string | React.ReactNode
  color?: string
}

export interface UserCardHeaderTarget {
  platform: Platform
  platformUserId: string
  displayName: string
  username?: string
  avatarUrl?: string
  badges?: BadgeData[]
  channelId?: string
  channelSlug?: string
}

export interface UserCardHeaderProps {
  target: UserCardHeaderTarget
  hideAvatar: boolean
  channelUrl: string | undefined
  openingPublicChannel: boolean
  openPublicChannel: () => void
  onAvatarClick: () => void
  effectiveAlias?: string
  accent?: UserCardHeaderAccent
  extraBadges?: BadgeData[]
  windows: DesktopWindows | null
  standalone: boolean
  openingWindow: boolean
  openWindow: () => void
}

export interface UserCardHeaderAccent {
  from: string
  to: string
}

export type UserCardTab = 'profile' | 'actions' | 'notes' | 'history'

export interface TabConfig {
  id: UserCardTab
  labelKey: MessageKey
  icon: IconName
}

export interface UserCardTabsProps {
  tab: UserCardTab
  setTab: (tab: UserCardTab) => void
}

export interface MetadataItem {
  label: string
  value: string | null
  icon: IconName
}

export interface UserCardMetadataSectionProps {
  supportedByCard: boolean
  metadataLoading: boolean
  metadataError: string | null
  metadata: MetadataItem[] | null
  reloadMetadata: () => void
}

export interface UserCardAliasSectionProps {
  aliasValue: string
  setAliasValue: (value: string) => void
  aliasFocused: boolean
  effectiveAlias: string | undefined
  displayName: string
  aliasFocus: ReturnType<typeof useTextInputFocusTracking>
  handleSaveAlias: () => Promise<void>
  handleRemoveAlias: () => Promise<void>
  pinned: boolean
  togglePin: () => void
  onClose: () => void
  windows: DesktopWindows | null
  standalone: boolean
  target: UserCardTarget
  openingWindow: boolean
  setOpeningWindow: (value: boolean) => void
  showNotice: (kind: 'error' | 'info' | 'success', text: string, durationMs?: number) => void
  publicChannelError: string | null
  openPublicChannel: () => void
}
