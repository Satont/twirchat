/**
 * Moderation action types and interfaces shared between Twitch and Kick APIs
 */

export type ModerationAction = 'ban' | 'timeout' | 'delete_message'

export interface ModerationError {
  code: string
  status: number
  message: string
  details?: Record<string, unknown>
}

export class ModerationException extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ModerationException'
  }
}

// ============================================================
// Twitch Moderation Types
// ============================================================

export interface TwitchBanRequest {
  /** User ID of the user to ban/timeout */
  user_id: string
  /** Reason for the ban/timeout (optional) */
  reason?: string
  /** Duration in seconds (null = permanent ban, 1-604800 = timeout) */
  duration?: number | null
}

export interface TwitchBanResponse {
  data: Array<{
    user_id: string
    created_at: string
  }>
}

export interface TwitchDeleteMessageRequest {
  /** Message ID to delete */
  message_id: string
}

export interface TwitchModeratorResponse {
  data: Array<{
    user_id: string
    user_name: string
    user_login: string
  }>
  pagination: {
    cursor?: string
  }
}

// ============================================================
// Kick Moderation Types
// ============================================================

export interface KickBanRequest {
  /** Broadcaster whose chat the action applies to. */
  broadcaster_user_id: number
  /** User ID of the user to ban/timeout. */
  user_id: number
  /** Timeout in whole minutes; omit for a permanent ban. */
  duration?: number
  /** Reason for the ban/timeout (optional) */
  reason?: string
}

// ============================================================
// Unified Response Types
// ============================================================

export interface BanResult {
  platform: 'twitch' | 'kick'
  success: boolean
  userId: string
  isPermanent: boolean
  durationSeconds?: number
  createdAt: Date
  error?: ModerationError
}

export interface TimeoutResult {
  platform: 'twitch' | 'kick'
  success: boolean
  userId: string
  durationSeconds: number
  createdAt: Date
  error?: ModerationError
}

export interface DeleteMessageResult {
  platform: 'twitch' | 'kick'
  success: boolean
  messageId: string
  deletedAt?: Date
  error?: ModerationError
}

// ============================================================
// Moderator Check Types
// ============================================================

export interface IsModerator {
  platform: 'twitch' | 'kick'
  userId: string
  isModerator: boolean
  isBroadcaster?: boolean
  error?: ModerationError
}
