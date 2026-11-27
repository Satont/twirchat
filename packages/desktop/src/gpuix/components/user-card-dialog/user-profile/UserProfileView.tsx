import { useWindowSize } from '@gpuix/react'
import { memo, useMemo } from 'react'

import { UserCardPanel } from '../UserCardUI'
import { ProfileAvatar } from './ProfileAvatar'
import { ProfileCosmetics } from './ProfileCosmetics'
import { ProfileDescriptionBlock } from './ProfileDescriptionBlock'
import { ProfileDetails } from './ProfileDetails'
import { ProfileHeading } from './ProfileHeading'
import type { UserProfileViewProps } from './types'

export const UserProfileView = memo(function UserProfileView({
  target,
  hideAvatar,
  state,
}: UserProfileViewProps) {
  const {
    profile,
    cosmetics,
    paintImage,
    badgesEnabled,
    paintsEnabled,
    loading,
    error,
    copyText,
    copyAvatarUrl,
    openAvatarUrl,
    openSevenTvProfile,
  } = state
  const windowSize = useWindowSize()
  const compact = windowSize.width < 1600

  const avatarUrl = useMemo(
    () => (hideAvatar ? undefined : (profile?.avatarUrl ?? target.avatarUrl)),
    [hideAvatar, profile?.avatarUrl, target.avatarUrl],
  )
  const displayName = useMemo(
    () => profile?.displayName ?? target.displayName,
    [profile?.displayName, target.displayName],
  )

  return (
    <UserCardPanel>
      <div
        style={{
          display: 'flex',
          flexDirection: compact ? 'column' : 'row',
          flexWrap: compact ? undefined : 'wrap',
          alignItems: compact ? 'center' : 'flex-start',
          justifyContent: compact ? 'center' : undefined,
          gap: compact ? 8 : 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            alignSelf: compact ? 'stretch' : undefined,
          }}
        >
          <ProfileAvatar avatarUrl={avatarUrl} displayName={displayName} />
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            flexBasis: 280,
            minWidth: 0,
            alignSelf: compact ? 'stretch' : undefined,
            alignItems: compact ? 'center' : undefined,
            gap: compact ? 6 : 12,
          }}
        >
          <ProfileHeading
            displayName={displayName}
            login={profile?.login}
            loading={loading}
            showCopyAvatar={Boolean(avatarUrl)}
            copyAvatarUrl={copyAvatarUrl}
            openAvatarUrl={openAvatarUrl}
            compact={compact}
          />
          <ProfileDescriptionBlock
            description={profile?.description}
            loading={loading}
            compact={compact}
          />
        </div>
      </div>

      <ProfileDetails
        profile={profile}
        loading={loading}
        error={error}
        copyText={copyText}
        compact={compact}
      />

      <ProfileCosmetics
        cosmetics={cosmetics}
        paintImage={paintImage}
        badgesEnabled={badgesEnabled}
        paintsEnabled={paintsEnabled}
        openSevenTvProfile={openSevenTvProfile}
        compact={compact}
      />
    </UserCardPanel>
  )
})
