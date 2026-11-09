import type { Account, Platform } from '@twirchat/shared/types'

import { t } from '../gpuix/i18n'
import { runInBackground } from './background-task'

export interface AccountSessionDependencies {
  find(id: string): Account | null
  active(platform: Platform): Account | null
  select(platform: Platform, accountId: string | null): Account | null
  remove(id: string): void
  removeSession?(account: Account): Promise<void>
  disconnect(platform: Platform): Promise<void>
  refreshIdentity(platform: Platform): Promise<void> | void
  connectOwn(platform: Platform, account: Account | null): Promise<void>
  reconnectWatched(platform: Platform): Promise<void>
  changed(platform: Platform, identityChanged: boolean): void
}

/** One identity transition at a time per platform, without changing watched records or layouts. */
export function createAccountSessions(dependencies: AccountSessionDependencies) {
  const queues = new Map<Platform, Promise<void>>()
  function enqueue(platform: Platform, operation: () => Promise<void>): Promise<void> {
    const pending = (queues.get(platform) ?? Promise.resolve()).catch(() => {}).then(operation)
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
  ): Promise<void> {
    resolve(platform, accountId)
    if (!force && (dependencies.active(platform)?.id ?? null) === accountId) return
    await dependencies.disconnect(platform)
    const account = dependencies.select(platform, accountId)
    const failures: string[] = []
    try {
      try {
        await dependencies.refreshIdentity(platform)
      } catch (error) {
        failures.push(String(error))
      }
      const connected = await Promise.allSettled([
        dependencies.connectOwn(platform, account),
        dependencies.reconnectWatched(platform),
      ])
      for (const result of connected)
        if (result.status === 'rejected') failures.push(String(result.reason))
    } finally {
      dependencies.changed(platform, true)
    }
    if (failures.length)
      throw new Error(t('notices.accounts.reconnectFailed', { failures: failures.join('; ') }))
  }
  return {
    select(platform: Platform, accountId: string | null, force = false): Promise<void> {
      try {
        resolve(platform, accountId)
      } catch (error) {
        return Promise.reject(error)
      }
      return enqueue(platform, () => transition(platform, accountId, force))
    },
    reconnectOwn(platform: Platform): Promise<void> {
      return enqueue(platform, async () => {
        await dependencies.disconnect(platform)
        await dependencies.refreshIdentity(platform)
        await dependencies.connectOwn(platform, dependencies.active(platform))
      })
    },
    forget(accountId: string, isCurrent = () => true): Promise<void> {
      const requested = dependencies.find(accountId)
      if (!requested) return Promise.reject(new Error(t('notices.accounts.missing')))
      return enqueue(requested.platform, async () => {
        const account = dependencies.find(accountId)
        if (!account || !isCurrent()) return
        if (dependencies.active(account.platform)?.id === accountId)
          await transition(account.platform, null, false)
        if (!isCurrent()) return
        await dependencies.removeSession?.(account)
        if (!isCurrent()) return
        dependencies.remove(accountId)
        dependencies.changed(account.platform, false)
      })
    },
  }
}
export type AccountSessions = ReturnType<typeof createAccountSessions>
