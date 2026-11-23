import type { UserCardProfileState } from '@gpuix/hooks/user-card-dialog/use-user-card-profile'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { memo } from 'react'

import { UserCardMetadataSection } from './metadata-section'
import { TwitchBadgeCollection } from './TwitchBadgeCollection'
import type { MetadataItem } from './types'
import { ProfileNameHistory, UserProfileView } from './user-profile'

interface UserCardProfileTabProps {
  target: UserCardTarget
  hideAvatar: boolean
  profileState: UserCardProfileState
  supportedByCard: boolean
  metadataLoading: boolean
  metadataError: string | null
  metadata: MetadataItem[]
  reloadMetadata: () => void
}

export const UserCardProfileTab = memo(function UserCardProfileTab({
  target,
  hideAvatar,
  profileState,
  supportedByCard,
  metadataLoading,
  metadataError,
  metadata,
  reloadMetadata,
}: UserCardProfileTabProps) {
  const { platform, platformUserId, channelId, channelSlug } = target
  const username =
    target.username ||
    (profileState.profile?.id === platformUserId ? profileState.profile.login : undefined)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <UserProfileView target={target} hideAvatar={hideAvatar} state={profileState} />
      <ProfileNameHistory profile={profileState.profile} loading={profileState.loading} />
      {platform === 'twitch' && username ? (
        <TwitchBadgeCollection
          username={username}
          channelId={channelId}
          channelSlug={channelSlug}
        />
      ) : null}

      <UserCardMetadataSection
        supportedByCard={supportedByCard}
        metadataLoading={metadataLoading}
        metadataError={metadataError}
        metadata={metadata}
        reloadMetadata={reloadMetadata}
      />
    </div>
  )
})
