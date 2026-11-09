import { z } from 'zod'

import { createChatToolsService, ChatToolsError, type ChatToolsInput } from '../api/chat-tools'
import { json, requireClient } from './utils'

async function parseInput(req: Request): Promise<ChatToolsInput & { text: string }> {
  const advertised = Number(req.headers.get('content-length'))
  if (advertised > 65536) throw new ChatToolsError('Command request is too large.', 413)
  const bytes = await req.arrayBuffer()
  if (bytes.byteLength > 65536) throw new ChatToolsError('Command request is too large.', 413)
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new ChatToolsError('Request body must be valid JSON.')
  }
  const parsed = z
    .object({
      platform: z.literal('kick'),
      channelSlug: z.string().refine((value) => !!value.trim()),
      accessToken: z.string().refine((value) => !!value.trim()),
      platformUserId: z.string().refine((value) => !!value.trim()),
      scopes: z.array(z.string()),
      text: z.string().default(''),
    })
    .safeParse(value)
  if (!parsed.success) throw new ChatToolsError('Invalid command request.')
  return parsed.data
}

export function createChatToolsRoutes(service = createChatToolsService()) {
  async function handle(req: Request, roomState: boolean): Promise<Response> {
    const client = await requireClient(req)
    if (client instanceof Response) return client
    try {
      const input = await parseInput(req)
      if (roomState)
        throw new ChatToolsError('Room settings are unavailable through the Kick public API.')
      return json(await service.execute(input))
    } catch (error) {
      if (error instanceof ChatToolsError) return json({ error: error.message }, error.status)
      return json({ error: 'The platform request failed. Please try again.' }, 502)
    }
  }
  return {
    '/api/chat-tools/command': { POST: (req: Request) => handle(req, false) },
    '/api/chat-tools/room-state': { POST: (req: Request) => handle(req, true) },
  }
}

export const chatToolsRoutes = createChatToolsRoutes()
