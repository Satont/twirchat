import { ClientStore } from "../db/index.ts";
import { startKickOAuth, handleKickCallback, refreshKickToken, buildKickAuthUrl, exchangeKickCode } from "../auth/kick.ts";
import { exchangeTwitchCode, refreshTwitchToken, buildTwitchAuthUrl } from "../auth/twitch.ts";
import { buildYouTubeAuthUrl, exchangeYouTubeCode, refreshYouTubeToken } from "../auth/youtube.ts";
import { json } from "./utils.ts";
import { logger } from "../logger.ts";
import type {
  AuthStartRequest,
  AuthStartResponse,
  KickBuildUrlRequest,
  KickBuildUrlResponse,
  KickExchangeRequest,
  KickExchangeResponse,
  KickRefreshRequest,
  KickRefreshResponse,
  TwitchBuildUrlRequest,
  TwitchBuildUrlResponse,
  TwitchExchangeRequest,
  TwitchExchangeResponse,
  TwitchRefreshRequest,
  TwitchRefreshResponse,
  YouTubeBuildUrlRequest,
  YouTubeBuildUrlResponse,
  YouTubeExchangeRequest,
  YouTubeExchangeResponse,
  YouTubeRefreshRequest,
  YouTubeRefreshResponse,
  // @ts-ignore — false positive in tsgo for workspace packages
} from "@twirchat/shared";

const log = logger("auth");

export const authRoutes = {
  // ============================================================
  // Kick OAuth — HTTP-based flow (new)
  // ============================================================

  "/api/auth/kick/start": {
    async POST(req: Request) {
      const body = (await req.json()) as KickBuildUrlRequest;
      if (!body.codeChallenge || !body.state || !body.redirectUri) {
        return json({ error: "codeChallenge, state, and redirectUri are required" }, 400);
      }
      try {
        const { url } = buildKickAuthUrl(body.codeChallenge, body.state, body.redirectUri);
        return json({ url } satisfies KickBuildUrlResponse);
      } catch (err) {
        log.error("kick/start failed", { err: String(err) });
        return json({ error: "Failed to build auth URL" }, 500);
      }
    },
  },

  "/api/auth/kick/exchange": {
    async POST(req: Request) {
      const body = (await req.json()) as KickExchangeRequest;
      if (!body.code || !body.codeVerifier || !body.redirectUri) {
        return json({ error: "code, codeVerifier, and redirectUri are required" }, 400);
      }
      try {
        const tokens = await exchangeKickCode(body.code, body.codeVerifier, body.redirectUri);
        return json(tokens satisfies KickExchangeResponse);
      } catch (err) {
        log.error("kick/exchange failed", { err: String(err) });
        return json({ error: String(err) }, 500);
      }
    },
  },

  "/api/auth/kick/refresh": {
    async POST(req: Request) {
      const body = (await req.json()) as KickRefreshRequest;
      if (!body.refreshToken) {
        return json({ error: "refreshToken is required" }, 400);
      }
      try {
        const tokens = await refreshKickToken(body.refreshToken);
        return json(tokens satisfies KickRefreshResponse);
      } catch (err) {
        log.error("kick/refresh failed", { err: String(err) });
        return json({ error: String(err) }, 500);
      }
    },
  },

  // ============================================================
  // Kick OAuth — Legacy WebSocket-based flow
  // ============================================================

  "/api/auth/kick/legacy-start": {
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
        log.error("kick/legacy-start failed", { err: String(err) });
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

  // ============================================================
  // Twitch OAuth — HTTP-based flow
  // ============================================================

  "/api/auth/twitch/start": {
    async POST(req: Request) {
      const body = (await req.json()) as TwitchBuildUrlRequest;
      if (!body.codeChallenge || !body.state || !body.redirectUri) {
        return json({ error: "codeChallenge, state, and redirectUri are required" }, 400);
      }
      try {
        const { url } = buildTwitchAuthUrl(body.codeChallenge, body.state, body.redirectUri);
        return json({ url } satisfies TwitchBuildUrlResponse);
      } catch (err) {
        log.error("twitch/start failed", { err: String(err) });
        return json({ error: "Failed to build auth URL" }, 500);
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

  // ============================================================
  // YouTube OAuth — HTTP-based flow
  // ============================================================

  "/api/auth/youtube/start": {
    async POST(req: Request) {
      const body = (await req.json()) as YouTubeBuildUrlRequest;
      if (!body.codeChallenge || !body.state || !body.redirectUri) {
        return json({ error: "codeChallenge, state, and redirectUri are required" }, 400);
      }
      try {
        const { url } = buildYouTubeAuthUrl(body.codeChallenge, body.state, body.redirectUri);
        return json({ url } satisfies YouTubeBuildUrlResponse);
      } catch (err) {
        log.error("youtube/start failed", { err: String(err) });
        return json({ error: "Failed to build auth URL" }, 500);
      }
    },
  },

  "/api/auth/youtube/exchange": {
    async POST(req: Request) {
      const body = (await req.json()) as YouTubeExchangeRequest;
      if (!body.code || !body.codeVerifier || !body.redirectUri) {
        return json({ error: "code, codeVerifier, and redirectUri are required" }, 400);
      }
      try {
        const tokens = await exchangeYouTubeCode(body.code, body.codeVerifier, body.redirectUri);
        return json(tokens satisfies YouTubeExchangeResponse);
      } catch (err) {
        log.error("youtube/exchange failed", { err: String(err) });
        return json({ error: String(err) }, 500);
      }
    },
  },

  "/api/auth/youtube/refresh": {
    async POST(req: Request) {
      const body = (await req.json()) as YouTubeRefreshRequest;
      if (!body.refreshToken) {
        return json({ error: "refreshToken is required" }, 400);
      }
      try {
        const tokens = await refreshYouTubeToken(body.refreshToken);
        return json(tokens satisfies YouTubeRefreshResponse);
      } catch (err) {
        log.error("youtube/refresh failed", { err: String(err) });
        return json({ error: String(err) }, 500);
      }
    },
  },
} as const;
