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

export interface TwitchBanRequest {
  /** User ID of the user to ban/timeout */
  user_id: string
  /** Reason for the ban/timeout (optional) */
  reason?: string
  /** Duration in seconds (null = permanent ban, 1-604800 = timeout) */
  duration?: number | null
}

export interface BanResult {
  platform: 'twitch'
  success: boolean
  userId: string
  isPermanent: boolean
  durationSeconds?: number
  createdAt: Date
  error?: ModerationError
}

export interface DeleteMessageResult {
  platform: 'twitch'
  success: boolean
  messageId: string
  deletedAt?: Date
  error?: ModerationError
}

export interface IsModerator {
  platform: 'twitch'
  userId: string
  isModerator: boolean
  isBroadcaster?: boolean
  error?: ModerationError
}
