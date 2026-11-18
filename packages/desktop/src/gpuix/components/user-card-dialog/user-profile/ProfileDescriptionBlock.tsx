import { useTheme } from '@gpuix/theme-context'
import { memo } from 'react'

import { getSkeletonColors } from '../metadata-section/skeleton-colors'
import { ProfileDescription } from '../ProfileDescription'
import type { ProfileDescriptionBlockProps } from './types'

export const ProfileDescriptionBlock = memo(function ProfileDescriptionBlock({
  description,
  loading,
}: ProfileDescriptionBlockProps) {
  const theme = useTheme()
  if (loading) {
    const skel = getSkeletonColors(theme)
    return (
      <div
        style={{
          width: '100%',
          height: 40,
          borderRadius: 8,
          backgroundColor: skel.valueBar,
        }}
      />
    )
  }
  return <ProfileDescription description={description} />
})
