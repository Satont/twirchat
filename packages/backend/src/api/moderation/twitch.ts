/**
 * Twitch Helix moderation API client
 *
 * Handles ban/timeout/untimeout and message deletion via Helix API.
 *
 * Reference: https://dev.twitch.tv/docs/api/reference#ban-user
 *            https://dev.twitch.tv/docs/api/reference#delete-chat-messages
 *            https://dev.twitch.tv/docs/api/reference#get-moderators
 */

import { config } from "../../config.ts";
import { logger } from "@twirchat/shared";
import {
  type BanResult,
  type DeleteMessageResult,
  type IsModerator,
  ModerationException,
  type TwitchBanRequest,
  type TwitchBanResponse,
  type TwitchModeratorResponse,
} from "./types.ts";

const log = logger("twitch-moderation");

interface HelixErrorResponse {
  error: string;
  status: number;
  message: string;
}

/**
 * Check if response is an error response
 */
function isHelixError(data: unknown): data is HelixErrorResponse {
  return typeof data === "object" && data !== null && "error" in data &&
    "status" in data;
}

/**
 * Ban or timeout a user in a channel.
 *
 * @param broadcasterToken - Access token with `moderator:manage:banned_users` scope
 * @param broadcasterUserId - The channel owner ID (from token)
 * @param moderatorUserId - The moderator performing the action (from token)
 * @param request - Ban request (user_id, reason?, duration?)
 * @returns BanResult with success status and error details if failed
 *
 * Error cases:
 * - 403: User lacks moderator:manage:banned_users scope, or is not a moderator in channel
 * - 409: User is already permanently banned, or other conflict (e.g., trying to timeout a staff)
 * - 422: Invalid user_id, duration out of range, etc.
 */
export async function banUser(
  broadcasterToken: string,
  broadcasterUserId: string,
  moderatorUserId: string,
  request: TwitchBanRequest,
): Promise<BanResult> {
  const isPermanent = request.duration === null ||
    request.duration === undefined;

  try {
    const body = {
      user_id: request.user_id,
      reason: request.reason,
      duration: request.duration,
    };

    log.debug("Banning user", {
      broadcasterUserId,
      userId: request.user_id,
      isPermanent,
      duration: request.duration,
    });

    const res = await fetch(
      `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterUserId}&moderator_id=${moderatorUserId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${broadcasterToken}`,
          "Client-Id": config.TWITCH_CLIENT_ID,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const data = (await res.json()) as TwitchBanResponse | HelixErrorResponse;

    if (!res.ok || isHelixError(data)) {
      const error = isHelixError(data)
        ? data
        : { error: "unknown", status: res.status, message: res.statusText };
      const errorCode = mapHelixError(res.status, error.message);

      log.warn("Ban failed", {
        status: res.status,
        code: errorCode,
        message: error.message,
      });

      throw new ModerationException(
        errorCode,
        res.status,
        `Failed to ban user: ${error.message}`,
        {
          userId: request.user_id,
          isPermanent,
          duration: request.duration,
        },
      );
    }

    const result = data as TwitchBanResponse;
    const banData = result.data[0];

    log.info("User banned", {
      userId: request.user_id,
      isPermanent,
      duration: request.duration,
    });

    return {
      platform: "twitch",
      success: true,
      userId: request.user_id,
      isPermanent,
      durationSeconds: request.duration ?? undefined,
      createdAt: new Date(banData?.created_at ?? Date.now()),
    };
  } catch (error) {
    if (error instanceof ModerationException) {
      return {
        platform: "twitch",
        success: false,
        userId: request.user_id,
        isPermanent,
        durationSeconds: request.duration ?? undefined,
        createdAt: new Date(),
        error: {
          code: error.code,
          status: error.status,
          message: error.message,
          details: error.details,
        },
      };
    }

    log.error("Unexpected error during ban", { error: String(error) });
    throw error;
  }
}

/**
 * Delete a single chat message by ID.
 *
 * @param broadcasterToken - Access token with `moderation:manage:messages` scope
 * @param broadcasterUserId - The channel owner ID
 * @param moderatorUserId - The moderator performing the action
 * @param messageId - The message ID to delete
 * @returns DeleteMessageResult with success status
 *
 * Returns 204 No Content on success (no response body).
 * Error cases:
 * - 403: User lacks moderation:manage:messages scope
 * - 404: Message not found
 */
export async function deleteMessage(
  broadcasterToken: string,
  broadcasterUserId: string,
  moderatorUserId: string,
  messageId: string,
): Promise<DeleteMessageResult> {
  try {
    log.debug("Deleting message", {
      broadcasterUserId,
      messageId,
    });

    const res = await fetch(
      `https://api.twitch.tv/helix/moderation/chat?broadcaster_id=${broadcasterUserId}&moderator_id=${moderatorUserId}&message_id=${messageId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${broadcasterToken}`,
          "Client-Id": config.TWITCH_CLIENT_ID,
        },
      },
    );

    if (!res.ok) {
      const errorCode = mapHelixError(res.status, res.statusText);
      log.warn("Delete message failed", {
        status: res.status,
        code: errorCode,
      });

      throw new ModerationException(
        errorCode,
        res.status,
        `Failed to delete message: ${res.statusText}`,
        { messageId },
      );
    }

    log.info("Message deleted", { messageId });

    return {
      platform: "twitch",
      success: true,
      messageId,
      deletedAt: new Date(),
    };
  } catch (error) {
    if (error instanceof ModerationException) {
      return {
        platform: "twitch",
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

    log.error("Unexpected error during message delete", {
      error: String(error),
    });
    throw error;
  }
}

/**
 * Check if a user is a moderator in the channel.
 *
 * Note: This only returns users with moderator badge. To check if someone is the broadcaster,
 * you need to compare against the broadcaster_id separately.
 *
 * @param broadcasterToken - Access token (any scope works, but moderator:read:blocked_terms recommended)
 * @param broadcasterUserId - The channel owner ID
 * @param userId - The user ID to check
 * @returns IsModerator with moderator status
 */
export async function isModerator(
  broadcasterToken: string,
  broadcasterUserId: string,
  userId: string,
): Promise<IsModerator> {
  try {
    log.debug("Checking moderator status", {
      broadcasterUserId,
      userId,
    });

    const res = await fetch(
      `https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${broadcasterUserId}&user_id=${userId}`,
      {
        headers: {
          Authorization: `Bearer ${broadcasterToken}`,
          "Client-Id": config.TWITCH_CLIENT_ID,
        },
      },
    );

    if (!res.ok) {
      const errorCode = mapHelixError(res.status, res.statusText);
      log.warn("Moderator check failed", {
        status: res.status,
        code: errorCode,
      });

      throw new ModerationException(
        errorCode,
        res.status,
        `Failed to check moderator status: ${res.statusText}`,
        { userId },
      );
    }

    const data = (await res.json()) as TwitchModeratorResponse;
    const isMod = data.data.length > 0;

    log.debug("Moderator status checked", {
      userId,
      isModerator: isMod,
    });

    return {
      platform: "twitch",
      userId,
      isModerator: isMod,
    };
  } catch (error) {
    if (error instanceof ModerationException) {
      return {
        platform: "twitch",
        userId,
        isModerator: false,
        error: {
          code: error.code,
          status: error.status,
          message: error.message,
          details: error.details,
        },
      };
    }

    log.error("Unexpected error during moderator check", {
      error: String(error),
    });
    throw error;
  }
}

/**
 * Map Twitch Helix HTTP status codes and error messages to domain error codes.
 *
 * Reference: https://dev.twitch.tv/docs/api#error-handling
 */
function mapHelixError(status: number, message: string): string {
  switch (status) {
    case 400:
      return message.includes("Invalid")
        ? "TWITCH_INVALID_PARAMETER"
        : "TWITCH_BAD_REQUEST";
    case 401:
      return "TWITCH_UNAUTHORIZED";
    case 403:
      return message.includes("moderator")
        ? "TWITCH_NOT_MODERATOR"
        : "TWITCH_INSUFFICIENT_PERMISSIONS";
    case 404:
      return "TWITCH_NOT_FOUND";
    case 409:
      return "TWITCH_CONFLICT";
    case 422:
      return "TWITCH_UNPROCESSABLE";
    case 429:
      return "TWITCH_RATE_LIMITED";
    case 500:
      return "TWITCH_SERVER_ERROR";
    default:
      return "TWITCH_UNKNOWN_ERROR";
  }
}
