import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Platform } from '@twirchat/shared/types'
import type { UserAlias } from '../../shared/rpc'
import { rpc } from '../main'

export const useAliasStore = defineStore('aliases', () => {
  const aliases = ref<UserAlias[]>([])

  // Nested map: platform → platformUserId → alias string
  // O(1) lookup per message render
  const aliasMap = computed(() => {
    const map = new Map<Platform, Map<string, string>>()
    for (const a of aliases.value) {
      if (!map.has(a.platform)) map.set(a.platform, new Map())
      map.get(a.platform)!.set(a.platformUserId, a.alias)
    }
    return map
  })

  function getAlias(platform: Platform, platformUserId: string): string | undefined {
    return aliasMap.value.get(platform)?.get(platformUserId)
  }

  async function loadAliases(): Promise<void> {
    const result = await rpc.request.getUserAliases()
    if (result !== undefined) aliases.value = result
  }

  async function setAlias(
    platform: Platform,
    platformUserId: string,
    alias: string,
  ): Promise<void> {
    await rpc.request.setUserAlias({ platform, platformUserId, alias })
    if (!alias) {
      aliases.value = aliases.value.filter(
        (a) => !(a.platform === platform && a.platformUserId === platformUserId),
      )
    } else {
      const idx = aliases.value.findIndex(
        (a) => a.platform === platform && a.platformUserId === platformUserId,
      )
      if (idx >= 0) {
        aliases.value[idx] = { ...aliases.value[idx], alias }
      } else {
        aliases.value.push({
          platform,
          platformUserId,
          alias,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
      }
    }
  }

  async function removeAlias(platform: Platform, platformUserId: string): Promise<void> {
    await rpc.request.removeUserAlias({ platform, platformUserId })
    aliases.value = aliases.value.filter(
      (a) => !(a.platform === platform && a.platformUserId === platformUserId),
    )
  }

  return { aliases, aliasMap, getAlias, loadAliases, setAlias, removeAlias }
})
