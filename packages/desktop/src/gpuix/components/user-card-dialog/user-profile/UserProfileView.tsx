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
            flexGrow: 1,
            flexBasis: 280,
            minWidth: 0,
            gap: 12,
          }}
        >
          <ProfileHeading
            displayName={displayName}
            login={profile?.login}
            loading={loading}
            showCopyAvatar={Boolean(avatarUrl)}
            copyAvatarUrl={copyAvatarUrl}
            openAvatarUrl={openAvatarUrl}
          />
          <ProfileDescriptionBlock description={profile?.description} loading={loading} />
        </div>
      </div>

      <ProfileDetails profile={profile} loading={loading} error={error} copyText={copyText} />

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
