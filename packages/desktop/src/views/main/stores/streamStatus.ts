import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Account, WatchedChannel } from '@twirchat/shared/types'
import type { ChannelStatus, ChannelStatusRequest } from '@twirchat/shared/protocol'
import { rpc } from '../main'

export const useStreamStatusStore = defineStore('streamStatus', () => {
  const statusMap = ref<Map<string, ChannelStatus>>(new Map())

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let isPollRunning = false

  const getStatus = computed(
    () =>
      (platform: 'twitch' | 'kick', channelLogin: string): ChannelStatus | undefined =>
        statusMap.value.get(`${platform}:${channelLogin.toLowerCase()}`),
  )

  function setStatuses(statuses: ChannelStatus[]): void {
    const next = new Map(statusMap.value)
    for (const s of statuses) {
      next.set(`${s.platform}:${s.channelLogin.toLowerCase()}`, s)
    }
    statusMap.value = next
  }

  function removeChannel(platform: 'twitch' | 'kick', channelLogin: string): void {
    const next = new Map(statusMap.value)
    next.delete(`${platform}:${channelLogin.toLowerCase()}`)
    statusMap.value = next
  }

  async function refresh(accounts: Account[], watchedChannels: WatchedChannel[]): Promise<void> {
    const requests: ChannelStatusRequest[] = []

    for (const acc of accounts) {
      if (acc.platform === 'twitch' || acc.platform === 'kick') {
        requests.push({
          channelId: acc.platformUserId,
          channelLogin: acc.username,
          platform: acc.platform,
        })
      }
    }

    for (const ch of watchedChannels) {
      if (ch.platform === 'youtube') continue
      const platform = ch.platform as 'twitch' | 'kick'
      const key = `${platform}:${ch.channelSlug.toLowerCase()}`
      if (requests.some((r) => `${r.platform}:${r.channelLogin.toLowerCase()}` === key)) continue
      requests.push({ channelLogin: ch.channelSlug, platform })
    }

    if (requests.length === 0) return

    try {
      const res = await rpc.request.getChannelsStatus({ channels: requests })
      if (res?.channels) {
        setStatuses(res.channels)
      }
    } catch {
      // intentionally empty — stale status is acceptable
    }
  }

  function startPolling(
    getAccounts: () => Account[],
    getWatchedChannels: () => WatchedChannel[],
    intervalMs = 30_000,
  ): void {
    if (pollTimer !== null) return

    const tick = async () => {
      if (isPollRunning) return
      isPollRunning = true
      try {
        await refresh(getAccounts(), getWatchedChannels())
      } finally {
        isPollRunning = false
      }
    }

    void tick()
    pollTimer = setInterval(() => void tick(), intervalMs)
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    isPollRunning = false
  }

  return { statusMap, getStatus, setStatuses, removeChannel, refresh, startPolling, stopPolling }
})
