import { generateCodeVerifier, generateCodeChallenge, generateState } from "./pkce.ts";
import { KickOAuthSessionStore, AccountStore } from "../db/index.ts";
import { connectionManager } from "../ws/connection-manager.ts";
import { subscribeKickEvents } from "./kick-subscriptions.ts";

const KICK_CLIENT_ID = process.env["KICK_CLIENT_ID"] ?? "";
const KICK_CLIENT_SECRET = process.env["KICK_CLIENT_SECRET"] ?? "";
const KICK_REDIRECT_URI = process.env["KICK_REDIRECT_URI"] ?? "http://localhost:3000/auth/kick/callback";

const KICK_AUTH_URL = "https://id.kick.com/oauth/authorize";
const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";

interface KickTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface KickUserResponse {
  data: {
    id: number;
    username: string;
    name: string;
    profile_picture?: string;
  };
}

export async function startKickOAuth(clientSecret: string): Promise<string> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  await KickOAuthSessionStore.create({ state, clientSecret, codeVerifier });

  const params = new URLSearchParams({
    client_id: KICK_CLIENT_ID,
    redirect_uri: KICK_REDIRECT_URI,
    response_type: "code",
    scope: "user:read channel:read chat:write",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${KICK_AUTH_URL}?${params.toString()}`;
}

export async function handleKickCallback(
  code: string,
  state: string
): Promise<void> {
  const session = await KickOAuthSessionStore.consume(state);
  if (!session) {
    throw new Error("Invalid or expired OAuth state");
  }

  // Exchange code for tokens
  const tokenRes = await fetch(KICK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: KICK_CLIENT_ID,
      client_secret: KICK_CLIENT_SECRET,
      redirect_uri: KICK_REDIRECT_URI,
      code,
      code_verifier: session.codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Kick token exchange failed: ${tokenRes.status} ${body}`);
  }

  const tokens = (await tokenRes.json()) as KickTokenResponse;

  // Fetch user info
  const userRes = await fetch("https://api.kick.com/public/v1/user", {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Client-ID": KICK_CLIENT_ID,
    },
  });

  if (!userRes.ok) {
    throw new Error(`Failed to fetch Kick user: ${userRes.status}`);
  }

  const user = (await userRes.json()) as KickUserResponse;
  const userData = user.data;

  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const scopes = tokens.scope ? tokens.scope.split(" ") : [];

  // Persist account in Postgres
  await AccountStore.upsert({
    clientSecret: session.clientSecret,
    platform: "kick",
    platformUserId: String(userData.id),
    username: userData.username,
    displayName: userData.name,
    avatarUrl: userData.profile_picture,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiresAt,
    scopes,
  });

  // Subscribe to Kick webhook events for this user's channel
  try {
    await subscribeKickEvents(tokens.access_token, KICK_CLIENT_ID);
  } catch (err) {
    console.error("[Kick OAuth] Failed to subscribe to events:", err);
    // Non-fatal: auth still succeeded; events subscription can be retried later
  }

  // Push auth_success to desktop via WS
  connectionManager.send(session.clientSecret, {
    type: "auth_success",
    platform: "kick",
    username: userData.username,
    displayName: userData.name,
  });
}
