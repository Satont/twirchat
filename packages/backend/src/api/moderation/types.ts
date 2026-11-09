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

export interface BanResult {
  platform: 'kick'
  success: boolean
  userId: string
  isPermanent: boolean
  durationSeconds?: number
  createdAt: Date
  error?: ModerationError
}

export interface DeleteMessageResult {
  platform: 'kick'
  success: boolean
  messageId: string
  deletedAt?: Date
  error?: ModerationError
}
