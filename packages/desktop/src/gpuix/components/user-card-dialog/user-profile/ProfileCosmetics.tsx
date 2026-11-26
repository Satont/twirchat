import { memo } from 'react'

import { ProfileCosmeticsBody } from './ProfileCosmeticsBody'
import type { ProfileCosmeticsProps } from './types'

export const ProfileCosmetics = memo(function ProfileCosmetics({
  cosmetics,
  paintImage,
  badgesEnabled,
  paintsEnabled,
  openSevenTvProfile,
  compact,
}: ProfileCosmeticsProps) {
  if (!cosmetics?.sevenTvUserId || (!badgesEnabled && !paintsEnabled)) return null
  return (
    <ProfileCosmeticsBody
      cosmetics={cosmetics}
      paintImage={paintImage}
      badgesEnabled={badgesEnabled}
      paintsEnabled={paintsEnabled}
      openSevenTvProfile={openSevenTvProfile}
      compact={compact}
    />
  )
})
