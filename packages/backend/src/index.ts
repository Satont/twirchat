import { runMigrations } from "./db/migrations.ts";
import { ClientStore } from "./db/index.ts";
import { connectionManager } from "./ws/connection-manager.ts";
import { handleWsOpen, handleWsClose, handleWsMessage } from "./ws/handlers.ts";
import { handleRequest } from "./routes/index.ts";
import type { WsData } from "./ws/connection-manager.ts";
import { config } from "./config.ts";

const PORT = config.PORT;

// Run DB migrations on startup
await runMigrations();

const server = Bun.serve<WsData>({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade at /ws
    if (url.pathname === "/ws") {
      const secret = req.headers.get("X-Client-Secret");
      if (!secret) {
        return new Response(
          JSON.stringify({ error: "Missing X-Client-Secret" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Ensure client exists
      await ClientStore.upsert(secret);

      const upgraded = server.upgrade(req, { data: { clientSecret: secret } });
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
      return undefined;
    }

    return handleRequest(req);
  },

  websocket: {
    open(ws) {
      void handleWsOpen(ws);
    },
    message(ws, message) {
      void handleWsMessage(ws, message);
    },
    close(ws) {
      handleWsClose(ws);
    },
  },
});

console.log(
  `[Backend] TwirChat backend running on http://localhost:${server.port}`,
);
console.log(`[Backend] WebSocket endpoint: ws://localhost:${server.port}/ws`);
