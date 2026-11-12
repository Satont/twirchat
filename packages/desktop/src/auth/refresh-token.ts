import { logger } from '@twirchat/shared/logger'

import { t } from '../gpuix/i18n'
import { AccountStore } from '../store/account-store'
import { postOAuthForm } from './oauth-form'
import { expiresAt, hasOAuthErrorMessage, oauthTokenSchema } from './response-schemas'

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

export function createOAuthRefresher(
  platform: 'Twitch' | 'YouTube',
  tokenUrl: string,
  credentials: () => Record<string, string>,
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
    const res = await postOAuthForm(tokenUrl, {
      ...credentials(),
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
    })
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
    const response: unknown = await res.json()
    const data =
      platform === 'Twitch'
        ? oauthTokenSchema.required({ refresh_token: true }).parse(response)
        : oauthTokenSchema.parse(response)
    const current = currentTokens()
    if (current.accessToken !== stored.accessToken || current.refreshToken !== stored.refreshToken)
      return current.accessToken
    AccountStore.updateTokens(
      accountId,
      data.access_token,
      data.refresh_token ?? stored.refreshToken,
      expiresAt(data.expires_in),
    )
    return data.access_token
  }

  return (accountId: string): Promise<string> => {
    const pending = inFlight.get(accountId)
    if (pending) return pending
    const refreshRequest = refresh(accountId).finally(() => inFlight.delete(accountId))
    inFlight.set(accountId, refreshRequest)
    return refreshRequest
  }
}
