import { logger } from '@twirchat/shared/logger'
import type { AccessTokenWithUserId, AuthProvider } from '@twurple/auth'

import { t } from '../gpuix/i18n'
import { AccountStore } from '../store/account-store'
import { getTwitchDesktopClientId } from './client-config'
import { refreshTwitchToken } from './twitch'

const refreshMarginSeconds = 300
const log = logger('twitch-auth')

/** The account's stored access token, refreshed first when it expires within five minutes. */
export async function currentTwitchAccessToken(accountId: string): Promise<string> {
  const tokens = AccountStore.getTokens(accountId)
  if (!tokens?.accessToken) throw new Error(t('misc.twitchSender.signInAgain'))
  const now = Math.floor(Date.now() / 1000)
  if (!tokens.expiresAt || tokens.expiresAt >= now + refreshMarginSeconds) return tokens.accessToken
  try {
    return await refreshTwitchToken(accountId)
  } catch (error) {
    if (tokens.expiresAt > now) return tokens.accessToken
    throw error
  }
}

/** For optional enrichment: the current token, or undefined when the account has none usable. */
export function twitchAccessTokenIfAvailable(accountId: string): Promise<string | undefined> {
  return currentTwitchAccessToken(accountId).catch(() => undefined)
}

/**
 * Twurple asks its auth provider for a token on every (re)connect. Reading the account's
 * stored token each time keeps chat connections that outlive a token (about four hours)
 * signed in, instead of retrying with the token captured when the connection opened.
 */
export function createTwitchChatAuthProvider(accountId: string): AuthProvider {
  let issued: string | undefined

  function issue(accessToken: string): AccessTokenWithUserId {
    const account = AccountStore.findById(accountId)
    const tokens = AccountStore.getTokens(accountId)
    if (!account || !tokens) throw new Error(t('misc.twitchSender.signInAgain'))
    issued = accessToken
    const expiresAt = tokens.accessToken === accessToken ? tokens.expiresAt : undefined
    return {
      accessToken,
      refreshToken: null,
      scope: account.scopes,
      expiresIn: expiresAt ? Math.max(0, expiresAt - Math.floor(Date.now() / 1000)) : null,
      obtainmentTimestamp: Date.now(),
      userId: account.platformUserId,
    }
  }

  const current = async () => issue(await currentTwitchAccessToken(accountId))

  async function refresh(): Promise<AccessTokenWithUserId> {
    // Another connection of this account may have refreshed already, and Twitch refresh
    // tokens of public clients are single-use: take the stored token instead.
    const stored = AccountStore.getTokens(accountId)?.accessToken
    if (stored && issued && stored !== issued) return issue(stored)
    log.info('Twitch chat rejected the token; refreshing', { platform: 'twitch' })
    return issue(await refreshTwitchToken(accountId))
  }

  return {
    get clientId() {
      return getTwitchDesktopClientId()
    },
    getCurrentScopesForUser: () => AccountStore.findById(accountId)?.scopes ?? [],
    getAccessTokenForUser: current,
    getAccessTokenForIntent: current,
    getAnyAccessToken: current,
    refreshAccessTokenForUser: refresh,
    refreshAccessTokenForIntent: refresh,
  }
}
