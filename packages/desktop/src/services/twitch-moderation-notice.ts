import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { z } from 'zod'

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
  ['unban', { summary: (user) => `unbanned ${user}` }],
  ['untimeout', { summary: (user) => `removed the timeout for ${user}` }],
  ['mod', { summary: (user) => `made ${user} a moderator` }],
  ['unmod', { summary: (user) => `removed moderator privileges from ${user}` }],
  ['vip', { summary: (user) => `made ${user} a VIP` }],
  ['unvip', { summary: (user) => `removed VIP status from ${user}` }],
  ['warn', { summary: (user) => `warned ${user}` }],
  ['raid', { summary: (user) => `started a raid to ${user}` }],
  ['unraid', { summary: (user) => `canceled the raid to ${user}` }],
  ['shared_chat_ban', { summary: (user) => `banned ${user}` }],
  ['shared_chat_timeout', { summary: (user) => `timed out ${user}` }],
  ['shared_chat_unban', { summary: (user) => `unbanned ${user}` }],
  ['shared_chat_untimeout', { summary: (user) => `removed the timeout for ${user}` }],
  ['shared_chat_delete', { summary: (user) => `deleted a message from ${user}` }],
  [
    'approve_unban_request',
    { summary: (user) => `approved the unban request from ${user}`, payloadKey: 'unban_request' },
  ],
  [
    'deny_unban_request',
    { summary: (user) => `denied the unban request from ${user}`, payloadKey: 'unban_request' },
  ],
])
const termChanges = new Map([
  ['add_blocked_term', 'added a blocked term'],
  ['remove_blocked_term', 'removed a blocked term'],
  ['add_permitted_term', 'added a permitted term'],
  ['remove_permitted_term', 'removed a permitted term'],
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
  const summary =
    action && target ? action.summary(`@${target.user_login}`) : termChanges.get(payload.action)
  if (!summary) return undefined

  const channelId = payload.broadcaster_user_login.toLowerCase()
  const source = payload.source_broadcaster_user_login?.toLowerCase()
  const fromSharedChat = source && source !== channelId ? ` in #${source} (Shared Chat)` : ''
  return buildTwitchSystemMessage({
    channelId,
    id: `eventsub:${id}`,
    timestamp: at ? new Date(at) : undefined,
    text: `@${payload.moderator_user_login} ${summary}${fromSharedChat}`,
    notice: { kind: 'moderation' },
  })
}
