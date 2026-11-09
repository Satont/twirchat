import { useTheme } from '@gpuix/theme-context'
import type { UserCardTarget } from '@views/main/utils/chatCommands'

import type { IconName } from '../ui/Icon'
import { UserCardMetadataSection } from './UserCardMetadataSection'
import { UserProfile } from './UserProfile'

interface UserCardProfileTabProps {
  target: UserCardTarget
  hideAvatar: boolean
  onAvatarChange: (url?: string) => void
  supportedByCard: boolean
  metadataLoading: boolean
  metadataError: string | null
  metadata: Array<{ label: string; value: string | null; icon: IconName }> | null
  reloadMetadata: () => void
}

export function UserCardProfileTab({
  target,
  hideAvatar,
  onAvatarChange,
  supportedByCard,
  metadataLoading,
  metadataError,
  metadata,
  reloadMetadata,
}: UserCardProfileTabProps) {
  const theme = useTheme()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div
        style={{
          padding: 16,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 12,
        }}
      >
        <UserProfile target={target} hideAvatar={hideAvatar} onAvatarChange={onAvatarChange} />
      </div>
      <div
        style={{
          padding: 16,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 12,
        }}
      >
        <UserCardMetadataSection
          supportedByCard={supportedByCard}
          metadataLoading={metadataLoading}
          metadataError={metadataError}
          metadata={metadata}
          reloadMetadata={reloadMetadata}
        />
      </div>
    </div>
  )
}
