/**
 * GET /api/twitch/badges?broadcasterLogin=<login>
 *
 * Fetches global Twitch chat badges + channel-specific badges via Helix API
 * using the app access token (no user login required).
 *
 * Returns a flat map: "setId/version" → imageUrl_1x
 *
 * Example: { "subscriber/6": "https://static-cdn.jtvnw.net/badges/v1/<uuid>/1" }
 */

import { config } from "../config.ts";
import { getTwitchAppToken } from "./stream-status.ts";
import { logger } from "../logger.ts";
import type { TwitchBadgesResponse } from "@twirchat/shared";

const log = logger("twitch-badges");

interface HelixBadgeSet {
  set_id: string;
  versions: Array<{
    id: string;
    image_url_1x: string;
  }>;
}

interface HelixBadgesBody {
  data: HelixBadgeSet[];
}

function mergeHelixBadges(
  result: Record<string, string>,
  body: HelixBadgesBody,
): void {
  for (const set of body.data) {
    for (const version of set.versions) {
      result[`${set.set_id}/${version.id}`] = version.image_url_1x;
    }
  }
}

export async function handleTwitchBadges(url: URL): Promise<TwitchBadgesResponse> {
  const broadcasterLogin = url.searchParams.get("broadcasterLogin");
  const token = await getTwitchAppToken();

  const headers = {
    Authorization: `Bearer ${token}`,
    "Client-Id": config.TWITCH_CLIENT_ID,
  };

  const badges: Record<string, string> = {};

  // 1. Global badges
  const globalRes = await fetch("https://api.twitch.tv/helix/chat/badges/global", { headers });
  if (!globalRes.ok) {
    throw new Error(`Helix global badges failed: ${globalRes.status}`);
  }
  const globalBody = (await globalRes.json()) as HelixBadgesBody;
  mergeHelixBadges(badges, globalBody);
  log.info("Global badges fetched", { count: globalBody.data.reduce((n, s) => n + s.versions.length, 0) });

  // 2. Channel-specific badges (subscriber tiers, bits, custom, etc.)
  if (broadcasterLogin) {
    // Resolve login → broadcaster_id
    const userRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(broadcasterLogin)}`,
      { headers },
    );
    if (userRes.ok) {
      const userData = (await userRes.json()) as { data: Array<{ id: string }> };
      const broadcasterId = userData.data[0]?.id;
      if (broadcasterId) {
        const chanRes = await fetch(
          `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${broadcasterId}`,
          { headers },
        );
        if (chanRes.ok) {
          const chanBody = (await chanRes.json()) as HelixBadgesBody;
          mergeHelixBadges(badges, chanBody);
          log.info("Channel badges fetched", {
            channel: broadcasterLogin,
            count: chanBody.data.reduce((n, s) => n + s.versions.length, 0),
          });
        }
      }
    }
  }

  log.info("Badge cache ready", { total: Object.keys(badges).length, channel: broadcasterLogin ?? "global-only" });
  return { badges };
}
