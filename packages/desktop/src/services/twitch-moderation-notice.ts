import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { z } from 'zod'

import { t, type MessageKey } from '../gpuix/i18n'
import { buildTwitchSystemMessage } from './twitch-system-message'

const twitchLogin = z.string().regex(/^[a-z\d_]{1,25}$/i)
const moderationSchema = z.object({
  action: z.string(),
  broadcaster_user_login: twitchLogin,
  moderator_user_login: twitchLogin,
  source_broadcaster_user_login: twitchLogin.nullish(),
})
const targetSchema = z.object({ user_login: twitchLogin })

interface TargetedAction {
  summary: (target: string) => string
  payloadKey?: string
}

// IRC already reports local bans, timeouts, deletions, clears, and chat modes.
// The EventSub raid action is an outgoing raid; IRC reports incoming raids.
const targeted = new Map<string, TargetedAction>([
  ['unban', { summary: (user) => t('notices.twitchModeration.unbanned', { user }) }],
  ['untimeout', { summary: (user) => t('notices.twitchModeration.removedTimeout', { user }) }],
  ['mod', { summary: (user) => t('notices.twitchModeration.madeModerator', { user }) }],
  ['unmod', { summary: (user) => t('notices.twitchModeration.removedModerator', { user }) }],
  ['vip', { summary: (user) => t('notices.twitchModeration.madeVip', { user }) }],
  ['unvip', { summary: (user) => t('notices.twitchModeration.removedVip', { user }) }],
  ['warn', { summary: (user) => t('notices.twitchModeration.warned', { user }) }],
  ['raid', { summary: (user) => t('notices.twitchModeration.raidStarted', { user }) }],
  ['unraid', { summary: (user) => t('notices.twitchModeration.raidCanceled', { user }) }],
  ['shared_chat_ban', { summary: (user) => t('notices.twitchModeration.banned', { user }) }],
  ['shared_chat_timeout', { summary: (user) => t('notices.twitchModeration.timedOut', { user }) }],
  ['shared_chat_unban', { summary: (user) => t('notices.twitchModeration.unbanned', { user }) }],
  [
    'shared_chat_untimeout',
    { summary: (user) => t('notices.twitchModeration.removedTimeout', { user }) },
  ],
  [
    'shared_chat_delete',
    { summary: (user) => t('notices.twitchModeration.messageDeleted', { user }) },
  ],
  [
    'approve_unban_request',
    {
      summary: (user) => t('notices.twitchModeration.unbanApproved', { user }),
      payloadKey: 'unban_request',
    },
  ],
  [
    'deny_unban_request',
    {
      summary: (user) => t('notices.twitchModeration.unbanDenied', { user }),
      payloadKey: 'unban_request',
    },
  ],
])
const termChanges = new Map<string, MessageKey>([
  ['add_blocked_term', 'notices.twitchModeration.blockedTermAdded'],
  ['remove_blocked_term', 'notices.twitchModeration.blockedTermRemoved'],
  ['add_permitted_term', 'notices.twitchModeration.permittedTermAdded'],
  ['remove_permitted_term', 'notices.twitchModeration.permittedTermRemoved'],
])

export function buildTwitchModerationNotice(
  event: Record<string, unknown>,
  id: string | undefined,
  at: string | undefined,
): NormalizedChatMessage | undefined {
  if (!id) return undefined
  const payload = moderationSchema.safeParse(event).data
  if (!payload) return undefined

  const action = targeted.get(payload.action)
  const target = action && targetSchema.safeParse(event[action.payloadKey ?? payload.action]).data
  const termKey = termChanges.get(payload.action)
  const summary =
    action && target ? action.summary(`@${target.user_login}`) : termKey ? t(termKey) : undefined
  if (!summary) return undefined

  const channelId = payload.broadcaster_user_login.toLowerCase()
  const source = payload.source_broadcaster_user_login?.toLowerCase()
  const fromSharedChat =
    source && source !== channelId
      ? t('notices.twitchModeration.sharedChat', { channel: source })
      : ''
  return buildTwitchSystemMessage({
    channelId,
    id: `eventsub:${id}`,
    timestamp: at ? new Date(at) : undefined,
    text: `@${payload.moderator_user_login} ${summary}${fromSharedChat}`,
    notice: { kind: 'moderation' },
  })
}
