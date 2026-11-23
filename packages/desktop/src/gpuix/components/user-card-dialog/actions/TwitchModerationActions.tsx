import { useBackend } from '@gpuix/backend/context'
import { useActionToast, type ActionClickEvent } from '@gpuix/components/action-toast'
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
}

interface RoleOption {
  command: string
  label: string
  icon: IconName
  key?: keyof RoleState
  next?: boolean
}

const ACTIVITY_ACTIONS = [
  'add_editor',
  'remove_editor',
  'assign_lead_moderator',
  'unassign_lead_moderator',
]

export function TwitchModerationActions({
  target,
  channel,
  moderation,
}: TwitchModerationActionsProps) {
  const backend = useBackend()
  const { showToast } = useActionToast()
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
  }))
  const identity = target.platformUserId

  async function apply(option: RoleOption, message: string, event?: ActionClickEvent) {
    const result = await run(async () => {
      if (ACTIVITY_ACTIONS.some((name) => name === option.command)) {
        if (option.command === 'add_editor' || option.command === 'remove_editor')
          await backend.api.executeTwitchActivityAction({
            action: option.command,
            channelSlug: channel,
            username: target.username ?? '',
          })
        else
          await backend.api.executeTwitchActivityAction({
            action:
              option.command === 'assign_lead_moderator'
                ? 'assign_lead_moderator'
                : 'unassign_lead_moderator',
            channelSlug: channel,
            userId: identity,
          })
        return
      }
      await command(option.command)
    }, message)
    if (!result.ok) showToast(result.message, event)
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
    { command: `/restrict ${identity}`, label: t('userCard.role.restrict'), icon: 'lock' },
    { command: `/unrestrict ${identity}`, label: t('userCard.role.unrestrict'), icon: 'check' },
    { command: `/monitor ${identity}`, label: t('userCard.role.monitor'), icon: 'eye' },
    { command: `/unmonitor ${identity}`, label: t('userCard.role.unmonitor'), icon: 'close' },
  ]

  const channelOptions: RoleOption[] = [
    { command: 'add_editor', label: t('userCard.role.addEditor'), icon: 'plus' },
    { command: 'remove_editor', label: t('userCard.role.removeEditor'), icon: 'close' },
    {
      command: 'assign_lead_moderator',
      label: t('userCard.role.assignLead'),
      icon: 'star',
    },
    {
      command: 'unassign_lead_moderator',
      label: t('userCard.role.unassignLead'),
      icon: 'close',
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
              disabled={
                busy ||
                ((option.command === 'add_editor' || option.command === 'remove_editor') &&
                  !target.username)
              }
              onClick={(event) =>
                void apply(
                  option,
                  t('userCard.feedback.accepted', { action: option.label }),
                  event,
                ).catch(() => {})
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
