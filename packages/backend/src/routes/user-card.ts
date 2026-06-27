import { fetchUserCardMetadata } from "../api/user-card-metadata.ts";
import { json, requireClient } from "./utils.ts";
import { logger } from "@twirchat/shared";

const log = logger("user-card-route");

export const userCardRoutes = {
  "/api/user-card-metadata": {
    async POST(req: Request) {
      const auth = await requireClient(req);
      if (auth instanceof Response) return auth;

      try {
        const body =
          (await req
            .json()) as import("@twirchat/shared").UserCardMetadataBackendRequest;
        const { platform, platformUserId } = body;

        if ((platform !== "twitch" && platform !== "kick") || !platformUserId) {
          return json({
            error: "platform=twitch|kick and platformUserId are required",
          }, 400);
        }

        return json(await fetchUserCardMetadata(body));
      } catch (err) {
        log.error("user-card-metadata failed", { err: String(err) });
        return json({ error: String(err) }, 500);
      }
    },
  },
} as const;
