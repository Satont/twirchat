import { useBackend } from '@gpuix/backend-context'
import { useActionToast, type ActionClickEvent } from '@gpuix/components/action-toast'
import { ActionButton } from '@gpuix/components/ui/Form'
import { useT } from '@gpuix/hooks/use-translation'
import { useTheme } from '@gpuix/theme-context'
import { useState } from 'react'

import { SectionHeader } from '../UserCardUI'
import type { UserActionsSectionProps } from './types'

export function UserActionsSection({ target, moderation, bg }: UserActionsSectionProps) {
  const backend = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const { showToast } = useActionToast()
  const { run, command, busy } = moderation
  const [blocked, setBlocked] = useState(false)
  const [following, setFollowing] = useState(false)
  const identity = target.platformUserId

  async function toggleBlock(event?: ActionClickEvent) {
    const next = !blocked
    const message = next ? t('userCard.feedback.blocked') : t('userCard.feedback.unblocked')

    const result = await run(() => command(`/${next ? 'block' : 'unblock'} ${identity}`), message)

    setBlocked(next)
    showToast(message, event)

    if (!result.ok) {
      setBlocked(!next)
      showToast('Error block', event)
      return
    }
  }

  async function toggleFollow(event?: ActionClickEvent) {
    const username = target.username
    if (!username) return
    const next = !following
    const action = next ? 'follow' : 'unfollow'
    const message = next ? t('userCard.feedback.following') : t('userCard.feedback.unfollowed')
    const result = await run(
      () => backend.api.executeTwitchActivityAction({ action, channelSlug: username }),
      message,
    )

    showToast(message, event)
    setFollowing(next)

    if (!result.ok) {
      setFollowing(!next)
      showToast('Error follow', event)
      return
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexBasis: 220,
        flexShrink: 1,
        flexGrow: 1,
        minWidth: 200,
        gap: 6,
        borderWidth: 1,
        borderRadius: 12,
        borderColor: theme.border,
        paddingTop: 8,
        paddingBottom: 20,
        paddingLeft: 12,
        paddingRight: 12,
        backgroundColor: bg,
      }}
    >
      <SectionHeader icon="users" title={t('userCard.actions.title')} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 4,
        }}
      >
        <ActionButton
          icon={blocked ? 'check' : 'lock'}
          active={blocked}
          disabled={busy}
          style={{
            flexShrink: 1,
            flexGrow: 1,
            flexBasis: 0,
          }}
          onClick={(event) => {
            void toggleBlock(event).catch(() => {})
          }}
        >
          {blocked ? t('userCard.actions.unblock') : t('userCard.actions.block')}
        </ActionButton>
        {target.platform === 'twitch' ? (
          <ActionButton
            icon={following ? 'close' : 'plus'}
            active={following}
            style={{
              flexShrink: 1,
              flexGrow: 1,
              flexBasis: 0,
            }}
            disabled={busy || !target.username}
            onClick={(event) => {
              void toggleFollow(event).catch(() => {})
            }}
          >
            {following ? t('userCard.actions.unfollow') : t('userCard.actions.follow')}
          </ActionButton>
        ) : null}
      </div>
    </div>
  )
}
