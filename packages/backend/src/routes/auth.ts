import { ClientStore } from "../db/index.ts";
import { startKickOAuth, handleKickCallback } from "../auth/kick.ts";
import { exchangeTwitchCode, refreshTwitchToken } from "../auth/twitch.ts";
import { json } from "./utils.ts";
import { logger } from "../logger.ts";
import type {
  AuthStartRequest,
  AuthStartResponse,
  TwitchExchangeRequest,
  TwitchExchangeResponse,
  TwitchRefreshRequest,
  TwitchRefreshResponse,
  // @ts-ignore — false positive in tsgo for workspace packages
} from "@twirchat/shared";

const log = logger("auth");

export const authRoutes = {
  "/api/auth/kick/start": {
    async POST(req: Request) {
      const body = (await req.json()) as AuthStartRequest;
      if (!body.clientSecret) {
        return json({ error: "clientSecret is required" }, 400);
      }
      await ClientStore.upsert(body.clientSecret);
      try {
        const url = await startKickOAuth(body.clientSecret);
        return json({ url } satisfies AuthStartResponse);
      } catch (err) {
        log.error("kick/start failed", { err: String(err) });
        return json({ error: "Failed to start OAuth" }, 500);
      }
    },
  },

  "/auth/kick/callback": {
    async GET(req: Request) {
      const url = new URL(req.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        return new Response("Missing code or state", { status: 400 });
      }
      try {
        await handleKickCallback(code, state);
        return new Response(
          "<html><body><h2>Kick connected! You can close this tab.</h2></body></html>",
          { headers: { "Content-Type": "text/html" } },
        );
      } catch (err) {
        log.error("kick/callback failed", { err: String(err) });
        return new Response(
          `<html><body><h2>OAuth failed: ${String(err)}</h2></body></html>`,
          { status: 500, headers: { "Content-Type": "text/html" } },
        );
      }
    },
  },

  "/api/auth/twitch/exchange": {
    async POST(req: Request) {
      const body = (await req.json()) as TwitchExchangeRequest;
      if (!body.code || !body.codeVerifier || !body.redirectUri) {
        return json({ error: "code, codeVerifier, and redirectUri are required" }, 400);
      }
      try {
        const tokens = await exchangeTwitchCode(body.code, body.codeVerifier, body.redirectUri);
        return json(tokens satisfies TwitchExchangeResponse);
      } catch (err) {
        log.error("twitch/exchange failed", { err: String(err) });
        return json({ error: String(err) }, 500);
      }
    },
  },

  "/api/auth/twitch/refresh": {
    async POST(req: Request) {
      const body = (await req.json()) as TwitchRefreshRequest;
      if (!body.refreshToken) {
        return json({ error: "refreshToken is required" }, 400);
      }
      try {
        const tokens = await refreshTwitchToken(body.refreshToken);
        return json(tokens satisfies TwitchRefreshResponse);
      } catch (err) {
        log.error("twitch/refresh failed", { err: String(err) });
        return json({ error: String(err) }, 500);
      }
    },
  },
} as const;
