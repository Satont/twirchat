import { z } from 'zod'

import { ChatToolsError } from '../api/chat-tools'
import {
  createTwitchActivitiesService,
  type TwitchActivitiesCredentials,
} from '../api/twitch-activities'
import {
  twitchCredentialsSchema,
  twitchActivityActionSchema,
  snapshotPartsSchema,
} from './twitch-activity-schemas'
import { json, requireClient } from './utils'

function credentials(body: Record<string, unknown>): TwitchActivitiesCredentials {
  const parsed = twitchCredentialsSchema.safeParse(body)
  if (!parsed.success)
    throw new ChatToolsError('Twitch account credentials and scopes are required.', 401)
  return parsed.data
}

export function createTwitchActivitiesRoutes(service = createTwitchActivitiesService()) {
  return {
    '/api/twitch/activities': {
      async POST(req: Request): Promise<Response> {
        const auth = await requireClient(req)
        if (auth instanceof Response) return auth
        try {
          const bytes = await req.arrayBuffer()
          if (bytes.byteLength > 65536)
            throw new ChatToolsError('Activity request is too large.', 413)
          let raw: unknown
          try {
            raw = JSON.parse(new TextDecoder().decode(bytes))
          } catch {
            throw new ChatToolsError('Invalid JSON request.')
          }
          if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw new ChatToolsError('Activity request must be an object.')
          const body = z.record(z.string(), z.unknown()).parse(raw)
          if (body.operation === 'validate_session') {
            if (typeof body.token !== 'string')
              throw new ChatToolsError('A web session token is required.')
            return json(await service.validateWebSession(body.token))
          }
          const account = credentials(body)
          switch (body.operation) {
            case 'snapshot':
              return json(
                await service.snapshot(
                  account,
                  z.string().parse(body.channelSlug),
                  snapshotPartsSchema.optional().parse(body.sections),
                ),
              )
            case 'reward_queue_summary':
              return json(
                await service.rewardQueueSummary(account, z.string().parse(body.channelSlug)),
              )
            case 'action':
              if (!body.action || typeof body.action !== 'object' || Array.isArray(body.action))
                throw new ChatToolsError('An activity action is required.')
              return json(
                await service.execute(account, twitchActivityActionSchema.parse(body.action)),
              )
            case 'redemptions':
              return json(
                await service.redemptions(
                  account,
                  z
                    .object({
                      channelSlug: z.string(),
                      rewardId: z.string(),
                      cursor: z.string().optional(),
                      status: z.enum(['UNFULFILLED', 'FULFILLED', 'CANCELED']).optional(),
                    })
                    .parse(body),
                ),
              )
            case 'following':
              return json(
                await service.following(
                  account,
                  z
                    .object({ cursor: z.string().optional(), liveOnly: z.boolean().optional() })
                    .parse(body),
                ),
              )
            case 'subscribe':
              return json(
                await service.subscribe(
                  account,
                  z.string().parse(body.sessionId),
                  typeof body.channelSlug === 'string' ? body.channelSlug : undefined,
                ),
              )
            case 'unsubscribe':
              await service.unsubscribe(account, z.array(z.string()).parse(body.ids))
              return json({ success: true })
            default:
              throw new ChatToolsError('Unknown activity operation.')
          }
        } catch (error) {
          if (error instanceof ChatToolsError) return json({ error: error.message }, error.status)
          if (error instanceof z.ZodError) return json({ error: 'Invalid activity request.' }, 400)
          return json({ error: 'Twitch activity request failed. Please try again.' }, 502)
        }
      },
    },
  }
}
export const twitchActivitiesRoutes = createTwitchActivitiesRoutes()
