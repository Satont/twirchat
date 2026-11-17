import { useUserCardProfile } from '@gpuix/hooks/user-card-dialog/use-user-card-profile'

import type { UserProfileProps } from './types'
import { UserProfileView } from './UserProfileView'

export function UserProfile({ target, hideAvatar = false, onAvatarChange }: UserProfileProps) {
  const state = useUserCardProfile({ target, hideAvatar, onAvatarChange })
  return <UserProfileView target={target} hideAvatar={hideAvatar} state={state} />
}

export { UserProfileView } from './UserProfileView'
export { ProfileAvatar } from './ProfileAvatar'
export { ProfileHeading } from './ProfileHeading'
export { ProfileDescriptionBlock } from './ProfileDescriptionBlock'
export { ProfileDetails } from './ProfileDetails'
export { ProfileNameHistory } from './ProfileNameHistory'
export { ProfileCosmetics } from './ProfileCosmetics'
export { ProfileCosmeticsBody } from './ProfileCosmeticsBody'
export { BadgeInventory } from './BadgeInventory'
export { PaintPreview } from './PaintPreview'
export { ProfileInfoRow } from './ProfileInfoRow'
export { ProfileAvatarFallback } from './ProfileAvatarFallback'
