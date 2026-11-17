import { memo, useMemo } from 'react'

import { UserCardPanel } from '../UserCardUI'
import { ProfileAvatar } from './ProfileAvatar'
import { ProfileCosmetics } from './ProfileCosmetics'
import { ProfileDescriptionBlock } from './ProfileDescriptionBlock'
import { ProfileDetails } from './ProfileDetails'
import { ProfileHeading } from './ProfileHeading'
import { ProfileNameHistory } from './ProfileNameHistory'
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
    openSevenTvProfile,
  } = state

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
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 16,
        }}
      >
        <ProfileAvatar avatarUrl={avatarUrl} displayName={displayName} />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            flexGrow: 1,
            flexBasis: 280,
            minWidth: 0,
          }}
        >
          <ProfileHeading
            displayName={displayName}
            login={profile?.login}
            loading={loading}
            showCopyAvatar={Boolean(avatarUrl)}
            copyAvatarUrl={copyAvatarUrl}
          />
          <ProfileDescriptionBlock description={profile?.description} loading={loading} />
          <ProfileDetails profile={profile} loading={loading} error={error} copyText={copyText} />
        </div>
      </div>

      <ProfileNameHistory profile={profile} loading={loading} />

      <ProfileCosmetics
        cosmetics={cosmetics}
        paintImage={paintImage}
        badgesEnabled={badgesEnabled}
        paintsEnabled={paintsEnabled}
        openSevenTvProfile={openSevenTvProfile}
      />
    </UserCardPanel>
  )
})
