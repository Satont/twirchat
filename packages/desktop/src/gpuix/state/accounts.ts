import type { Account } from '@twirchat/shared/types'

import { createStore, type Store } from '../../state/create-store'
import { persistentResource } from '../../state/persistent-resources'

export const accountsStore = persistentResource('accounts', () => createStore<Account[]>([]))
/** Every saved identity, active or not; chats may sign in with any of them. */
export const savedAccountsStore = persistentResource('savedAccounts', () =>
  createStore<Account[]>([]),
)

declare module '../../state/persistent-resources' {
  interface PersistentResources {
    accounts: Store<Account[]>
    savedAccounts: Store<Account[]>
  }
}
