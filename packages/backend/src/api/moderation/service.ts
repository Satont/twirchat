import { handleKickChatroom } from '../kick-chatroom.ts'
import { resolveTwitchUserId } from '../twitch-users.ts'
import * as Kick from './kick.ts'
import * as Twitch from './twitch.ts'
import type {
  BanResult,
  DeleteMessageResult,
  IsModerator,
  KickBanRequest,
  ModerationError,
  TwitchBanRequest,
} from './types.ts'

export type ModerationPlatform = 'twitch' | 'kick'
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
  messageId: string
  targetUserId: string
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
    accessToken: string,
    broadcasterUserId: string,
    moderatorUserId: string,
    request: TwitchBanRequest,
  ): Promise<BanResult>
  deleteMessage(
    accessToken: string,
    broadcasterUserId: string,
    moderatorUserId: string,
    messageId: string,
  ): Promise<DeleteMessageResult>
  isModerator(accessToken: string, broadcasterUserId: string, userId: string): Promise<IsModerator>
}

interface KickModerationClient {
  banUser(accessToken: string, request: KickBanRequest): Promise<BanResult>
  deleteMessage(accessToken: string, messageId: string): Promise<DeleteMessageResult>
}

export interface ModerationDependencies {
  kick: KickModerationClient
  resolveKickBroadcasterUserId(channelSlug: string): Promise<number>
  resolveTwitchBroadcasterUserId(channelSlug: string, accessToken: string): Promise<string | null>
  twitch: TwitchModerationClient
}

export interface ModerationService {
  execute(input: ModerationInput): Promise<ModerationActionResult>
  getCapabilities(input: ModerationCapabilityInput): Promise<ModerationCapabilities>
}

const twitchRailScopes = [
  'moderator:read:moderators',
  'moderator:manage:chat_messages',
  'moderator:manage:banned_users',
] as const

const kickRailScopes = ['moderation:chat_message:manage', 'moderation:ban'] as const

const defaultDependencies: ModerationDependencies = {
  kick: Kick,
  async resolveKickBroadcasterUserId(channelSlug) {
    return (
      await handleKickChatroom(new URL(`http://localhost/?slug=${encodeURIComponent(channelSlug)}`))
    ).broadcasterUserId
  },
  resolveTwitchBroadcasterUserId: resolveTwitchUserId,
  twitch: Twitch,
}

export function createModerationService(
  dependencies: ModerationDependencies = defaultDependencies,
): ModerationService {
  return {
    async getCapabilities(input) {
      assertCapabilityInput(input)
      if (!hasEveryScope(input.scopes, requiredRailScopes(input.platform))) {
        return { canModerate: false }
      }

      if (input.platform === 'kick') {
        return { canModerate: true }
      }

      const broadcasterUserId = await requireTwitchBroadcasterUserId(dependencies, input)
      if (broadcasterUserId === input.platformUserId) {
        return { canModerate: true }
      }

      const moderator = await dependencies.twitch.isModerator(
        input.accessToken,
        broadcasterUserId,
        input.platformUserId,
      )
      return { canModerate: moderator.isModerator && !moderator.error }
    },

    async execute(input) {
      assertModerationInput(input)
      assertActionScope(input)

      if (input.platform === 'twitch') {
        const broadcasterUserId = await requireTwitchBroadcasterUserId(dependencies, input)
        if (input.action === 'delete_message') {
          return dependencies.twitch.deleteMessage(
            input.accessToken,
            broadcasterUserId,
            input.platformUserId,
            input.messageId,
          )
        }

        return dependencies.twitch.banUser(
          input.accessToken,
          broadcasterUserId,
          input.platformUserId,
          {
            duration: input.action === 'timeout' ? input.durationSeconds : null,
            user_id: input.targetUserId,
          },
        )
      }

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
  if (input.platform !== 'twitch' && input.platform !== 'kick') {
    throw new Error(`moderation: unsupported platform ${input.platform}`)
  }
  if (!input.accessToken || !input.platformUserId || !input.channelSlug) {
    throw new Error('moderation: credentials and channel slug are required')
  }
}

function assertModerationInput(input: ModerationInput): void {
  assertCapabilityInput(input)
  if (!input.messageId || !input.targetUserId) {
    throw new Error('moderation: message and target user IDs are required')
  }
  if (input.action !== 'delete_message' && input.action !== 'timeout' && input.action !== 'ban') {
    throw new Error(`moderation: unsupported action ${input.action}`)
  }
  if (
    input.action === 'timeout' &&
    (!Number.isInteger(input.durationSeconds) || (input.durationSeconds ?? 0) < 60)
  ) {
    throw new Error('moderation: timeout duration must be at least 60 seconds')
  }
  if (input.action === 'timeout') {
    const maximumSeconds = input.platform === 'kick' ? 604_800 : 1_209_600
    if ((input.durationSeconds ?? 0) > maximumSeconds) {
      const platformName = input.platform === 'kick' ? 'Kick' : 'Twitch'
      throw new Error(`moderation: timeout duration exceeds the ${platformName} maximum`)
    }
  }
}

function assertActionScope(input: ModerationInput): void {
  const scope = requiredActionScope(input.platform, input.action)
  if (!input.scopes.includes(scope)) {
    throw new Error(`moderation: reconnect ${input.platform} to grant ${scope}`)
  }
}

function requiredRailScopes(platform: ModerationPlatform): readonly string[] {
  return platform === 'twitch' ? twitchRailScopes : kickRailScopes
}

function requiredActionScope(platform: ModerationPlatform, action: ModerationAction): string {
  if (platform === 'twitch') {
    return action === 'delete_message'
      ? 'moderator:manage:chat_messages'
      : 'moderator:manage:banned_users'
  }
  return action === 'delete_message' ? 'moderation:chat_message:manage' : 'moderation:ban'
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
    input.accessToken,
  )
  if (!broadcasterUserId) {
    throw new Error(`moderation: Twitch channel ${input.channelSlug} was not found`)
  }
  return broadcasterUserId
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`moderation: ${label} must be a positive integer`)
  }
  return parsed
}
