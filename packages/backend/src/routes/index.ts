import type { WsData } from "../ws/connection-manager.ts";
import { ClientStore, AccountStore } from "../db/index.ts";
import { startKickOAuth } from "../auth/kick.ts";
import { handleKickWebhook } from "../auth/kick-webhook.ts";
import type { AuthStartRequest, AuthStartResponse, AccountsResponse, Platform } from "@chatrix/shared";

/** Middleware: validate X-Client-Secret header and ensure client exists in DB */
async function requireClient(req: Request): Promise<{ clientSecret: string } | Response> {
  const secret = req.headers.get("X-Client-Secret");
  if (!secret) {
    return new Response(JSON.stringify({ error: "Missing X-Client-Secret header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Auto-register new clients (first connection)
  await ClientStore.upsert(secret);

  return { clientSecret: secret };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // WebSocket upgrade — handled by Bun.serve websocket option directly
  // (this function only handles HTTP routes)

  // POST /api/auth/kick/start
  if (req.method === "POST" && url.pathname === "/api/auth/kick/start") {
    const body = (await req.json()) as AuthStartRequest;
    if (!body.clientSecret) {
      return json({ error: "clientSecret is required" }, 400);
    }

    await ClientStore.upsert(body.clientSecret);

    try {
      const authUrl = await startKickOAuth(body.clientSecret);
      return json({ url: authUrl } satisfies AuthStartResponse);
    } catch (err) {
      console.error("[auth/kick/start]", err);
      return json({ error: "Failed to start OAuth" }, 500);
    }
  }

  // GET /auth/kick/callback  — browser redirect after OAuth
  if (req.method === "GET" && url.pathname === "/auth/kick/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return new Response("Missing code or state", { status: 400 });
    }

    try {
      const { handleKickCallback } = await import("../auth/kick.ts");
      await handleKickCallback(code, state);
      return new Response(
        "<html><body><h2>Kick connected! You can close this tab.</h2></body></html>",
        { headers: { "Content-Type": "text/html" } }
      );
    } catch (err) {
      console.error("[auth/kick/callback]", err);
      return new Response(
        `<html><body><h2>OAuth failed: ${String(err)}</h2></body></html>`,
        { status: 500, headers: { "Content-Type": "text/html" } }
      );
    }
  }

  // GET /api/accounts
  if (req.method === "GET" && url.pathname === "/api/accounts") {
    const auth = await requireClient(req);
    if (auth instanceof Response) return auth;

    const accounts = await AccountStore.findAllByClient(auth.clientSecret);
    return json({
      accounts: accounts.map((a) => ({
        platform: a.platform as Platform,
        username: a.username,
        displayName: a.displayName,
        avatarUrl: a.avatarUrl,
        connectedAt: a.createdAt.getTime(),
      })),
    } satisfies AccountsResponse);
  }

  // DELETE /api/accounts/:platform
  if (req.method === "DELETE" && url.pathname.startsWith("/api/accounts/")) {
    const auth = await requireClient(req);
    if (auth instanceof Response) return auth;

    const platform = url.pathname.split("/").pop() ?? "";
    await AccountStore.delete(auth.clientSecret, platform);
    return json({ ok: true });
  }

  // POST /webhook/kick  — Kick event webhooks
  if (req.method === "POST" && url.pathname === "/webhook/kick") {
    return handleKickWebhook(req);
  }

  // Health check
  if (url.pathname === "/health") {
    return json({ ok: true, connections: 0 });
  }

  return json({ error: "Not found" }, 404);
}

export type { WsData };
