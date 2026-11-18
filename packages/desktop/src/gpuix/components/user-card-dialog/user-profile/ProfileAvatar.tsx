import { RemoteImage } from '@gpuix/components/ui/RemoteImage'
import { useTheme } from '@gpuix/theme-context'
import { memo } from 'react'

import { getSkeletonColors } from '../metadata-section/skeleton-colors'
import { ProfileAvatarFallback } from './ProfileAvatarFallback'
import type { ProfileAvatarProps } from './types'

export const ProfileAvatar = memo(function ProfileAvatar({
  avatarUrl,
  displayName,
}: ProfileAvatarProps) {
  const theme = useTheme()
  const skel = getSkeletonColors(theme)
  return (
    <div
      style={{
        width: 112,
        height: 112,
        flexShrink: 0,
        borderRadius: 18,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: skel.iconBg,
        backgroundColor: skel.iconBg,
        boxShadow: {
          offsetX: 0,
          offsetY: 10,
          blurRadius: 24,
          spreadRadius: 0,
          color: skel.iconInner,
        },
      }}
    >
      {avatarUrl ? (
        <RemoteImage
          url={avatarUrl}
          thumbnailSize={224}
          objectFit="cover"
          style={{ width: 110, height: 110, borderRadius: 18 }}
          fallback={<ProfileAvatarFallback name={displayName} size={110} />}
        />
      ) : (
        <ProfileAvatarFallback name={displayName} size={110} />
      )}
    </div>
  )
})
