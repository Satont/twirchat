import type { KickRefreshRequest } from '@twirchat/shared'
import { z } from 'zod'

import { t } from '../gpuix/i18n'
import { kickBackendFailure } from '../platforms/kick/retry'
import { refreshedTokenSchema } from './response-schemas'

export interface KickRefreshCredentials {
  accessToken: string
  refreshToken: string
  expiresAt?: number
}
export interface KickRefreshContext {
  channelSlug?: string
  manual?: boolean
}
export interface KickRefreshReply {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}
export class KickRefreshRequestError extends Error {
  constructor(
    message: string,
    readonly kind: 'transient' | 'reauthorize' = 'transient',
  ) {
    super(message)
    this.name = 'KickRefreshRequestError'
  }
}
export class KickTokenRefreshError extends Error {
  constructor(
    message: string,
    readonly kind: 'transient' | 'reauthorize' | 'stale',
  ) {
    super(message)
    this.name = 'KickTokenRefreshError'
  }
}
interface KickRefreshProblem {
  message: string
  kind: 'transient' | 'reauthorize'
}
interface RefreshBlock {
  error: KickRefreshProblem
  retryAt: number | null
  failedAt: number
}
export interface KickRefreshEntry {
  credentials: KickRefreshCredentials
  failures: number
  completedAt?: number
  inFlight?: Promise<string>
  block?: RefreshBlock
}
interface KickRefreshDependencies {
  state: Map<string, KickRefreshEntry>
  now(): number
  read(accountId: string): KickRefreshCredentials | null
  request(credentials: KickRefreshCredentials): Promise<KickRefreshReply>
  persist(accountId: string, credentials: KickRefreshCredentials): void
  failed(
    accountId: string,
    error: KickTokenRefreshError,
    retryAt: number | null,
    context: KickRefreshContext,
  ): void
}

function sameCredentials(
  left: KickRefreshCredentials | null,
  right: KickRefreshCredentials,
): boolean {
  return (
    left !== null &&
    left.accessToken === right.accessToken &&
    left.refreshToken === right.refreshToken &&
    left.expiresAt === right.expiresAt
  )
}

function requestProblem(error: unknown): KickRefreshProblem {
  if (
    error instanceof Error &&
    error.name === 'KickRefreshRequestError' &&
    'kind' in error &&
    (error.kind === 'transient' || error.kind === 'reauthorize')
  )
    return { message: error.message, kind: error.kind }
  return {
    message: t('misc.kickRefresh.requestFailed'),
    kind: 'transient',
  }
}

export function createKickTokenRefresher(dependencies: KickRefreshDependencies) {
  return function refresh(accountId: string, context: KickRefreshContext = {}): Promise<string> {
    const credentials = dependencies.read(accountId)
    if (!credentials) {
      dependencies.state.delete(accountId)
      return Promise.reject(new KickTokenRefreshError(t('misc.kickRefresh.noCredentials'), 'stale'))
    }
    let entry = dependencies.state.get(accountId)
    if (!entry || !sameCredentials(credentials, entry.credentials)) {
      entry = { credentials, failures: 0 }
      dependencies.state.set(accountId, entry)
    }
    if (entry.inFlight) return entry.inFlight
    const now = dependencies.now()
    if (entry.block) {
      const { retryAt, failedAt, error } = entry.block
      const manualRetry = context.manual === true && now - failedAt >= 5000
      if (retryAt === null || (now < retryAt && !manualRetry)) {
        // Retained HMR state stores data, not a previous module's Error prototype.
        entry.block.error = { message: error.message, kind: error.kind }
        return Promise.reject(new KickTokenRefreshError(error.message, error.kind))
      }
    }
    if (entry.completedAt !== undefined && now - entry.completedAt < 5000)
      return Promise.reject(
        new KickTokenRefreshError(t('misc.kickRefresh.refreshedRecently'), 'transient'),
      )
    const current = entry
    current.block = undefined
    const stillCurrent = () => {
      if (dependencies.state.get(accountId) !== current) return false
      const stored = dependencies.read(accountId)
      if (!stored) dependencies.state.delete(accountId)
      return sameCredentials(stored, credentials)
    }
    const task = Promise.resolve()
      .then(async () => {
        try {
          const reply = await dependencies.request(credentials)
          if (!stillCurrent())
            throw new KickTokenRefreshError(t('misc.kickRefresh.accountChanged'), 'stale')
          const updated: KickRefreshCredentials = {
            accessToken: reply.accessToken,
            refreshToken: reply.refreshToken ?? credentials.refreshToken,
            expiresAt: reply.expiresAt,
          }
          dependencies.persist(accountId, updated)
          current.credentials = updated
          current.failures = 0
          current.completedAt = dependencies.now()
          return updated.accessToken
        } catch (error) {
          if (!stillCurrent())
            throw new KickTokenRefreshError(t('misc.kickRefresh.accountChanged'), 'stale')
          const failure = requestProblem(error)
          const problem = new KickTokenRefreshError(failure.message, failure.kind)
          current.failures = Math.min(current.failures + 1, 3)
          const failedAt = dependencies.now()
          const retryAt =
            problem.kind === 'reauthorize'
              ? null
              : failedAt + Math.min(60000, 15000 * 2 ** (current.failures - 1))
          current.block = { error: failure, retryAt, failedAt }
          dependencies.failed(accountId, problem, retryAt, context)
          throw problem
        }
      })
      .finally(() => {
        current.inFlight = undefined
      })
    current.inFlight = task
    return task
  }
}

export async function requestKickRefresh(
  stored: KickRefreshCredentials,
  fetcher: (path: string, init: RequestInit) => Promise<Response>,
  now: () => number,
): Promise<KickRefreshReply> {
  let response: Response
  try {
    response = await fetcher('/api/auth/kick/refresh', {
      body: JSON.stringify({ refreshToken: stored.refreshToken } satisfies KickRefreshRequest),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    throw new KickRefreshRequestError(kickBackendFailure(error))
  }
  if (!response.ok) {
    const details = z
      .object({ error: z.string().optional(), error_description: z.string().optional() })
      .safeParse(await response.json().catch(() => null))
    const reason = details.success
      ? `${details.data.error ?? ''} ${details.data.error_description ?? ''}`
      : ''
    const permanent =
      /\binvalid_grant\b|\binvalid_refresh_token\b|refresh[ _-]token.{0,80}(?:expired|revoked|invalid)/iu.test(
        reason,
      )
    throw new KickRefreshRequestError(
      permanent
        ? t('misc.kickRefresh.rejected')
        : t('misc.kickRefresh.backendHttp', { status: response.status }),
      permanent ? 'reauthorize' : 'transient',
    )
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new KickRefreshRequestError(
      error instanceof SyntaxError ? t('misc.kickRefresh.invalidJson') : kickBackendFailure(error),
    )
  }
  const parsed = refreshedTokenSchema
    .extend({
      accessToken: z.string().min(1),
      refreshToken: z.string().min(1).optional(),
      expiresIn: z.number().int().positive().optional(),
    })
    .safeParse(payload)
  if (!parsed.success) throw new KickRefreshRequestError(t('misc.kickRefresh.invalidToken'))
  return {
    accessToken: parsed.data.accessToken,
    refreshToken: parsed.data.refreshToken,
    expiresAt:
      parsed.data.expiresIn === undefined
        ? undefined
        : Math.floor(now() / 1000) + parsed.data.expiresIn,
  }
}
