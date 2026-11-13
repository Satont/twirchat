import { logger } from '@twirchat/shared/logger'

import { t } from '../gpuix/i18n'
import { AccountStore } from '../store/account-store'
import { expiresAt, hasOAuthErrorMessage } from './response-schemas'

const log = logger('oauth')

export class OAuthRefreshError extends Error {
  constructor(
    platform: 'Twitch' | 'YouTube',
    readonly status: number,
    readonly invalidRefreshToken = false,
  ) {
    super(t('runtime.auth.refreshFailed', { platform, status }))
    this.name = 'OAuthRefreshError'
  }
}

export interface RefreshedTokens {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}

export interface OAuthRefreshTransport {
  /** Sends the refresh request; a refusal must keep the provider's status and `message`. */
  request(refreshToken: string): Promise<Response>
  parse(payload: unknown): RefreshedTokens
}

export function createOAuthRefresher(
  platform: 'Twitch' | 'YouTube',
  transport: OAuthRefreshTransport,
) {
  const inFlight = new Map<string, Promise<string>>()

  async function refresh(accountId: string): Promise<string> {
    const stored = AccountStore.getTokens(accountId)
    if (!stored?.refreshToken) throw new Error(t('runtime.auth.signInToRefresh', { platform }))
    const currentTokens = () => {
      const current = AccountStore.getTokens(accountId)
      if (current) return current
      const message = AccountStore.findById(accountId)
        ? 'runtime.auth.signInToRefresh'
        : 'runtime.auth.removedDuringRefresh'
      throw new Error(t(message, { platform }))
    }
    const res = await transport.request(stored.refreshToken)
    if (!res.ok) {
      const invalidRefreshToken =
        platform === 'Twitch' &&
        (res.status === 400 || res.status === 401) &&
        (await hasOAuthErrorMessage(res, 'invalid refresh token'))
      if (invalidRefreshToken) {
        const current = currentTokens()
        if (
          current.accessToken !== stored.accessToken ||
          current.refreshToken !== stored.refreshToken
        )
          return current.accessToken
      }
      log.warn('Token refresh refused', {
        platform: platform.toLowerCase(),
        status: res.status,
        reason: invalidRefreshToken ? 'invalid_refresh_token' : 'transient',
      })
      throw new OAuthRefreshError(platform, res.status, invalidRefreshToken)
    }
    const data = transport.parse(await res.json())
    const current = currentTokens()
    if (current.accessToken !== stored.accessToken || current.refreshToken !== stored.refreshToken)
      return current.accessToken
    AccountStore.updateTokens(
      accountId,
      data.accessToken,
      data.refreshToken ?? stored.refreshToken,
      expiresAt(data.expiresIn),
    )
    return data.accessToken
  }

  return (accountId: string): Promise<string> => {
    const pending = inFlight.get(accountId)
    if (pending) return pending
    const refreshRequest = refresh(accountId).finally(() => inFlight.delete(accountId))
    inFlight.set(accountId, refreshRequest)
    return refreshRequest
  }
}
