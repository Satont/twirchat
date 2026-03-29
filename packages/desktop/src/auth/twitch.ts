/**
 * Twitch OAuth — desktop side (PKCE flow).
 *
 * Flow:
 *  1. Desktop generates PKCE (codeVerifier, codeChallenge, state) — stored in-memory
 *  2. Desktop sends POST /api/auth/twitch/start { codeChallenge, state, redirectUri } to backend
 *  3. Backend builds the Twitch authUrl and returns it
 *  4. Desktop opens the URL in the browser
 *  5. Twitch redirects to http://localhost:45821/auth/twitch/callback?code=...&state=...
 *  6. Desktop validates state, grabs codeVerifier from memory
 *  7. Desktop calls POST /api/auth/twitch/exchange on backend → receives tokens
 *  8. Desktop fetches user info from Twitch, saves account to SQLite
 *
 * Refresh:
 *  - Desktop calls POST /api/auth/twitch/refresh on backend → receives new tokens
 *  - Desktop updates the account record in SQLite
 */

import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from "./pkce";
import { AccountStore } from "../store/account-store";
import { successPage } from "./server";
import { BACKEND_URL, TWITCH_REDIRECT_URI } from "@twirchat/shared/constants";
import { logger } from "@twirchat/shared/logger";
import type {
  TwitchBuildUrlRequest,
  TwitchBuildUrlResponse,
  TwitchExchangeRequest,
  TwitchExchangeResponse,
  TwitchRefreshRequest,
  TwitchRefreshResponse,
} from "@twirchat/shared";

const log = logger("auth-twitch");

// ----------------------------------------------------------------
// In-memory PKCE session store (state → { codeVerifier, expiresAt })
// ----------------------------------------------------------------

const pendingSessions = new Map<
  string,
  { codeVerifier: string; expiresAt: number }
>();

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Clean up expired sessions periodically */
function cleanupSessions(): void {
  const now = Date.now();
  for (const [state, session] of pendingSessions) {
    if (now > session.expiresAt) {
      pendingSessions.delete(state);
    }
  }
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Generates PKCE params, stores the session in memory, and returns
 * { codeChallenge, state } so the caller can send request to backend
 * to build the Twitch auth URL.
 */
export function prepareTwitchAuth(): { codeChallenge: string; state: string } {
  cleanupSessions();

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  pendingSessions.set(state, {
    codeVerifier,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  return { codeChallenge, state };
}

/**
 * Requests the auth URL from backend by sending PKCE params.
 * Returns the URL to open in browser.
 */
export async function getTwitchAuthUrl(
  codeChallenge: string,
  state: string,
): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/auth/twitch/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      codeChallenge,
      state,
      redirectUri: TWITCH_REDIRECT_URI,
    } satisfies TwitchBuildUrlRequest),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twitch auth URL request failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as TwitchBuildUrlResponse;
  return data.url;
}

/**
 * Handles GET /auth/twitch/callback from the local auth server.
 * Validates state, exchanges code for tokens via the backend, fetches
 * user info from Twitch, and persists the account in SQLite.
 */
export async function handleTwitchCallback(url: URL): Promise<{
  response: Response;
  user: { platform: "twitch"; username: string; displayName: string };
  channelSlug: string;
}> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    throw new Error(
      `Twitch OAuth error: ${error} — ${url.searchParams.get("error_description") ?? ""}`,
    );
  }

  if (!code || !state) {
    throw new Error("Missing code or state in Twitch callback");
  }

  const session = pendingSessions.get(state);
  if (!session) throw new Error("Unknown or expired OAuth state");
  if (Date.now() > session.expiresAt) {
    pendingSessions.delete(state);
    throw new Error("OAuth session expired");
  }
  pendingSessions.delete(state);

  // Exchange code for tokens via backend proxy
  const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/twitch/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      codeVerifier: session.codeVerifier,
      redirectUri: TWITCH_REDIRECT_URI,
    } satisfies TwitchExchangeRequest),
  });

  if (!exchangeRes.ok) {
    const body = await exchangeRes.text();
    throw new Error(
      `Twitch token exchange failed: ${exchangeRes.status} ${body}`,
    );
  }

  const tokens = (await exchangeRes.json()) as TwitchExchangeResponse;

  // Validate the token and get user info — the /oauth2/validate endpoint only
  // requires the Bearer token, no client credentials needed on the desktop side.
  const validateRes = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${tokens.accessToken}` },
  });

  if (!validateRes.ok) {
    throw new Error(`Twitch token validation failed: ${validateRes.status}`);
  }

  const validateData = (await validateRes.json()) as {
    user_id: string;
    login: string;
    client_id: string;
    expires_in: number;
    scopes: string[];
  };

  const expiresAt = tokens.expiresIn
    ? Math.floor(Date.now() / 1000) + tokens.expiresIn
    : undefined;

  AccountStore.upsert({
    id: `twitch:${validateData.user_id}`,
    platform: "twitch",
    platformUserId: validateData.user_id,
    username: validateData.login,
    displayName: validateData.login, // Twitch validate endpoint doesn't return display name; good enough for now
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt,
    scopes: validateData.scopes,
  });

  log.info(`Logged in as @${validateData.login}`);

  return {
    response: new Response(successPage("Twitch"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
    user: {
      platform: "twitch" as const,
      username: validateData.login,
      displayName: validateData.login,
    },
    channelSlug: validateData.login,
  };
}

/**
 * Refreshes the Twitch access token for the given accountId via the backend proxy.
 * Updates the stored tokens in SQLite and returns the new access token.
 */
export async function refreshTwitchToken(accountId: string): Promise<string> {
  const stored = AccountStore.getTokens(accountId);
  if (!stored?.refreshToken) {
    throw new Error("No refresh token for Twitch account");
  }

  const res = await fetch(`${BACKEND_URL}/api/auth/twitch/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refreshToken: stored.refreshToken,
    } satisfies TwitchRefreshRequest),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twitch token refresh failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as TwitchRefreshResponse;

  const expiresAt = data.expiresIn
    ? Math.floor(Date.now() / 1000) + data.expiresIn
    : undefined;

  AccountStore.updateTokens(
    accountId,
    data.accessToken,
    data.refreshToken,
    expiresAt,
  );

  return data.accessToken;
}
