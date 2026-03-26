import { handleStreamStatus } from "../api/stream-status.ts";
import { handleUpdateStream } from "../api/update-stream.ts";
import { handleSearchCategories } from "../api/search-categories.ts";
import { handleTwitchBadges } from "../api/twitch-badges.ts";
import { handleChannelsStatus } from "../api/channels-status.ts";
import { requireClient, json } from "./utils.ts";
import { logger } from "../logger.ts";

const log = logger("routes");

export const streamRoutes = {
  "/api/stream-status": {
    async GET(req: Request) {
      const auth = await requireClient(req);
      if (auth instanceof Response) return auth;
      try {
        const status = await handleStreamStatus(new URL(req.url));
        return json(status);
      } catch (err) {
        log.error("stream-status failed", { err: String(err) });
        return json({ error: String(err) }, 500);
      }
    },
  },

  "/api/update-stream": {
    async POST(req: Request) {
      const auth = await requireClient(req);
      if (auth instanceof Response) return auth;
      try {
        const result = await handleUpdateStream(req);
        return json(result);
      } catch (err) {
        log.error("update-stream failed", { err: String(err) });
        return json({ error: String(err) }, 500);
      }
    },
  },

  "/api/search-categories": {
    async GET(req: Request) {
      const auth = await requireClient(req);
      if (auth instanceof Response) return auth;
      try {
        const result = await handleSearchCategories(new URL(req.url));
        return json(result);
      } catch (err) {
        log.error("search-categories failed", { err: String(err) });
        return json({ error: String(err) }, 500);
      }
    },
  },

  "/api/twitch/badges": {
    async GET(req: Request) {
      try {
        const result = await handleTwitchBadges(new URL(req.url));
        return json(result);
      } catch (err) {
        log.error("twitch/badges failed", { err: String(err) });
        return json({ error: String(err) }, 500);
      }
    },
  },

  "/api/channels-status": {
    async POST(req: Request) {
      const auth = await requireClient(req);
      if (auth instanceof Response) return auth;
      try {
        const result = await handleChannelsStatus(req);
        return json(result);
      } catch (err) {
        log.error("channels-status failed", { err: String(err) });
        return json({ error: String(err) }, 500);
      }
    },
  },
} as const;
