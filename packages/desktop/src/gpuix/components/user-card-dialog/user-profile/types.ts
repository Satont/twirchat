import type { UserCosmetics } from '@desktop/services/cosmetics'
import type { UserCardProfileState } from '@gpuix/hooks/user-card-dialog/use-user-card-profile'
import type { IconName } from '@gpuix/icons'
import type { Badge } from '@twirchat/shared/types'
import type { UserProfileSnapshot } from '@twirchat/shared/user-profile'
import type { UserCardTarget } from '@views/main/utils/chatCommands'

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

export interface ProfileAvatarProps {
  avatarUrl: string | undefined
  displayName: string
}

export interface ProfileHeadingProps {
  displayName: string
  login: string | undefined
  loading: boolean
  showCopyAvatar: boolean
  copyAvatarUrl: () => Promise<void>
  openAvatarUrl: () => Promise<void>
  compact?: boolean
}

export interface ProfileDescriptionBlockProps {
  description: string | undefined
  loading: boolean
  compact?: boolean
}

export interface ProfileDetailsProps {
  profile: UserProfileSnapshot | null
  loading: boolean
  error: string
  copyText: (text: string) => Promise<void>
  compact?: boolean
}

export interface ProfileNameHistoryProps {
  profile: UserProfileSnapshot | null
  loading: boolean
}

export interface PaintPreviewProps {
  paintImage: UserCardProfileState['paintImage']
}

export interface BadgeInventoryProps {
  badges: Badge[] | undefined
  inventoryBadges: Badge[] | undefined
}

export interface ProfileCosmeticsProps {
  cosmetics: UserCardProfileState['cosmetics']
  paintImage: UserCardProfileState['paintImage']
  badgesEnabled: boolean
  paintsEnabled: boolean
  openSevenTvProfile: () => Promise<void>
  compact?: boolean
}

export interface ProfileCosmeticsBodyProps {
  cosmetics: UserCosmetics
  paintImage: UserCardProfileState['paintImage']
  badgesEnabled: boolean
  paintsEnabled: boolean
  openSevenTvProfile: () => Promise<void>
  compact?: boolean
}

export interface UserProfileViewProps {
  target: UserCardTarget
  hideAvatar: boolean
  state: UserCardProfileState
}
