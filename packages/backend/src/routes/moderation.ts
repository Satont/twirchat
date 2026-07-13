import {
  createModerationService,
  type ModerationCapabilityInput,
  type ModerationInput,
  type ModerationService,
} from '../api/moderation/service.ts'
import { json, requireClient } from './utils.ts'
import { logger } from '@twirchat/shared/logger'

const log = logger('moderation-routes')

export function createModerationRoutes(service: ModerationService = createModerationService()) {
  return {
    '/api/moderation/capabilities': {
      async POST(req: Request) {
        const client = await requireClient(req)
        if (client instanceof Response) return client

        try {
          return json(await service.getCapabilities(await parseCapabilitiesInput(req)))
        } catch (error) {
          log.warn('moderation capability check failed', { error: errorMessage(error) })
          return json({ canModerate: false })
        }
      },
    },
    '/api/moderation/action': {
      async POST(req: Request) {
        const client = await requireClient(req)
        if (client instanceof Response) return client

        try {
          return json(await service.execute(await parseModerationInput(req)))
        } catch (error) {
          const message = errorMessage(error)
          log.warn('moderation action rejected', { error: message })
          return json({ success: false, error: { message } })
        }
      },
    },
  } as const
}

export const moderationRoutes = createModerationRoutes()

async function parseCapabilitiesInput(req: Request): Promise<ModerationCapabilityInput> {
  const body = await parseObject(req)
  return {
    accessToken: requireString(body, 'accessToken'),
    channelSlug: requireString(body, 'channelSlug'),
    platform: requirePlatform(body),
    platformUserId: requireString(body, 'platformUserId'),
    scopes: requireStringArray(body, 'scopes'),
  }
}

async function parseModerationInput(req: Request): Promise<ModerationInput> {
  const body = await parseObject(req)
  const durationSeconds = body.durationSeconds
  if (durationSeconds !== undefined && typeof durationSeconds !== 'number') {
    throw new Error('durationSeconds must be a number')
  }

  return {
    ...(await parseCapabilitiesInputFromBody(body)),
    action: requireAction(body),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    messageId: requireString(body, 'messageId'),
    targetUserId: requireString(body, 'targetUserId'),
  }
}

async function parseCapabilitiesInputFromBody(
  body: Record<string, unknown>,
): Promise<ModerationCapabilityInput> {
  return {
    accessToken: requireString(body, 'accessToken'),
    channelSlug: requireString(body, 'channelSlug'),
    platform: requirePlatform(body),
    platformUserId: requireString(body, 'platformUserId'),
    scopes: requireStringArray(body, 'scopes'),
  }
}

async function parseObject(req: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new Error('request body must be valid JSON')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('request body must be an object')
  }
  return body as Record<string, unknown>
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} is required`)
  }
  return value
}

function requireStringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key]
  if (!Array.isArray(value) || !value.every((scope) => typeof scope === 'string')) {
    throw new Error(`${key} must be an array of strings`)
  }
  return value
}

function requirePlatform(body: Record<string, unknown>): 'twitch' | 'kick' {
  const platform = requireString(body, 'platform')
  if (platform !== 'twitch' && platform !== 'kick') {
    throw new Error(`unsupported moderation platform ${platform}`)
  }
  return platform
}

function requireAction(body: Record<string, unknown>): 'delete_message' | 'timeout' | 'ban' {
  const action = requireString(body, 'action')
  if (action !== 'delete_message' && action !== 'timeout' && action !== 'ban') {
    throw new Error(`unsupported moderation action ${action}`)
  }
  return action
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
