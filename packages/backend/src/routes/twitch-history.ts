import { z } from 'zod'

import {
  createTwitchHistoryService,
  readTwitchHistoryJson,
  TwitchHistoryError,
} from '../api/twitch-history'
import { json, requireClient } from './utils'

type HistoryService = ReturnType<typeof createTwitchHistoryService>
type Authenticate = typeof requireClient

export function createTwitchHistoryRoutes(
  service: HistoryService,
  authenticate: Authenticate = requireClient,
) {
  return {
    '/api/twitch/history': {
      async POST(req: Request): Promise<Response> {
        const client = await authenticate(req)
        if (client instanceof Response) return client
        try {
          if (Number(req.headers.get('content-length')) > 2048)
            return json({ error: 'History request is too large.' }, 413)
          let body: unknown
          try {
            body = await readTwitchHistoryJson(req, 2048)
          } catch (error) {
            if (error instanceof TwitchHistoryError) throw error
            return json({ error: 'History request must be valid JSON.' }, 400)
          }
          return json(await service.getHistory(body))
        } catch (error) {
          if (error instanceof z.ZodError)
            return json({ error: 'Invalid Twitch history query.' }, 400)
          if (error instanceof TwitchHistoryError)
            return json({ error: error.message, sources: error.sources }, error.status)
          return json({ error: 'Could not load Twitch history.' }, 502)
        }
      },
    },
  }
}
