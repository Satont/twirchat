import { useBackend } from '@gpuix/backend/context'
import { ActionButton } from '@gpuix/components/ui/Form'
import { useT } from '@gpuix/i18n'
import type { IconName } from '@gpuix/icons'
import { AnimatePresence, motion } from '@gpuix/react'
import { accountsStore } from '@gpuix/state/app'
import { useStoreSelector } from '@gpuix/state/create-store'
import { useTheme } from '@gpuix/theme-context'
import { useState } from 'react'

import { Text } from '../../ui/Text'
import type { TwitchModerationActionsProps } from './types'

interface RoleState {
  moderator: boolean
  vip: boolean
  restricted: boolean
  monitored: boolean
  editor: boolean
  leadModerator: boolean
}

interface RoleOption {
  command: string
  label: string
  icon: IconName
  key?: keyof RoleState
  next?: boolean
  activity?: boolean
}

export function TwitchModerationActions({
  target,
  channel,
  moderation,
}: TwitchModerationActionsProps) {
  const backend = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const { run, command, busy } = moderation
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
  const [advanced, setAdvanced] = useState(false)
  const [roles, setRoles] = useState<RoleState>(() => ({
    moderator: target.badges?.some((badge) => badge.type === 'moderator') ?? false,
    vip: target.badges?.some((badge) => badge.type === 'vip') ?? false,
    restricted: false,
    monitored: false,
    editor: false,
    leadModerator: false,
  }))
  const identity = target.platformUserId

  async function apply(option: RoleOption, message: string) {
    const result = await run(async () => {
      if (option.activity && option.key) {
        const action =
          option.key === 'editor'
            ? option.next
              ? 'add_editor'
              : 'remove_editor'
            : option.next
              ? 'assign_lead_moderator'
              : 'unassign_lead_moderator'
        await backend.api.executeTwitchActivityAction(
          action === 'add_editor' || action === 'remove_editor'
            ? { action, channelSlug: channel, username: target.username ?? '' }
            : { action, channelSlug: channel, userId: identity },
        )
        return
      }
      await command(option.command)
    }, message)
    const key = option.key
    const next = option.next
    if (result.ok && key !== undefined && next !== undefined)
      setRoles((current) => ({ ...current, [key]: next }))
  }

  const moderationOptions: RoleOption[] = [
    roles.moderator
      ? {
          command: `/unmod ${identity}`,
          label: t('userCard.role.unmod'),
          icon: 'close',
          key: 'moderator',
          next: false,
        }
      : {
          command: `/mod ${identity}`,
          label: t('userCard.role.mod'),
          icon: 'star',
          key: 'moderator',
          next: true,
        },
    roles.vip
      ? {
          command: `/unvip ${identity}`,
          label: t('userCard.role.unvip'),
          icon: 'close',
          key: 'vip',
          next: false,
        }
      : {
          command: `/vip ${identity}`,
          label: t('userCard.role.vip'),
          icon: 'star',
          key: 'vip',
          next: true,
        },
  ]

  const suspiciousOptions: RoleOption[] = [
    roles.restricted
      ? {
          command: `/unrestrict ${identity}`,
          label: t('userCard.role.unrestrict'),
          icon: 'check',
          key: 'restricted',
          next: false,
        }
      : {
          command: `/restrict ${identity}`,
          label: t('userCard.role.restrict'),
          icon: 'lock',
          key: 'restricted',
          next: true,
        },
    roles.monitored
      ? {
          command: `/unmonitor ${identity}`,
          label: t('userCard.role.unmonitor'),
          icon: 'close',
          key: 'monitored',
          next: false,
        }
      : {
          command: `/monitor ${identity}`,
          label: t('userCard.role.monitor'),
          icon: 'eye',
          key: 'monitored',
          next: true,
        },
  ]

  const channelOptions: RoleOption[] = [
    {
      command: '',
      label: roles.editor ? t('userCard.role.removeEditor') : t('userCard.role.addEditor'),
      icon: roles.editor ? 'close' : 'plus',
      key: 'editor',
      next: !roles.editor,
      activity: true,
    },
    {
      command: '',
      label: roles.leadModerator ? t('userCard.role.unassignLead') : t('userCard.role.assignLead'),
      icon: roles.leadModerator ? 'close' : 'star',
      key: 'leadModerator',
      next: !roles.leadModerator,
      activity: true,
    },
  ]

  function renderGroup(title: string, options: RoleOption[]) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Text style={{ fontSize: 11, fontWeight: 600, color: theme.text2 }}>{title}</Text>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {options.map((option) => (
            <ActionButton
              key={option.label}
              icon={option.icon}
              disabled={busy || (option.key === 'editor' && !target.username)}
              onClick={() =>
                void apply(option, t('userCard.feedback.accepted', { action: option.label })).catch(
                  () => {},
                )
              }
            >
              {option.label}
            </ActionButton>
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <ActionButton icon="arrowDown" onClick={() => setAdvanced(!advanced)}>
        {advanced ? t('userCard.actions.hideAdvanced') : t('userCard.actions.advanced')}
      </ActionButton>
      <AnimatePresence>
        {advanced ? (
          <motion.div
            key="roles-options"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            {isSelf ? null : renderGroup(t('userCard.roles.group.moderation'), moderationOptions)}
            {renderGroup(t('userCard.roles.group.suspicious'), suspiciousOptions)}
            {renderGroup(t('userCard.roles.group.channel'), channelOptions)}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
