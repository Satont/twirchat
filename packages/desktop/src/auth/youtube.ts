import {
  YOUTUBE_AUTH_URL,
  YOUTUBE_TOKEN_URL,
  YOUTUBE_REDIRECT_URI,
} from "@twirchat/shared/constants";
import { generateState } from "./pkce";
import { AccountStore } from "@desktop/store/account-store";
import { successPage } from "./server";

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

const pendingStates = new Map<string, { expiresAt: number }>();

export interface YouTubeAuthConfig {
  clientId: string;
  clientSecret: string;
}

let _config: YouTubeAuthConfig | null = null;

export function configureYouTubeAuth(config: YouTubeAuthConfig): void {
  _config = config;
}

export function getYouTubeAuthConfig(): YouTubeAuthConfig | null {
  return _config;
}

export function buildYouTubeAuthUrl(): { url: string; state: string } {
  if (!_config) throw new Error("YouTube auth not configured");

  const state = generateState();
  pendingStates.set(state, { expiresAt: Date.now() + 10 * 60 * 1000 });

  const params = new URLSearchParams({
    client_id: _config.clientId,
    redirect_uri: YOUTUBE_REDIRECT_URI,
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return { url: `${YOUTUBE_AUTH_URL}?${params.toString()}`, state };
}

export async function handleYouTubeCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    throw new Error(`YouTube OAuth error: ${error}`);
  }

  if (!code || !state) {
    throw new Error("Missing code or state in YouTube callback");
  }

  const session = pendingStates.get(state);
  if (!session) throw new Error("Unknown or expired OAuth state");
  if (Date.now() > session.expiresAt) {
    pendingStates.delete(state);
    throw new Error("OAuth session expired");
  }
  pendingStates.delete(state);

  if (!_config) throw new Error("YouTube auth not configured");

  const tokenRes = await fetch(YOUTUBE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: _config.clientId,
      client_secret: _config.clientSecret,
      code,
      redirect_uri: YOUTUBE_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(
      `YouTube token exchange failed: ${tokenRes.status} ${body}`,
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  // Получаем информацию о пользователе через YouTube Data API
  const userRes = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    },
  );

  if (!userRes.ok) {
    throw new Error(`YouTube user fetch failed: ${userRes.status}`);
  }

  const userData = (await userRes.json()) as {
    items?: Array<{
      id: string;
      snippet: {
        title: string;
        customUrl?: string;
        thumbnails?: { default?: { url: string } };
      };
    }>;
  };

  const channel = userData.items?.[0];
  if (!channel) throw new Error("YouTube channel data missing");

  const expiresAt = tokens.expires_in
    ? Math.floor(Date.now() / 1000) + tokens.expires_in
    : undefined;

  AccountStore.upsert({
    id: `youtube:${channel.id}`,
    platform: "youtube",
    platformUserId: channel.id,
    username: channel.snippet.customUrl ?? channel.id,
    displayName: channel.snippet.title,
    avatarUrl: channel.snippet.thumbnails?.default?.url,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    scopes: tokens.scope?.split(" "),
  });

  console.log(`[YouTube Auth] Logged in as ${channel.snippet.title}`);

  return new Response(successPage("YouTube"), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function refreshYouTubeToken(accountId: string): Promise<string> {
  if (!_config) throw new Error("YouTube auth not configured");

  const tokens = AccountStore.getTokens(accountId);
  if (!tokens?.refreshToken)
    throw new Error("No refresh token for YouTube account");

  const res = await fetch(YOUTUBE_TOKEN_URL, {
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
    throw new Error(`YouTube token refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };

  const expiresAt = data.expires_in
    ? Math.floor(Date.now() / 1000) + data.expires_in
    : undefined;
  // YouTube не всегда возвращает новый refresh_token
  AccountStore.updateTokens(
    accountId,
    data.access_token,
    tokens.refreshToken,
    expiresAt,
  );

  return data.access_token;
}
