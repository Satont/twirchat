import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppSettings } from '@twirchat/shared/types'
import { invoke } from '@tauri-apps/api/core'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings | null>(null)
  const loading = ref(false)

  async function loadSettings(): Promise<void> {
    loading.value = true
    try {
      const result = await invoke<AppSettings>('get_settings')
      if (result !== undefined) {
        settings.value = result
      }
    } finally {
      loading.value = false
    }
  }

  async function saveSettings(newSettings: AppSettings): Promise<void> {
    settings.value = newSettings
    await invoke('save_settings', { settings: newSettings })
  }

  return { settings, loading, loadSettings, saveSettings }
})
