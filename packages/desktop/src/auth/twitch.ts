import {
  TWITCH_AUTH_URL,
  TWITCH_TOKEN_URL,
  TWITCH_REDIRECT_URI,
} from "@chatrix/shared/constants";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "./pkce";
import { AccountStore } from "@desktop/store/account-store";
import { successPage } from "./server";

const TWITCH_SCOPES = [
  "chat:read",
  "chat:edit",
  "channel:read:subscriptions",
  "channel:read:redemptions",
  "moderator:read:followers",
  "bits:read",
];

const pendingSessions = new Map<string, { verifier: string; expiresAt: number }>();

export interface TwitchAuthConfig {
  clientId: string;
  clientSecret: string;
}

let _config: TwitchAuthConfig | null = null;

export function configureTwitchAuth(config: TwitchAuthConfig): void {
  _config = config;
}

export function getTwitchAuthConfig(): TwitchAuthConfig | null {
  return _config;
}

export function buildTwitchAuthUrl(): { url: string; state: string } {
  if (!_config) throw new Error("Twitch auth not configured");

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();

  pendingSessions.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });

  const params = new URLSearchParams({
    client_id: _config.clientId,
    redirect_uri: TWITCH_REDIRECT_URI,
    response_type: "code",
    scope: TWITCH_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return { url: `${TWITCH_AUTH_URL}?${params.toString()}`, state };
}

export async function handleTwitchCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    throw new Error(`Twitch OAuth error: ${error}`);
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

  if (!_config) throw new Error("Twitch auth not configured");

  const tokenRes = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: _config.clientId,
      client_secret: _config.clientSecret,
      code,
      redirect_uri: TWITCH_REDIRECT_URI,
      code_verifier: session.verifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Twitch token exchange failed: ${tokenRes.status} ${body}`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string[];
  };

  // Получаем информацию о пользователе через Twitch API
  const userRes = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Client-Id": _config.clientId,
    },
  });

  if (!userRes.ok) {
    throw new Error(`Twitch user fetch failed: ${userRes.status}`);
  }

  const userData = (await userRes.json()) as {
    data: Array<{
      id: string;
      login: string;
      display_name: string;
      profile_image_url: string;
    }>;
  };

  const user = userData.data[0];
  if (!user) throw new Error("Twitch user data missing");

  const expiresAt = tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : undefined;

  AccountStore.upsert({
    id: `twitch:${user.id}`,
    platform: "twitch",
    platformUserId: user.id,
    username: user.login,
    displayName: user.display_name,
    avatarUrl: user.profile_image_url,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    scopes: tokens.scope,
  });

  console.log(`[Twitch Auth] Logged in as ${user.display_name} (@${user.login})`);

  return new Response(successPage("Twitch"), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function refreshTwitchToken(accountId: string): Promise<string> {
  if (!_config) throw new Error("Twitch auth not configured");

  const tokens = AccountStore.getTokens(accountId);
  if (!tokens?.refreshToken) throw new Error("No refresh token for Twitch account");

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: _config.clientId,
      client_secret: _config.clientSecret,
      refresh_token: tokens.refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`Twitch token refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const expiresAt = data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : undefined;
  AccountStore.updateTokens(accountId, data.access_token, data.refresh_token, expiresAt);

  return data.access_token;
}
