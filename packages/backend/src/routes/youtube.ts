/**
 * GET /api/youtube/resolve?handle=<handle>
 *
 * Resolves a YouTube channel handle / username to a stable channel ID (UCxxxx).
 * Results are cached in the DB for 30 days — channel IDs practically never change.
 *
 * Uses a plain API key (no OAuth required).  If YOUTUBE_API_KEY is not set in the
 * environment the endpoint responds with 503.
 *
 * Resolution order:
 *   1. If the input already looks like a channel ID (starts with UC) → return as-is
 *   2. Check DB cache (available_until > NOW())
 *   3. Call channels?forHandle=  (YouTube @handle, 1 quota unit)
 *   4. Fall back to channels?forUsername=  (legacy custom URL, 1 quota unit)
 */

import { YoutubeChannelCacheStore } from "../db/index.ts";
import { json } from "./utils.ts";
import { config } from "../config.ts";
import { logger } from "@twirchat/shared/logger";

const log = logger("youtube-resolve");

const YT_API = "https://www.googleapis.com/youtube/v3";

export const youtubeRoutes = {
  "/api/youtube/resolve": {
    async GET(req: Request) {
      const url = new URL(req.url);
      const raw = url.searchParams.get("handle");
      if (!raw) {
        return json({ error: "Missing required query param: handle" }, 400);
      }

      // Normalise: strip leading @, trim whitespace
      const handle = raw.replace(/^@/, "").trim();
      if (!handle) {
        return json({ error: "handle must not be empty" }, 400);
      }

      // 1. Already a channel ID — return directly, no API call needed
      if (/^UC/i.test(handle)) {
        log.debug("handle is already a channel ID", { handle });
        return json({ channelId: handle });
      }

      // 2. Cache hit
      const cached = await YoutubeChannelCacheStore.get(handle);
      if (cached) {
        log.debug("cache hit", { handle, channelId: cached });
        return json({ channelId: cached });
      }

      // 3. Resolve via API key
      if (!config.YOUTUBE_API_KEY) {
        return json(
          { error: "YOUTUBE_API_KEY is not configured on the server" },
          503,
        );
      }

      const channelId = await resolveHandle(handle, config.YOUTUBE_API_KEY);
      if (!channelId) {
        return json(
          { error: `Could not resolve "${handle}" to a YouTube channel` },
          404,
        );
      }

      await YoutubeChannelCacheStore.upsert(handle, channelId);
      log.info("resolved and cached", { handle, channelId });
      return json({ channelId });
    },
  },
} as const;

// ---------------------------------------------------------------------------

async function resolveHandle(
  handle: string,
  apiKey: string,
): Promise<string | null> {
  // Try @handle first
  const forHandle = await ytChannels(
    `forHandle=${encodeURIComponent(handle)}`,
    apiKey,
  );
  if (forHandle) return forHandle;

  // Fall back to legacy forUsername
  const forUsername = await ytChannels(
    `forUsername=${encodeURIComponent(handle)}`,
    apiKey,
  );
  return forUsername;
}

async function ytChannels(
  queryParam: string,
  apiKey: string,
): Promise<string | null> {
  const url = `${YT_API}/channels?part=id&${queryParam}&key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      log.warn("YouTube channels API error", {
        status: res.status,
        body: body.slice(0, 300),
      });
      return null;
    }
    const data = (await res.json()) as {
      items?: Array<{ id: string }>;
    };
    return data.items?.[0]?.id ?? null;
  } catch (err) {
    log.error("YouTube channels API fetch failed", { error: String(err) });
    return null;
  }
}
