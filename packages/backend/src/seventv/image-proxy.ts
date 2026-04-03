import { logger } from "@twirchat/shared/logger";

const log = logger("seventv:proxy");

const SEVENTV_CDN_BASE = "https://cdn.7tv.app/emote";

export async function handleSevenTVImageProxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const emoteId = pathParts[pathParts.length - 1];
  
  const size = url.searchParams.get("size") || "4x";
  const format = url.searchParams.get("format") || "webp";

  if (!emoteId || emoteId === "7tv") {
    return new Response("Missing emote ID", { status: 400 });
  }

  const sevenTvUrl = `${SEVENTV_CDN_BASE}/${emoteId}/${size}.${format}`;

  try {
    const response = await fetch(sevenTvUrl, {
      headers: {
        Accept: req.headers.get("Accept") || "image/webp,image/avif,*/*",
      },
    });

    if (!response.ok) {
      log.error("7TV CDN error", { 
        status: response.status, 
        emoteId,
        url: sevenTvUrl,
      });
      return new Response("Failed to fetch image", { status: response.status });
    }

    // Clone response with CORS headers
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=86400"); // 24h cache
    headers.set("X-Proxy-By", "twirchat");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    log.error("Proxy error", { error: String(error), emoteId });
    return new Response("Internal error", { status: 500 });
  }
}