/**
 * TwirChat OBS Overlay Server
 *
 * Serves the overlay page (built by Vite into dist/overlay/) and a WebSocket
 * endpoint that pushes chat messages and events to connected OBS browser
 * sources in real time.
 *
 * URL for OBS: http://localhost:45823/?bg=transparent&fontSize=14&maxMessages=20
 *
 * Query parameters (all optional):
 *   bg          — background color / "transparent" (default: transparent)
 *   textColor   — text color hex (default: #ffffff)
 *   fontSize    — font size in px (default: 14)
 *   fontFamily  — CSS font-family (default: sans-serif)
 *   maxMessages — max visible messages (default: 20)
 *   timeout     — auto-remove message after N seconds, 0 = never (default: 0)
 *   showPlatform — show platform icon 1/0 (default: 1)
 *   showAvatar  — show avatar 1/0 (default: 1)
 *   showBadges  — show badges 1/0 (default: 1)
 *   animation   — slide | fade | none (default: slide)
 *   position    — bottom | top (default: bottom)
 *   platforms   — comma-separated filter e.g. "twitch,kick" (default: all)
 */

import type { NormalizedChatMessage, NormalizedEvent } from "@twirchat/shared";
import { existsSync } from "node:fs";
import { extname, join } from "path";
import { logger } from "@twirchat/shared";
import {
  buildMessageParts,
  type MessagePart,
} from "./views/shared/utils/messageParts";

const log = logger("overlay-server");

// ============================================================
// Overlay WS message types (server → browser)
// ============================================================

export interface OverlayChatMessage {
  message: NormalizedChatMessage;
  parts: MessagePart[];
}

export type OverlayMessage =
  | { type: "chat_message"; data: OverlayChatMessage }
  | { type: "chat_event"; data: NormalizedEvent }
  | { type: "clear" };

// ============================================================
// Connected OBS browser-source WebSocket clients
// ============================================================

const clients = new Set<WebSocket>();

interface OverlayRuntimePaths {
  fontsDir: string | null;
  overlayDir: string | null;
}

// ============================================================
// Public API — called from src/main.ts
// ============================================================

export function pushOverlayMessage(msg: NormalizedChatMessage): void {
  const payload: OverlayMessage = {
    data: { message: msg, parts: buildMessageParts(msg) },
    type: "chat_message",
  };
  const json = JSON.stringify(payload, replacer);
  for (const ws of clients) {
    try {
      ws.send(json);
    } catch (error) {
      clients.delete(ws);
      log.warn("Failed to send overlay chat message", { error: String(error) });
    }
  }
}

export function pushOverlayEvent(event: NormalizedEvent): void {
  const payload: OverlayMessage = { data: event, type: "chat_event" };
  const json = JSON.stringify(payload, replacer);
  for (const ws of clients) {
    try {
      ws.send(json);
    } catch (error) {
      clients.delete(ws);
      log.warn("Failed to send overlay chat event", { error: String(error) });
    }
  }
}

export function clearOverlay(): void {
  const payload: OverlayMessage = { type: "clear" };
  const json = JSON.stringify(payload);
  for (const ws of clients) {
    try {
      ws.send(json);
    } catch (error) {
      clients.delete(ws);
      log.warn("Failed to send overlay clear event", { error: String(error) });
    }
  }
}

// ============================================================
// Server
// ============================================================

export function resolveOverlayRuntimePaths(
  baseDir: string,
  pathExists: (path: string) => boolean = existsSync,
): OverlayRuntimePaths {
  const overlayCandidates = [
    join(baseDir, "dist", "overlay"),
    join(baseDir, "views", "overlay"),
    join(baseDir, "..", "dist", "overlay"),
    join(baseDir, "..", "views", "overlay"),
  ]

  const fontCandidates = [
    join(baseDir, "public", "fonts"),
    join(baseDir, "views", "fonts"),
    join(baseDir, "..", "public", "fonts"),
    join(baseDir, "..", "views", "fonts"),
  ]

  return {
    overlayDir: overlayCandidates.find(pathExists) ?? null,
    fontsDir: fontCandidates.find(pathExists) ?? null,
  }
}

function createMissingResponse(
  kind: "fonts" | "overlay",
  pathname: string,
): Response {
  log.error("Overlay asset root missing", { kind, pathname });

  return new Response(`Missing ${kind} asset root`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    status: 500,
  });
}

async function createFileResponse(
  filePath: string,
  contentType?: string,
): Promise<Response> {
  if (!existsSync(filePath)) {
    log.warn("Overlay file not found", { filePath });
    return new Response("Not found", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      status: 404,
    });
  }

  const data = await Deno.readFile(filePath);
  return new Response(data, {
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
}

let runtimePaths: OverlayRuntimePaths | null = null;

export function initOverlayServer(): void {
  runtimePaths = resolveOverlayRuntimePaths(Deno.cwd())
  log.info('Resolved overlay runtime paths', {
    fontsDir: runtimePaths.fontsDir,
    overlayDir: runtimePaths.overlayDir,
  })
}

export async function handleOverlayRequest(
  req: Request,
): Promise<Response | null> {
  if (!runtimePaths) return null;

  const url = new URL(req.url);
  const pathname = url.pathname;

  // WebSocket upgrade
  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);

    socket.onopen = () => {
      clients.add(socket);
      log.info(`Client connected (total: ${clients.size})`);
    };
    socket.onclose = () => {
      clients.delete(socket);
      log.info(`Client disconnected (total: ${clients.size})`);
    };
    socket.onmessage = () => {};

    return response;
  }

  if (pathname.startsWith("/fonts/")) {
    if (!runtimePaths.fontsDir) return createMissingResponse("fonts", pathname);
    return createFileResponse(
      join(runtimePaths.fontsDir, pathname.slice("/fonts/".length)),
    );
  }

  if (pathname.startsWith("/assets/")) {
    if (!runtimePaths.overlayDir) {
      return createMissingResponse("overlay", pathname);
    }
    return createFileResponse(join(runtimePaths.overlayDir, pathname));
  }

  if (pathname !== "/" && pathname !== "/index.html" && extname(pathname)) {
    return new Response("Not found", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      status: 404,
    });
  }

  if (!runtimePaths.overlayDir) {
    return createMissingResponse("overlay", pathname);
  }

  return createFileResponse(
    join(runtimePaths.overlayDir, "index.html"),
    "text/html; charset=utf-8",
  );
}

// ============================================================
// Helpers
// ============================================================

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
