import { useTheme } from '@desktop/gpuix/theme-context'
import { useUserCardPermissions } from '@gpuix/hooks/user-card-dialog/use-user-card-permissions'
import { accountsStore } from '@gpuix/state/app'
import { useStoreSelector } from '@gpuix/state/create-store'

import { userCardPanelColor } from '../utils'
import { ActiveActionsSection } from './ActiveActionsSection'
import { ModerationSection } from './ModerationSection'
import type { UserCardActionsProps } from './types'
import { UserActionsSection } from './UserActionsSection'
import { WhisperSection } from './WhisperSection'

export function UserCardActions({ target, moderation, onOpenWhispers }: UserCardActionsProps) {
  const channel = target.channelSlug
  const theme = useTheme()
  const permissions = useUserCardPermissions(moderation.canModerate)
  const ownUserId = useStoreSelector(
    accountsStore,
    (accounts) => accounts.find((account) => account.platform === 'twitch')?.platformUserId,
  )
  const ownUsername = useStoreSelector(
    accountsStore,
    (accounts) => accounts.find((account) => account.platform === 'twitch')?.username,
  )
  const isSelf =
    target.platformUserId === ownUserId ||
    (target.username !== undefined &&
      ownUsername !== undefined &&
      target.username.toLowerCase() === ownUsername.toLowerCase())
  const blockBg = userCardPanelColor(theme)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <ActiveActionsSection target={target} moderation={moderation} bg={blockBg} />
        <UserActionsSection target={target} moderation={moderation} bg={blockBg} />
      </div>
      {target.platform === 'twitch' && !isSelf && onOpenWhispers ? (
        <WhisperSection
          target={target}
          moderation={moderation}
          bg={blockBg}
          onOpenWhispers={(value) => onOpenWhispers?.(value)}
        />
      ) : null}
      {(target.platform === 'twitch' || target.platform === 'kick') &&
      channel &&
      permissions.can(target, 'read') ? (
        <ModerationSection target={target} channel={channel} moderation={moderation} bg={blockBg} />
      ) : null}
    </div>
  )
}
