/**
 * POST /api/channels-status
 *
 * Bulk fetch of stream status for multiple channels across platforms.
 * All platform fetches run in parallel for minimal latency.
 *
 * Body: { channels: ChannelStatusRequest[] }
 *
 * For Twitch:
 *   - If userAccessToken is provided → use it (authenticated user context)
 *   - Otherwise → use app access token (client_credentials, anonymous)
 *   - Batches all Twitch logins into a single /helix/streams call
 *
 * For Kick:
 *   - Always uses app token (no user context needed for public channel info)
 *   - One request per channel (Kick API doesn't support bulk slug lookup)
 */

import { config } from "../config.ts";
import { getTwitchAppToken } from "./stream-status.ts";
import { logger } from "../logger.ts";
import type {
  ChannelStatusRequest,
  ChannelStatus,
  ChannelsStatusResponse,
} from "@twirchat/shared";

const log = logger("channels-status");

// ----------------------------------------------------------------
// Twitch bulk fetch
// ----------------------------------------------------------------

interface HelixStream {
  user_login: string;
  title: string;
  game_name: string;
  viewer_count: number;
}

interface HelixChannel {
  broadcaster_login: string;
  title: string;
  game_name: string;
}

async function fetchTwitchChannelsStatus(
  channels: ChannelStatusRequest[],
): Promise<ChannelStatus[]> {
  if (channels.length === 0) return [];

  const logins = channels.map((c) => c.channelLogin.toLowerCase());

  // Prefer user token from first channel that has one (all channels from same
  // authenticated user share the same token in practice). Fall back to app token.
  const userToken = channels.find((c) => c.userAccessToken)?.userAccessToken;
  const token = userToken ?? (await getTwitchAppToken());

  const headers = {
    Authorization: `Bearer ${token}`,
    "Client-Id": config.TWITCH_CLIENT_ID,
  };

  // Batch: fetch live streams + offline channel info in parallel
  const loginParams = logins.map((l) => `user_login=${encodeURIComponent(l)}`).join("&");

  const [streamsRes, channelsRes] = await Promise.all([
    fetch(`https://api.twitch.tv/helix/streams?${loginParams}&first=100`, { headers }),
    fetch(`https://api.twitch.tv/helix/channels?${loginParams}`, { headers }),
  ]);

  const liveMap = new Map<string, HelixStream>();
  const offlineMap = new Map<string, HelixChannel>();

  if (streamsRes.ok) {
    const body = (await streamsRes.json()) as { data: HelixStream[] };
    for (const s of body.data) {
      liveMap.set(s.user_login.toLowerCase(), s);
    }
  } else {
    log.warn("Twitch /helix/streams failed", { status: streamsRes.status });
  }

  if (channelsRes.ok) {
    const body = (await channelsRes.json()) as { data: HelixChannel[] };
    for (const c of body.data) {
      offlineMap.set(c.broadcaster_login.toLowerCase(), c);
    }
  } else {
    log.warn("Twitch /helix/channels failed", { status: channelsRes.status });
  }

  return logins.map((login) => {
    const live = liveMap.get(login);
    if (live) {
      return {
        platform: "twitch" as const,
        channelLogin: login,
        isLive: true,
        title: live.title,
        categoryName: live.game_name || undefined,
        viewerCount: live.viewer_count,
      };
    }
    const offline = offlineMap.get(login);
    return {
      platform: "twitch" as const,
      channelLogin: login,
      isLive: false,
      title: offline?.title ?? "",
      categoryName: offline?.game_name || undefined,
    };
  });
}

// ----------------------------------------------------------------
// Kick — one request per channel (no bulk API)
// ----------------------------------------------------------------

async function fetchKickChannelStatus(
  channel: ChannelStatusRequest,
): Promise<ChannelStatus> {
  // Kick public channel info doesn't require auth
  const res = await fetch(
    `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(channel.channelLogin)}`,
  );

  if (!res.ok) {
    log.warn("Kick channel fetch failed", { channel: channel.channelLogin, status: res.status });
    return {
      platform: "kick",
      channelLogin: channel.channelLogin,
      isLive: false,
      title: "",
    };
  }

  const body = (await res.json()) as {
    data?: Array<{
      stream_title?: string;
      stream?: { is_live?: boolean; viewer_count?: number };
      category?: { name?: string };
    }>;
  };

  const ch = body.data?.[0];
  if (!ch) {
    return { platform: "kick", channelLogin: channel.channelLogin, isLive: false, title: "" };
  }

  return {
    platform: "kick",
    channelLogin: channel.channelLogin,
    isLive: ch.stream?.is_live ?? false,
    title: ch.stream_title ?? "",
    categoryName: ch.category?.name,
    viewerCount: ch.stream?.viewer_count,
  };
}

// ----------------------------------------------------------------
// Public handler
// ----------------------------------------------------------------

export async function handleChannelsStatus(
  req: Request,
): Promise<ChannelsStatusResponse> {
  const body = (await req.json()) as { channels?: ChannelStatusRequest[] };
  const channels = body.channels ?? [];

  if (channels.length === 0) return { channels: [] };

  // Split by platform
  const twitchChannels = channels.filter((c) => c.platform === "twitch");
  const kickChannels = channels.filter((c) => c.platform === "kick");

  // Run platform groups in parallel; within Kick run each channel in parallel too
  const [twitchResults, kickResults] = await Promise.all([
    fetchTwitchChannelsStatus(twitchChannels),
    Promise.all(kickChannels.map(fetchKickChannelStatus)),
  ]);

  const result = [...twitchResults, ...kickResults];
  log.debug("Channels status fetched", { count: result.length });

  return { channels: result };
}
