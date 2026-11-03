import { z } from 'zod'

import { createEmoteCatalogService, EmoteCatalogError } from '../api/emote-catalog'
import { json, requireClient } from './utils'

export function createEmoteCatalogRoutes(service = createEmoteCatalogService()) {
  return {
    '/api/emote-catalog/twitch/channel': {
      async POST(req: Request): Promise<Response> {
        const client = await requireClient(req)
        if (client instanceof Response) return client
        try {
          if (Number(req.headers.get('content-length')) > 1024)
            return json({ error: 'Channel request is too large.' }, 413)
          const bytes = await req.arrayBuffer()
          if (bytes.byteLength > 1024) return json({ error: 'Channel request is too large.' }, 413)
          let value: unknown
          try {
            value = JSON.parse(new TextDecoder().decode(bytes))
          } catch {
            throw new EmoteCatalogError('Request body must be valid JSON.')
          }
          const parsed = z.object({ channelSlug: z.string() }).safeParse(value)
          if (!parsed.success) return json({ error: 'channelSlug is required.' }, 400)
          return json(await service.resolveTwitchChannel(parsed.data.channelSlug))
        } catch (error) {
          if (error instanceof EmoteCatalogError)
            return json({ error: error.message }, error.status)
          return json({ error: 'Unable to resolve Twitch channel.' }, 502)
        }
      },
    },
    '/api/emote-catalog/twitch': {
      async POST(req: Request): Promise<Response> {
        const client = await requireClient(req)
        if (client instanceof Response) return client
        try {
          if (Number(req.headers.get('content-length')) > 8192)
            throw new EmoteCatalogError('Emote catalog request is too large.', 413)
          const bytes = await req.arrayBuffer()
          if (bytes.byteLength > 8192)
            throw new EmoteCatalogError('Emote catalog request is too large.', 413)
          let value: unknown
          try {
            value = JSON.parse(new TextDecoder().decode(bytes))
          } catch {
            throw new EmoteCatalogError('Request body must be valid JSON.')
          }
          const parsed = z
            .object({
              channelSlug: z.string(),
              userAccessToken: z.string().optional(),
              force: z.boolean().optional(),
            })
            .safeParse(value)
          if (!parsed.success)
            throw new EmoteCatalogError('channelSlug and optional userAccessToken must be strings.')
          return json(await service.getTwitchEmotes(parsed.data))
        } catch (error) {
          return error instanceof EmoteCatalogError
            ? json({ error: error.message }, error.status)
            : json({ error: 'Could not load Twitch emotes. Please try again.' }, 502)
        }
      },
    },
  }
}

export const emoteCatalogRoutes = createEmoteCatalogRoutes()
