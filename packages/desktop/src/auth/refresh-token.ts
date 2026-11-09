import { t } from '../gpuix/i18n'
import { AccountStore } from '../store/account-store'
import { postOAuthForm } from './oauth-form'
import { expiresAt, oauthTokenSchema } from './response-schemas'

export class OAuthRefreshError extends Error {
  constructor(
    platform: 'Twitch' | 'YouTube',
    readonly status: number,
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
    const res = await postOAuthForm(tokenUrl, {
      ...credentials(),
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
    })
    if (!res.ok) throw new OAuthRefreshError(platform, res.status)
    const response: unknown = await res.json()
    const data =
      platform === 'Twitch'
        ? oauthTokenSchema.required({ refresh_token: true }).parse(response)
        : oauthTokenSchema.parse(response)
    const current = AccountStore.getTokens(accountId)
    if (!current) throw new Error(t('runtime.auth.removedDuringRefresh', { platform }))
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
