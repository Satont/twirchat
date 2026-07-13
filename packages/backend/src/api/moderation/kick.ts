/**
 * Kick Public API moderation client.
 *
 * The current API separates message deletion from ban/timeout actions:
 * `DELETE /public/v1/chat/{message_id}` and
 * `POST /public/v1/moderation/bans`, respectively.
 */

import { logger } from '@twirchat/shared/logger'
import {
  ModerationException,
  type BanResult,
  type DeleteMessageResult,
  type KickBanRequest,
} from './types.ts'

const log = logger('kick-moderation')

interface KickErrorResponse {
  error?: string
  errors?: Record<string, string[]>
  message?: string
}

/**
 * Ban a user permanently or apply a timeout in a broadcaster's chat.
 * `duration` is in whole minutes and omitted for a permanent ban.
 */
export async function banUser(kickToken: string, request: KickBanRequest): Promise<BanResult> {
  const isPermanent = request.duration === undefined

  try {
    const response = await fetch('https://api.kick.com/public/v1/moderation/bans', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kickToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const message = await readErrorMessage(response)
      throw new ModerationException(
        mapKickError(response.status, message),
        response.status,
        `Failed to ban user on Kick: ${message ?? response.statusText}`,
        { userId: request.user_id, isPermanent, duration: request.duration },
      )
    }

    log.info('Kick moderation ban applied', {
      broadcasterUserId: request.broadcaster_user_id,
      userId: request.user_id,
      isPermanent,
      duration: request.duration,
    })

    return {
      platform: 'kick',
      success: true,
      userId: String(request.user_id),
      isPermanent,
      durationSeconds: request.duration ? request.duration * 60 : undefined,
      createdAt: new Date(),
    }
  } catch (error) {
    if (error instanceof ModerationException) {
      return {
        platform: 'kick',
        success: false,
        userId: String(request.user_id),
        isPermanent,
        durationSeconds: request.duration ? request.duration * 60 : undefined,
        createdAt: new Date(),
        error: {
          code: error.code,
          status: error.status,
          message: error.message,
          details: error.details,
        },
      }
    }

    log.error('Unexpected error during Kick ban', { error: String(error) })
    throw error
  }
}

/** Delete one Kick chat message with the `moderation:chat_message:manage` scope. */
export async function deleteMessage(
  kickToken: string,
  messageId: string,
): Promise<DeleteMessageResult> {
  try {
    const response = await fetch(
      `https://api.kick.com/public/v1/chat/${encodeURIComponent(messageId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${kickToken}` },
      },
    )

    if (!response.ok) {
      const message = await readErrorMessage(response)
      throw new ModerationException(
        mapKickError(response.status, message),
        response.status,
        `Failed to delete message on Kick: ${message ?? response.statusText}`,
        { messageId },
      )
    }

    log.info('Kick message deleted', { messageId })
    return { platform: 'kick', success: true, messageId, deletedAt: new Date() }
  } catch (error) {
    if (error instanceof ModerationException) {
      return {
        platform: 'kick',
        success: false,
        messageId,
        error: {
          code: error.code,
          status: error.status,
          message: error.message,
          details: error.details,
        },
      }
    }

    log.error('Unexpected error during Kick message delete', { error: String(error) })
    throw error
  }
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as KickErrorResponse
    return payload.message ?? payload.error
  } catch {
    return undefined
  }
}

function mapKickError(status: number, message?: string): string {
  const normalizedMessage = message?.toLowerCase() ?? ''

  switch (status) {
    case 400:
      return normalizedMessage.includes('invalid') ? 'KICK_INVALID_PARAMETER' : 'KICK_BAD_REQUEST'
    case 401:
      return 'KICK_UNAUTHORIZED'
    case 403:
      return 'KICK_FORBIDDEN'
    case 404:
      return 'KICK_NOT_FOUND'
    case 409:
      return 'KICK_CONFLICT'
    case 422:
      return 'KICK_UNPROCESSABLE'
    case 429:
      return 'KICK_RATE_LIMITED'
    case 500:
      return 'KICK_SERVER_ERROR'
    default:
      return 'KICK_UNKNOWN_ERROR'
  }
}
