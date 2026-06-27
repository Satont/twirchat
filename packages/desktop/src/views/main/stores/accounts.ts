import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Account } from '@twirchat/shared/types'

export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<Account[]>([])
  const loading = ref(false)

  async function loadAccounts(): Promise<void> {
    loading.value = true
    try {
      const result = await bindings.getAccounts()
      if (result !== undefined) {
        accounts.value = result
      }
    } finally {
      loading.value = false
    }
  }

  function setAccounts(newAccounts: Account[]): void {
    accounts.value = newAccounts
  }

  return { accounts, loading, loadAccounts, setAccounts }
})
