import { logger } from '@twirchat/shared'
import type { Account, Platform } from '@twirchat/shared/types'

import { t } from '../i18n'
import { runInBackground } from './background-task'

const log = logger('account-sessions')

export interface AccountSessionDependencies {
  find(id: string): Account | null
  active(platform: Platform): Account | null
  select(platform: Platform, accountId: string | null): Account | null
  remove(id: string): void
  removeSession?(account: Account): Promise<void>
  disconnect(platform: Platform): Promise<void>
  refreshIdentity(platform: Platform): Promise<void> | void
  connectOwn(platform: Platform, account: Account | null, signal?: AbortSignal): Promise<void>
  reconnectWatched(platform: Platform, signal?: AbortSignal): Promise<void>
  changed(platform: Platform, identityChanged: boolean): void
}

/** One identity transition at a time per platform, without changing watched records or layouts. */
export function createAccountSessions(dependencies: AccountSessionDependencies) {
  const queues = new Map<Platform, Promise<void>>()
  const startupAttempts = new Map<Platform, symbol>()
  const disconnecting = new Map<Platform, Promise<void>>()
  const lifetime = new AbortController()
  let startupStopped = false
  let disposal: Promise<void> | undefined

  function stopStartupConnections(): void {
    startupStopped = true
    startupAttempts.clear()
  }

  function disconnect(platform: Platform): Promise<void> {
    startupAttempts.delete(platform)
    const pending = disconnecting.get(platform)
    if (pending) return pending
    const next = Promise.resolve()
      .then(() => dependencies.disconnect(platform))
      .finally(() => disconnecting.delete(platform))
    disconnecting.set(platform, next)
    return next
  }

  async function disconnectAll(platforms: readonly Platform[]): Promise<void> {
    const results = await Promise.allSettled(platforms.map(disconnect))
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected')
        log.warn('Own chat shutdown failed', {
          platform: platforms[index],
          error: String(result.reason),
        })
    }
  }

  async function connectAtStartup(
    account: Pick<Account, 'platform' | 'id' | 'username'>,
    { connect, onConnected }: { connect: () => Promise<void>; onConnected: () => void },
  ): Promise<void> {
    if (startupStopped) return
    const { platform, id, username } = account
    const attempt = Symbol()
    startupAttempts.set(platform, attempt)
    const isCurrent = () => {
      if (startupAttempts.get(platform) !== attempt) return false
      const active = dependencies.active(platform)
      return active?.id === id && active.username === username
    }
    try {
      await connect()
      if (isCurrent()) onConnected()
    } finally {
      if (startupAttempts.get(platform) === attempt) startupAttempts.delete(platform)
    }
  }

  function enqueue(platform: Platform, operation: () => Promise<void>): Promise<void> {
    if (disposal) return Promise.resolve()
    const pending = (queues.get(platform) ?? Promise.resolve())
      .catch(() => {})
      .then(() => (disposal ? undefined : operation()))
    queues.set(platform, pending)
    runInBackground(
      pending
        .finally(() => {
          if (queues.get(platform) === pending) queues.delete(platform)
        })
        .catch(() => {}),
      'account-sessions background operation failed',
    )
    return pending
  }
  function resolve(platform: Platform, accountId: string | null): Account | null {
    const account = accountId === null ? null : dependencies.find(accountId)
    if (accountId !== null && (!account || account.platform !== platform))
      throw new Error(t('notices.accounts.platformMismatch'))
    return account
  }
  async function transition(
    platform: Platform,
    accountId: string | null,
    force: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted()
    resolve(platform, accountId)
    if (!force && (dependencies.active(platform)?.id ?? null) === accountId) return
    const connectionSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
    await disconnect(platform)
    if (disposal) return
    signal?.throwIfAborted()
    const account = dependencies.select(platform, accountId)
    if (accountId === null) log.info('Active account deactivated', { platform })
    const failures: string[] = []
    try {
      try {
        await dependencies.refreshIdentity(platform)
      } catch (error) {
        failures.push(String(error))
      }
      if (disposal) return
      signal?.throwIfAborted()
      const connected = await Promise.allSettled([
        dependencies.connectOwn(platform, account, connectionSignal),
        dependencies.reconnectWatched(platform, connectionSignal),
      ])
      for (const result of connected)
        if (result.status === 'rejected') failures.push(String(result.reason))
    } finally {
      if (!connectionSignal.aborted) dependencies.changed(platform, true)
    }
    if (disposal) return
    signal?.throwIfAborted()
    if (failures.length)
      throw new Error(t('notices.accounts.reconnectFailed', { failures: failures.join('; ') }))
  }
  return {
    connectAtStartup,
    stopStartupConnections,
    get isDisposed() {
      return disposal !== undefined
    },
    dispose(platforms: readonly Platform[]): Promise<void> {
      if (disposal) return disposal
      stopStartupConnections()
      disposal = disconnectAll(platforms)
      lifetime.abort()
      return disposal
    },
    select(
      platform: Platform,
      accountId: string | null,
      force = false,
      signal?: AbortSignal,
    ): Promise<void> {
      if (disposal) return Promise.resolve()
      try {
        resolve(platform, accountId)
      } catch (error) {
        return Promise.reject(error)
      }
      return enqueue(platform, () => transition(platform, accountId, force, signal))
    },
    reconnectOwn(platform: Platform): Promise<void> {
      return enqueue(platform, async () => {
        await disconnect(platform)
        if (disposal) return
        await dependencies.refreshIdentity(platform)
        if (disposal) return
        await dependencies.connectOwn(platform, dependencies.active(platform), lifetime.signal)
      })
    },
    forget(accountId: string, isCurrent = () => true): Promise<void> {
      if (disposal) return Promise.resolve()
      const requested = dependencies.find(accountId)
      if (!requested) return Promise.reject(new Error(t('notices.accounts.missing')))
      return enqueue(requested.platform, async () => {
        const account = dependencies.find(accountId)
        if (!account || !isCurrent()) return
        if (dependencies.active(account.platform)?.id === accountId)
          await transition(account.platform, null, false)
        if (disposal || !isCurrent()) return
        await dependencies.removeSession?.(account)
        if (disposal || !isCurrent()) return
        dependencies.remove(accountId)
        log.info('Saved account removed', { platform: account.platform })
        dependencies.changed(account.platform, false)
      })
    },
  }
}
export type AccountSessions = ReturnType<typeof createAccountSessions>
