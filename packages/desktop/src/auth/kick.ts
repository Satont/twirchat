import {
  KICK_AUTH_URL,
  KICK_TOKEN_URL,
  KICK_REDIRECT_URI,
} from "@chatrix/shared/constants";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "./pkce";
import { AccountStore } from "@desktop/store/account-store";
import { successPage } from "./server";

const KICK_SCOPES = ["user:read", "channel:read", "chat:write", "events:subscribe"];

// В памяти храним pending PKCE-сессии (state → {verifier, expiresAt})
const pendingSessions = new Map<string, { verifier: string; expiresAt: number }>();

export interface KickAuthConfig {
  clientId: string;
  clientSecret: string;
}

let _config: KickAuthConfig | null = null;

export function configureKickAuth(config: KickAuthConfig): void {
  _config = config;
}

export function getKickAuthConfig(): KickAuthConfig | null {
  return _config;
}

/**
 * Строит URL для открытия в браузере. Возвращает {url, state}.
 */
export function buildKickAuthUrl(): { url: string; state: string } {
  if (!_config) throw new Error("Kick auth not configured");

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();

  // TTL: 10 минут
  pendingSessions.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });

  const params = new URLSearchParams({
    client_id: _config.clientId,
    redirect_uri: KICK_REDIRECT_URI,
    response_type: "code",
    scope: KICK_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return { url: `${KICK_AUTH_URL}?${params.toString()}`, state };
}

/**
 * Обработчик GET /auth/kick/callback
 */
export async function handleKickCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    throw new Error(`Kick OAuth error: ${error} — ${url.searchParams.get("error_description") ?? ""}`);
  }

  if (!code || !state) {
    throw new Error("Missing code or state in Kick callback");
  }

  const session = pendingSessions.get(state);
  if (!session) throw new Error("Unknown or expired OAuth state");
  if (Date.now() > session.expiresAt) {
    pendingSessions.delete(state);
    throw new Error("OAuth session expired");
  }
  pendingSessions.delete(state);

  if (!_config) throw new Error("Kick auth not configured");

  // Обмен кода на токен
  const tokenRes = await fetch(KICK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: _config.clientId,
      client_secret: _config.clientSecret,
      code,
      redirect_uri: KICK_REDIRECT_URI,
      code_verifier: session.verifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Kick token exchange failed: ${tokenRes.status} ${body}`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  // Получаем информацию о пользователе
  const userRes = await fetch("https://api.kick.com/public/v1/user", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error(`Kick user fetch failed: ${userRes.status}`);
  }

  const userBody = (await userRes.json()) as {
    data?: {
      id: number;
      username: string;
      name: string;
      profile_picture?: string;
    };
  };

  const user = userBody.data;
  if (!user) throw new Error("Kick user data missing");

  const expiresAt = tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : undefined;

  AccountStore.upsert({
    id: `kick:${user.id}`,
    platform: "kick",
    platformUserId: String(user.id),
    username: user.username,
    displayName: user.name,
    avatarUrl: user.profile_picture,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    scopes: tokens.scope?.split(" "),
  });

  console.log(`[Kick Auth] Logged in as ${user.name} (@${user.username})`);

  return new Response(successPage("Kick"), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Обновление токена Kick через refresh_token
 */
export async function refreshKickToken(accountId: string): Promise<string> {
  if (!_config) throw new Error("Kick auth not configured");

  const tokens = AccountStore.getTokens(accountId);
  if (!tokens?.refreshToken) throw new Error("No refresh token for Kick account");

  const res = await fetch(KICK_TOKEN_URL, {
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
    throw new Error(`Kick token refresh failed: ${res.status}`);
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
