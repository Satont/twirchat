import type { Account } from '@twirchat/shared/types'

import { createStore, type Store } from './create-store'
import { persistentResource } from './persistent-resources'

export const accountsStore = persistentResource('accounts', () => createStore<Account[]>([]))
/** Every saved identity, active or not; chats may sign in with any of them. */
export const savedAccountsStore = persistentResource('savedAccounts', () =>
  createStore<Account[]>([]),
)

declare module './persistent-resources' {
  interface PersistentResources {
    accounts: Store<Account[]>
    savedAccounts: Store<Account[]>
  }
}
