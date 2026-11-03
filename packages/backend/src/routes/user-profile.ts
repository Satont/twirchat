import { z } from 'zod'

import { createUserProfileService } from '../api/user-profile'
import { json, requireClient } from './utils'

export function createUserProfileRoutes(service = createUserProfileService()) {
  return {
    '/api/user-profile': {
      async POST(req: Request) {
        const client = await requireClient(req)
        if (client instanceof Response) return client
        try {
          const raw = await req.text()
          if (raw.length > 16384) return json({ error: 'Profile request is too large.' }, 413)
          const parsed = z
            .object({
              platform: z.literal('twitch'),
              platformUserId: z.string().regex(/^\d+$/),
              channelSlug: z
                .string()
                .regex(/^[#a-zA-Z0-9_]{1,32}$/)
                .optional(),
              twitchAuth: z
                .object({
                  accessToken: z.string(),
                  platformUserId: z.string(),
                  scopes: z.array(z.string()),
                })
                .optional(),
            })
            .safeParse(JSON.parse(raw))
          if (!parsed.success) return json({ error: 'Invalid Twitch profile request.' }, 400)
          const body = parsed.data
          return json(await service(body))
        } catch {
          return json({ error: 'Unable to load this Twitch profile.' }, 502)
        }
      },
    },
  }
}
export const userProfileRoutes = createUserProfileRoutes()
