import type { UserCardProfileState } from '@gpuix/hooks/user-card-dialog/use-user-card-profile'
import type { UserCardTarget } from '@views/main/utils/chatCommands'

import { TwitchBadgeCollection } from './TwitchBadgeCollection'
import type { MetadataItem } from './types'
import { UserCardMetadataSection } from './UserCardMetadataSection'
import { UserProfileView } from './UserProfile'

interface UserCardProfileTabProps {
  target: UserCardTarget
  hideAvatar: boolean
  profileState: UserCardProfileState
  supportedByCard: boolean
  metadataLoading: boolean
  metadataError: string | null
  metadata: MetadataItem[] | null
  reloadMetadata: () => void
}

export function UserCardProfileTab({
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
      {platform === 'twitch' && username ? (
        <TwitchBadgeCollection
          key={JSON.stringify([username, channelSlug, channelId])}
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
}
