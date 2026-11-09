import { resolveTwitchUserId, type TwitchUserCredentials } from '../twitch-users.ts'
import * as Twitch from './twitch.ts'
import type {
  BanResult,
  DeleteMessageResult,
  IsModerator,
  ModerationError,
  TwitchBanRequest,
} from './types.ts'

export type ModerationAction = 'delete_message' | 'timeout' | 'ban'

interface ModerationCredentials extends TwitchUserCredentials {
  platformUserId: string
  scopes: readonly string[]
}

export interface ModerationCapabilityInput extends ModerationCredentials {
  channelSlug: string
}

export type ModerationInput = ModerationCapabilityInput & {
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

interface TwitchModerationClient {
  banUser(
    credentials: TwitchUserCredentials,
    broadcasterUserId: string,
    moderatorUserId: string,
    request: TwitchBanRequest,
  ): Promise<BanResult>
  deleteMessage(
    credentials: TwitchUserCredentials,
    broadcasterUserId: string,
    moderatorUserId: string,
    messageId: string,
  ): Promise<DeleteMessageResult>
  isModerator(
    credentials: TwitchUserCredentials,
    broadcasterUserId: string,
    userId: string,
  ): Promise<IsModerator>
}

export interface ModerationDependencies {
  resolveTwitchBroadcasterUserId(
    channelSlug: string,
    credentials: TwitchUserCredentials,
  ): Promise<string | null>
  twitch: TwitchModerationClient
}

export interface ModerationService {
  execute(input: ModerationInput): Promise<ModerationActionResult>
  getCapabilities(input: ModerationCapabilityInput): Promise<ModerationCapabilities>
}

const twitchRailScopes = ['moderator:manage:chat_messages', 'moderator:manage:banned_users']

const defaultDependencies: ModerationDependencies = {
  resolveTwitchBroadcasterUserId: resolveTwitchUserId,
  twitch: Twitch,
}

export function createModerationService(
  dependencies: ModerationDependencies = defaultDependencies,
): ModerationService {
  return {
    async getCapabilities(input) {
      assertCapabilityInput(input)
      if (!hasEveryScope(input.scopes, twitchRailScopes)) {
        return { canModerate: false }
      }

      const broadcasterUserId = await requireTwitchBroadcasterUserId(dependencies, input)
      if (broadcasterUserId === input.platformUserId) {
        return { canModerate: true }
      }
      if (!input.scopes.includes('user:read:moderated_channels')) return { canModerate: false }

      const moderator = await dependencies.twitch.isModerator(
        input,
        broadcasterUserId,
        input.platformUserId,
      )
      return { canModerate: moderator.isModerator && !moderator.error }
    },

    async execute(input) {
      assertModerationInput(input)
      assertActionScope(input)

      const broadcasterUserId = await requireTwitchBroadcasterUserId(dependencies, input)
      if (input.action === 'delete_message') {
        return dependencies.twitch.deleteMessage(
          input,
          broadcasterUserId,
          input.platformUserId,
          input.messageId,
        )
      }

      return dependencies.twitch.banUser(input, broadcasterUserId, input.platformUserId, {
        duration: input.action === 'timeout' ? input.durationSeconds : null,
        user_id: input.targetUserId,
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
    (!Number.isInteger(input.durationSeconds) || (input.durationSeconds ?? 0) < 1)
  ) {
    throw new Error('moderation: timeout duration must be at least 1 second')
  }
  if (input.action === 'timeout' && (input.durationSeconds ?? 0) > 1_209_600) {
    throw new Error('moderation: timeout duration exceeds the Twitch maximum')
  }
}

function assertActionScope(input: ModerationInput): void {
  const scope =
    input.action === 'delete_message'
      ? 'moderator:manage:chat_messages'
      : 'moderator:manage:banned_users'
  if (!input.scopes.includes(scope)) {
    throw new Error(`moderation: reconnect Twitch to grant ${scope}`)
  }
}

function hasEveryScope(granted: readonly string[], required: readonly string[]): boolean {
  return required.every((scope) => granted.includes(scope))
}

async function requireTwitchBroadcasterUserId(
  dependencies: ModerationDependencies,
  input: ModerationCapabilityInput,
): Promise<string> {
  const broadcasterUserId = await dependencies.resolveTwitchBroadcasterUserId(
    input.channelSlug,
    input,
  )
  if (!broadcasterUserId) {
    throw new Error(`moderation: Twitch channel ${input.channelSlug} was not found`)
  }
  return broadcasterUserId
}
