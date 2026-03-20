import { AUTH_SERVER_PORT } from "@twirchat/shared/constants";
import { handleTwitchCallback } from "./twitch";
import { handleYouTubeCallback } from "./youtube";
import { handleKickCallback } from "./kick";

let server: ReturnType<typeof Bun.serve> | null = null;

export function startAuthServer(): void {
  if (server) return;

  server = Bun.serve({
    port: AUTH_SERVER_PORT,
    async fetch(req) {
      const url = new URL(req.url);

      try {
        if (url.pathname === "/auth/twitch/callback") {
          return await handleTwitchCallback(url);
        }
        if (url.pathname === "/auth/youtube/callback") {
          return await handleYouTubeCallback(url);
        }
        if (url.pathname === "/auth/kick/callback") {
          return await handleKickCallback(url);
        }
      } catch (err) {
        console.error("[Auth] Callback error:", err);
        return new Response(errorPage(String(err)), {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`[Auth] OAuth server listening on port ${AUTH_SERVER_PORT}`);
}

export function stopAuthServer(): void {
  server?.stop();
  server = null;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Auth Error</title></head>
<body style="font-family:sans-serif;padding:2rem;background:#1a1a1a;color:#ff6b6b;">
  <h1>Authentication Error</h1>
  <p>${message}</p>
  <p>You can close this window.</p>
</body>
</html>`;
}

export function successPage(platform: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Authentication Successful</title></head>
<body style="font-family:sans-serif;padding:2rem;background:#1a1a1a;color:#4caf50;">
  <h1>Successfully connected to ${platform}!</h1>
  <p>You can close this window and return to TwirChat.</p>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`;
}
