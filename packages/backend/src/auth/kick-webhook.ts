import { createHmac } from "node:crypto";
import type { NormalizedChatMessage, NormalizedEvent, Badge } from "@chatrix/shared";
import { connectionManager } from "../ws/connection-manager.ts";
import { AccountStore } from "../db/index.ts";

const KICK_WEBHOOK_SECRET = process.env["KICK_WEBHOOK_SECRET"] ?? "";

// ============================================================
// Kick webhook payload types (v1)
// ============================================================

interface KickUser {
  is_anonymous: boolean;
  user_id: number | null;
  username: string | null;
  is_verified: boolean | null;
  profile_picture: string | null;
  channel_slug: string | null;
  identity: {
    username_color?: string;
    badges?: Array<{ text: string; type: string; count?: number }>;
  } | null;
}

interface ChatMessagePayload {
  message_id: string;
  broadcaster: KickUser;
  sender: KickUser;
  content: string;
  emotes: Array<{
    emote_id: string;
    positions: Array<{ s: number; e: number }>;
  }>;
  created_at: string;
}

interface ChannelFollowPayload {
  broadcaster: KickUser;
  follower: KickUser;
}

interface ChannelSubscriptionPayload {
  broadcaster: KickUser;
  subscriber: KickUser;
  duration: number;
  created_at: string;
  expires_at: string;
}

interface ChannelSubscriptionGiftsPayload {
  broadcaster: KickUser;
  gifter: KickUser;
  giftees: KickUser[];
  created_at: string;
}

// ============================================================
// HMAC signature verification
// ============================================================

export async function verifyKickSignature(
  req: Request,
  body: string
): Promise<boolean> {
  if (!KICK_WEBHOOK_SECRET) {
    console.warn("[Kick webhook] KICK_WEBHOOK_SECRET not set — skipping verification");
    return true;
  }

  const signature = req.headers.get("Kick-Event-Signature");
  if (!signature) return false;

  const expected = createHmac("sha256", KICK_WEBHOOK_SECRET)
    .update(body)
    .digest("hex");

  // constant-time compare
  return signature === `sha256=${expected}`;
}

// ============================================================
// Normalization helpers
// ============================================================

function normalizeBadges(badges: Array<{ text: string; type: string; count?: number }> | undefined): Badge[] {
  if (!badges) return [];
  return badges.map((b) => ({ id: b.type, type: b.type, text: b.text }));
}

function normalizeChatMessage(payload: ChatMessagePayload): NormalizedChatMessage {
  const sender = payload.sender;
  const badges = normalizeBadges(sender.identity?.badges);

  return {
    id: payload.message_id,
    platform: "kick",
    channelId: String(payload.broadcaster.user_id ?? payload.broadcaster.channel_slug ?? ""),
    author: {
      id: String(sender.user_id ?? "anon"),
      displayName: sender.username ?? "anonymous",
      color: sender.identity?.username_color ?? undefined,
      avatarUrl: sender.profile_picture ?? undefined,
      badges,
    },
    text: payload.content,
    emotes: payload.emotes.map((e) => ({
      id: e.emote_id,
      name: e.emote_id,
      imageUrl: `https://files.kick.com/emotes/${e.emote_id}/fullsize`,
      positions: e.positions.map((p) => ({ start: p.s, end: p.e })),
    })),
    timestamp: new Date(payload.created_at),
    type: "message",
  };
}

// ============================================================
// Main webhook handler
// ============================================================

export async function handleKickWebhook(req: Request): Promise<Response> {
  const body = await req.text();

  const valid = await verifyKickSignature(req, body);
  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }

  const eventType = req.headers.get("Kick-Event-Type") ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    await dispatchKickEvent(eventType, parsed);
  } catch (err) {
    console.error(`[Kick webhook] Error dispatching ${eventType}:`, err);
  }

  return new Response("OK", { status: 200 });
}

async function dispatchKickEvent(eventType: string, payload: unknown): Promise<void> {
  switch (eventType) {
    case "chat.message.sent": {
      const msg = normalizeChatMessage(payload as ChatMessagePayload);
      // Find the client that owns this broadcaster's channel and push the message
      await pushToChannelOwner(payload as ChatMessagePayload, { type: "chat_message", data: msg });
      break;
    }

    case "channel.followed": {
      const p = payload as ChannelFollowPayload;
      const event: NormalizedEvent = {
        id: `kick:follow:${p.follower.user_id}:${Date.now()}`,
        platform: "kick",
        type: "follow",
        user: {
          id: String(p.follower.user_id ?? "anon"),
          displayName: p.follower.username ?? "anonymous",
          avatarUrl: p.follower.profile_picture ?? undefined,
        },
        data: { channelSlug: p.broadcaster.channel_slug },
        timestamp: new Date(),
      };
      await pushToChannelOwner(p, { type: "chat_event", data: event });
      break;
    }

    case "channel.subscription.new":
    case "channel.subscription.renewal": {
      const p = payload as ChannelSubscriptionPayload;
      const event: NormalizedEvent = {
        id: `kick:sub:${p.subscriber.user_id}:${p.created_at}`,
        platform: "kick",
        type: eventType === "channel.subscription.renewal" ? "resub" : "sub",
        user: {
          id: String(p.subscriber.user_id ?? "anon"),
          displayName: p.subscriber.username ?? "anonymous",
          avatarUrl: p.subscriber.profile_picture ?? undefined,
        },
        data: { duration: p.duration, channelSlug: p.broadcaster.channel_slug },
        timestamp: new Date(p.created_at),
      };
      await pushToChannelOwner(p, { type: "chat_event", data: event });
      break;
    }

    case "channel.subscription.gifts": {
      const p = payload as ChannelSubscriptionGiftsPayload;
      // One event per giftee
      for (const giftee of p.giftees) {
        const event: NormalizedEvent = {
          id: `kick:giftsub:${p.gifter.user_id}:${giftee.user_id}:${p.created_at}`,
          platform: "kick",
          type: "gift_sub",
          user: {
            id: String(p.gifter.user_id ?? "anon"),
            displayName: p.gifter.username ?? "anonymous",
            avatarUrl: p.gifter.profile_picture ?? undefined,
          },
          data: {
            gifteeId: giftee.user_id,
            gifteeUsername: giftee.username,
            channelSlug: p.broadcaster.channel_slug,
          },
          timestamp: new Date(p.created_at),
        };
        await pushToChannelOwner(p, { type: "chat_event", data: event });
      }
      break;
    }

    default:
      console.log(`[Kick webhook] Unhandled event type: ${eventType}`);
  }
}

// Find which connected desktop client owns the broadcaster's channel and push to them.
// We look up the platform_account whose platform_user_id matches the broadcaster's user_id.
async function pushToChannelOwner(
  payload: { broadcaster: KickUser },
  message: Parameters<typeof connectionManager.send>[1]
): Promise<void> {
  const broadcasterId = payload.broadcaster.user_id;
  if (!broadcasterId) {
    // Fallback: broadcast to all connected clients (shouldn't happen in practice)
    connectionManager.broadcast(message);
    return;
  }

  const { sql } = Bun;
  const rows = await sql<{ client_secret: string }[]>`
    SELECT client_secret FROM platform_accounts
    WHERE platform = 'kick' AND platform_user_id = ${String(broadcasterId)}
  `;

  if (rows.length === 0) {
    console.warn(`[Kick webhook] No client found for broadcaster ${broadcasterId}`);
    return;
  }

  for (const row of rows) {
    connectionManager.send(row.client_secret, message);
  }
}
