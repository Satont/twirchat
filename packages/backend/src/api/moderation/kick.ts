/**
 * Kick API v1 moderation client
 *
 * Handles ban/timeout and message deletion via Kick's public API.
 *
 * Note: Kick API documentation is less comprehensive than Twitch.
 * Some endpoints and parameters are inferred from GitHub issues:
 * - Issue #338: DELETE message_id body semantics
 * - Issue #217: Bot account ban behavior
 * - Issue #345: Unban endpoint behavior
 *
 * Reference: https://help.kick.com/en/articles/10162074-moderation-features-guide
 *            https://github.com/KickEngineering/KickDevDocs/issues
 */

import { logger } from "@twirchat/shared";
import {
  type BanResult,
  type DeleteMessageResult,
  type KickBanRequest,
  type KickBanResponse,
  type KickUnbanRequest,
  ModerationException,
} from "./types.ts";

const log = logger("kick-moderation");

interface KickErrorResponse {
  error?: string;
  errors?: Record<string, string[]>;
  message?: string;
  statusCode?: number;
}

/**
 * Check if response is an error response
 */
function isKickError(status: number, data: unknown): boolean {
  if (!data || typeof data !== "object") return status >= 400;
  const obj = data as Record<string, unknown>;
  return "error" in obj || "errors" in obj || status >= 400;
}

/**
 * Ban or timeout a user in a channel.
 *
 * @param kickToken - Access token with `moderation:ban` scope
 * @param channelId - The Kick channel ID
 * @param request - Ban request (banned_user_id, duration_minutes?, reason?)
 * @returns BanResult with success status
 *
 * Parameters:
 * - banned_user_id: numeric user ID of the user to ban/timeout
 * - duration_minutes: optional number (null/omitted = permanent ban, number = timeout duration)
 * - reason: optional string for ban reason
 *
 * Known issues:
 * - Bot account ban behavior differs between web UI and API (GitHub issue #217)
 * - Parameter validation not fully documented by Kick
 */
export async function banUser(
  kickToken: string,
  channelId: string,
  request: KickBanRequest,
): Promise<BanResult> {
  const isPermanent = request.duration_minutes === null ||
    request.duration_minutes === undefined;

  try {
    const body: Record<string, unknown> = {
      banned_user_id: request.banned_user_id,
      reason: request.reason,
    };

    // Only include duration if provided (null = permanent)
    if (request.duration_minutes !== undefined) {
      body.duration_minutes = request.duration_minutes;
    }

    log.debug("Banning user on Kick", {
      channelId,
      userId: request.banned_user_id,
      isPermanent,
      duration: request.duration_minutes,
    });

    const res = await fetch(
      `https://api.kick.com/v1/channels/${channelId}/bans`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${kickToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const data = (await res.json()) as KickBanResponse | KickErrorResponse;

    if (!res.ok || isKickError(res.status, data)) {
      const error = data as KickErrorResponse;
      const errorCode = mapKickError(res.status, error.message || error.error);

      log.warn("Kick ban failed", {
        status: res.status,
        code: errorCode,
        message: error.message || error.error,
      });

      throw new ModerationException(
        errorCode,
        res.status,
        `Failed to ban user on Kick: ${error.message || error.error}`,
        {
          userId: request.banned_user_id,
          isPermanent,
          duration: request.duration_minutes,
        },
      );
    }

    const durationSeconds = request.duration_minutes
      ? request.duration_minutes * 60
      : undefined;

    log.info("User banned on Kick", {
      userId: request.banned_user_id,
      isPermanent,
      duration: request.duration_minutes,
    });

    return {
      platform: "kick",
      success: true,
      userId: String(request.banned_user_id),
      isPermanent,
      durationSeconds,
      createdAt: new Date(),
    };
  } catch (error) {
    if (error instanceof ModerationException) {
      return {
        platform: "kick",
        success: false,
        userId: String(request.banned_user_id),
        isPermanent,
        durationSeconds: request.duration_minutes
          ? request.duration_minutes * 60
          : undefined,
        createdAt: new Date(),
        error: {
          code: error.code,
          status: error.status,
          message: error.message,
          details: error.details,
        },
      };
    }

    log.error("Unexpected error during Kick ban", { error: String(error) });
    throw error;
  }
}

/**
 * Delete a single chat message by ID.
 *
 * @param kickToken - Access token with `chat:manage` scope
 * @param channelId - The Kick channel ID
 * @param messageId - The message ID to delete
 * @returns DeleteMessageResult with success status
 *
 * Note: Kick API documentation unclear on DELETE body semantics.
 * This implementation uses a simple DELETE without body.
 * If that fails, the endpoint may require request body with message_id field.
 * See GitHub issue #338 for discussion.
 */
export async function deleteMessage(
  kickToken: string,
  channelId: string,
  messageId: string,
): Promise<DeleteMessageResult> {
  try {
    log.debug("Deleting message on Kick", {
      channelId,
      messageId,
    });

    // Attempt 1: Simple DELETE without body
    let res = await fetch(
      `https://api.kick.com/v1/channels/${channelId}/messages/${messageId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${kickToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (res.status === 400 || res.status === 422) {
      // Attempt 2: DELETE with message_id in body (if first attempt suggests it's needed)
      const request = { message_id: messageId };

      res = await fetch(
        `https://api.kick.com/v1/channels/${channelId}/messages/${messageId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${kickToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        },
      );
    }

    if (!res.ok) {
      const data = (await res.json()) as KickErrorResponse;
      const errorCode = mapKickError(res.status, data.message || data.error);

      log.warn("Kick message delete failed", {
        status: res.status,
        code: errorCode,
      });

      throw new ModerationException(
        errorCode,
        res.status,
        `Failed to delete message on Kick: ${data.message || data.error}`,
        { messageId },
      );
    }

    log.info("Message deleted on Kick", { messageId });

    return {
      platform: "kick",
      success: true,
      messageId,
      deletedAt: new Date(),
    };
  } catch (error) {
    if (error instanceof ModerationException) {
      return {
        platform: "kick",
        success: false,
        messageId,
        error: {
          code: error.code,
          status: error.status,
          message: error.message,
          details: error.details,
        },
      };
    }

    log.error("Unexpected error during Kick message delete", {
      error: String(error),
    });
    throw error;
  }
}

/**
 * Unban a user in a channel (remove permanent or temporary ban).
 *
 * Note: This endpoint behavior is not well-documented by Kick.
 * Inferring from GitHub issue #345 and #338 discussions.
 *
 * @param kickToken - Access token with `moderation:ban` scope
 * @param channelId - The Kick channel ID
 * @param userId - The user ID to unban
 * @returns DeleteMessageResult (repurposed to represent success/failure)
 */
export async function unbanUser(
  kickToken: string,
  channelId: string,
  userId: number,
): Promise<DeleteMessageResult> {
  try {
    const request: KickUnbanRequest = { banned_user_id: userId };

    log.debug("Unbanning user on Kick", {
      channelId,
      userId,
    });

    const res = await fetch(
      `https://api.kick.com/v1/channels/${channelId}/bans/${userId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${kickToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
    );

    if (!res.ok) {
      const data = (await res.json()) as KickErrorResponse;
      const errorCode = mapKickError(res.status, data.message || data.error);

      log.warn("Kick unban failed", {
        status: res.status,
        code: errorCode,
      });

      throw new ModerationException(
        errorCode,
        res.status,
        `Failed to unban user on Kick: ${data.message || data.error}`,
        { userId },
      );
    }

    log.info("User unbanned on Kick", { userId });

    return {
      platform: "kick",
      success: true,
      messageId: String(userId),
      deletedAt: new Date(),
    };
  } catch (error) {
    if (error instanceof ModerationException) {
      return {
        platform: "kick",
        success: false,
        messageId: String(userId),
        error: {
          code: error.code,
          status: error.status,
          message: error.message,
          details: error.details,
        },
      };
    }

    log.error("Unexpected error during Kick unban", { error: String(error) });
    throw error;
  }
}

/**
 * Map Kick API HTTP status codes and error messages to domain error codes.
 *
 * Kick doesn't document error codes well, so we infer from status and message content.
 */
function mapKickError(status: number, message?: string): string {
  const msg = message?.toLowerCase() || "";

  switch (status) {
    case 400:
      return msg.includes("invalid")
        ? "KICK_INVALID_PARAMETER"
        : "KICK_BAD_REQUEST";
    case 401:
      return "KICK_UNAUTHORIZED";
    case 403:
      return "KICK_FORBIDDEN";
    case 404:
      return "KICK_NOT_FOUND";
    case 409:
      return "KICK_CONFLICT";
    case 422:
      return "KICK_UNPROCESSABLE";
    case 429:
      return "KICK_RATE_LIMITED";
    case 500:
      return "KICK_SERVER_ERROR";
    default:
      return "KICK_UNKNOWN_ERROR";
  }
}
