/**
 * GET /api/kick/chatroom?slug=<slug>
 *
 * Resolves a Kick channel slug to its chatroom_id.
 * Uses kick.com/api/v2/channels/{slug} — public, no auth required.
 * The public/v1 API does NOT expose chatroom.id; v2 does.
 */

import { logger } from "@twirchat/shared";

const log = logger("kick-chatroom");

export interface KickChatroomResponse {
  avatarUrl?: string;
  chatroomId: number;
  broadcasterUserId: number;
}

function normalizeAvatarUrl(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export async function handleKickChatroom(
  url: URL,
): Promise<KickChatroomResponse> {
  const slug = url.searchParams.get("slug");
  if (!slug) {
    throw new Error("slug query param is required");
  }

  const res = await fetch(
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    log.warn("Kick v2 channels API failed", {
      body: body.slice(0, 200),
      slug,
      status: res.status,
    });
    throw new Error(`Kick API returned ${res.status} for slug "${slug}"`);
  }

  const body = (await res.json()) as {
    id?: number;
    user_id?: number;
    user?: { profile_pic?: string | null };
    chatroom?: { id?: number };
  };

  const chatroomId = body.chatroom?.id;
  const broadcasterUserId = body.user_id;
  const avatarUrl = normalizeAvatarUrl(body.user?.profile_pic);

  if (!chatroomId) {
    throw new Error(`Kick chatroom.id not found for "${slug}"`);
  }
  if (!broadcasterUserId) {
    throw new Error(`Kick user_id not found for "${slug}"`);
  }

  log.debug("Kick chatroom resolved", { broadcasterUserId, chatroomId, slug });
  return { avatarUrl, broadcasterUserId, chatroomId };
}
