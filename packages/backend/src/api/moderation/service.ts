import { handleKickChatroom } from '../kick-chatroom.ts'
import * as Kick from './kick.ts'
import type { BanResult, DeleteMessageResult, KickBanRequest, ModerationError } from './types.ts'

export type ModerationPlatform = 'kick'
export type ModerationAction = 'delete_message' | 'timeout' | 'ban'

export interface ModerationCredentials {
  accessToken: string
  platformUserId: string
  scopes: readonly string[]
}

export interface ModerationCapabilityInput extends ModerationCredentials {
  channelSlug: string
  platform: ModerationPlatform
}

export interface ModerationInput extends ModerationCapabilityInput {
  action: ModerationAction
  durationSeconds?: number
  messageId?: string
  targetUserId?: string
}

export interface ModerationCapabilities {
  canModerate: boolean
}

export interface ModerationActionResult {
  success: boolean
  error?: ModerationError
}

interface KickModerationClient {
  banUser(accessToken: string, request: KickBanRequest): Promise<BanResult>
  deleteMessage(accessToken: string, messageId: string): Promise<DeleteMessageResult>
}

export interface ModerationDependencies {
  kick: KickModerationClient
  resolveKickBroadcasterUserId(channelSlug: string): Promise<number>
}

export interface ModerationService {
  execute(input: ModerationInput): Promise<ModerationActionResult>
  getCapabilities(input: ModerationCapabilityInput): Promise<ModerationCapabilities>
}

const kickRailScopes = ['moderation:chat_message:manage', 'moderation:ban']

const defaultDependencies: ModerationDependencies = {
  kick: Kick,
  async resolveKickBroadcasterUserId(channelSlug) {
    return (
      await handleKickChatroom(new URL(`http://localhost/?slug=${encodeURIComponent(channelSlug)}`))
    ).broadcasterUserId
  },
}

export function createModerationService(
  dependencies: ModerationDependencies = defaultDependencies,
): ModerationService {
  return {
    async getCapabilities(input) {
      assertCapabilityInput(input)
      return { canModerate: hasEveryScope(input.scopes, kickRailScopes) }
    },

    async execute(input) {
      assertModerationInput(input)
      assertActionScope(input)

      const broadcasterUserId = await dependencies.resolveKickBroadcasterUserId(input.channelSlug)
      if (input.action === 'delete_message') {
        return dependencies.kick.deleteMessage(input.accessToken, input.messageId)
      }

      return dependencies.kick.banUser(input.accessToken, {
        broadcaster_user_id: broadcasterUserId,
        ...(input.action === 'timeout'
          ? { duration: Math.ceil((input.durationSeconds ?? 0) / 60) }
          : {}),
        user_id: parsePositiveInteger(input.targetUserId, 'target user ID'),
      })
    },
  }
}

function assertCapabilityInput(input: ModerationCapabilityInput): void {
  if (!input.accessToken || !input.platformUserId || !input.channelSlug) {
    throw new Error('moderation: credentials and channel slug are required')
  }
}

type ValidatedModerationInput = ModerationInput &
  (
    | { action: 'delete_message'; messageId: string }
    | { action: 'ban' | 'timeout'; targetUserId: string }
  )

function assertModerationInput(input: ModerationInput): asserts input is ValidatedModerationInput {
  assertCapabilityInput(input)
  if (input.action === 'delete_message' && !input.messageId)
    throw new Error('moderation: message ID is required')
  if (input.action !== 'delete_message' && !input.targetUserId)
    throw new Error('moderation: target user ID is required')
  if (
    input.action === 'timeout' &&
    (!Number.isInteger(input.durationSeconds) || (input.durationSeconds ?? 0) < 60)
  ) {
    throw new Error(`moderation: timeout duration must be at least 60 seconds`)
  }
  if (input.action === 'timeout' && (input.durationSeconds ?? 0) > 604_800) {
    throw new Error('moderation: timeout duration exceeds the Kick maximum')
  }
}

function assertActionScope(input: ModerationInput): void {
  const scope = requiredActionScope(input.action)
  if (!input.scopes.includes(scope)) {
    throw new Error(`moderation: reconnect ${input.platform} to grant ${scope}`)
  }
}

function requiredActionScope(action: ModerationAction): string {
  return action === 'delete_message' ? 'moderation:chat_message:manage' : 'moderation:ban'
}

function hasEveryScope(granted: readonly string[], required: readonly string[]): boolean {
  return required.every((scope) => granted.includes(scope))
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`moderation: ${label} must be a positive integer`)
  }
  return parsed
}
