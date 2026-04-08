import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppSettings } from '@twirchat/shared/types'
import { rpc } from '../main'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings | null>(null)
  const loading = ref(false)

  async function loadSettings(): Promise<void> {
    loading.value = true
    try {
      const result = await rpc.request.getSettings()
      if (result !== undefined) {
        settings.value = result
      }
    } finally {
      loading.value = false
    }
  }

  async function saveSettings(newSettings: AppSettings): Promise<void> {
    settings.value = newSettings
    await rpc.request.saveSettings(newSettings)
  }

  return { settings, loading, loadSettings, saveSettings }
})
