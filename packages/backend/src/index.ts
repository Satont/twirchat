import { runMigrations } from "./db/migrations.ts";
import { ClientStore } from "./db/index.ts";
import { handleWsClose, handleWsMessage, handleWsOpen } from "./ws/handlers.ts";
import { authRoutes } from "./routes/auth.ts";
import { accountRoutes } from "./routes/accounts.ts";
import { streamRoutes } from "./routes/stream.ts";
import { userCardRoutes } from "./routes/user-card.ts";
import { webhookRoutes } from "./routes/webhooks.ts";
import { youtubeRoutes } from "./routes/youtube.ts";
import { json } from "./routes/utils.ts";
import { config } from "./config.ts";
import { logger } from "@twirchat/shared";
import { handleTwitchBadges } from "./api/twitch-badges.ts";
import { handleSevenTVImageProxy } from "./seventv/index.ts";

const log = logger("backend");

await runMigrations();

handleTwitchBadges(new URL("http://localhost/api/twitch/badges")).catch(
  (error) => {
    log.warn("Failed to prefetch global Twitch badges", { err: String(error) });
  },
);

// Merge all route objects into a single lookup
const routes: Record<
  string,
  Record<string, (req: Request) => Promise<Response> | Response>
> = {
  ...authRoutes,
  ...accountRoutes,
  ...streamRoutes,
  ...userCardRoutes,
  ...webhookRoutes,
  ...youtubeRoutes,
};

// Track connected WebSocket clients
const wsClients = new Map<string, { ws: WebSocket; clientSecret: string }>();

Deno.serve({
  port: config.PORT,
  hostname: "0.0.0.0",

  handler(req, _info) {
    const url = new URL(req.url);
    const method = req.method;

    // 7TV image proxy
    if (url.pathname.startsWith("/proxy/7tv/")) {
      return handleSevenTVImageProxy(req);
    }

    // Health check
    if (url.pathname === "/health") {
      return json({ ok: true });
    }

    // WebSocket upgrade
    if (url.pathname === "/ws" && method === "GET") {
      const secret = req.headers.get("X-Client-Secret");
      if (!secret) {
        return json({ error: "Missing X-Client-Secret" }, 401);
      }

      const { socket, response } = Deno.upgradeWebSocket(req);

      socket.onopen = () => {
        void ClientStore.upsert(secret).then(() => {
          const wsData = { ws: socket, clientSecret: secret };
          wsClients.set(secret, wsData);
          void handleWsOpen(
            {
              data: { clientSecret: secret },
              send: (data: string) => socket.send(data),
              close: () => socket.close(),
            } as unknown as Parameters<typeof handleWsOpen>[0],
          );
        });
      };

      socket.onmessage = (e) => {
        const wsData = wsClients.get(secret);
        if (!wsData) return;
        void handleWsMessage(
          {
            data: { clientSecret: secret },
            send: (data: string) => socket.send(data),
            close: () => socket.close(),
          } as unknown as Parameters<typeof handleWsMessage>[0],
          typeof e.data === "string" ? e.data : String(e.data),
        );
      };

      socket.onclose = () => {
        const wsData = wsClients.get(secret);
        if (wsData) {
          handleWsClose(
            {
              data: { clientSecret: secret },
              send: (data: string) => socket.send(data),
              close: () => socket.close(),
            } as unknown as Parameters<typeof handleWsClose>[0],
          );
          wsClients.delete(secret);
        }
      };

      return response;
    }

    // Route matching — try exact match first, then pattern match
    const routeEntry = routes[url.pathname];

    if (routeEntry) {
      const handler = routeEntry[method];
      if (handler) {
        return handler(req);
      }
    }

    // Pattern matching for parameterized routes (e.g., /api/accounts/:platform)
    for (const [pattern, handlers] of Object.entries(routes)) {
      if (!pattern.includes(":")) continue;
      const handler = handlers[method];
      if (!handler) continue;

      const patternParts = pattern.split("/");
      const pathParts = url.pathname.split("/");
      if (patternParts.length !== pathParts.length) continue;

      const params: Record<string, string> = {};
      let match = true;
      for (let i = 0; i < patternParts.length; i++) {
        const pp = patternParts[i]!;
        if (pp.startsWith(":")) {
          params[pp.slice(1)] = pathParts[i]!;
        } else if (pp !== pathParts[i]) {
          match = false;
          break;
        }
      }

      if (match) {
        // Inject params into request for compatibility with existing handlers
        (req as unknown as Record<string, unknown>).params = params;
        return handler(req);
      }
    }

    return json({ error: "Not found" }, 404);
  },
});

log.info("TwirChat backend running", {
  url: `http://localhost:${config.PORT}`,
});
log.info("WebSocket endpoint", { url: `ws://localhost:${config.PORT}/ws` });
