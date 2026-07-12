import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PlatformStatusInfo } from '@twirchat/shared/types'

export const useChannelStatusStore = defineStore('channelStatus', () => {
  const statuses = ref<Map<string, PlatformStatusInfo>>(new Map())

  function setStatus(platform: string, info: PlatformStatusInfo): void {
    const map = new Map(statuses.value)
    map.set(platform, info)
    statuses.value = map
  }

  function setStatuses(list: PlatformStatusInfo[]): void {
    const map = new Map<string, PlatformStatusInfo>()
    for (const s of list) {
      map.set(s.platform, s)
    }
    statuses.value = map
  }

  return { statuses, setStatus, setStatuses }
})
