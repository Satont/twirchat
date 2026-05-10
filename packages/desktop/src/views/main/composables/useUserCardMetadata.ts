import { computed, readonly, ref, watch, type Ref } from 'vue'

import type { UserCardMetadataResponse } from '@twirchat/shared/protocol'
import type { Platform } from '@twirchat/shared/types'
import { rpc } from '../main'

export function useUserCardMetadata(
  platform: Ref<Platform>,
  platformUserId: Ref<string>,
  username: Ref<string | undefined>,
  channelId: Ref<string | undefined>,
  channelSlug: Ref<string | undefined>,
  isActive: Ref<boolean>,
): {
  metadata: Readonly<Ref<UserCardMetadataResponse | null>>
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<string | null>>
  supportedByCard: Readonly<Ref<boolean>>
  reload: () => Promise<void>
} {
  const metadata = ref<UserCardMetadataResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const requestGeneration = ref(0)

  const supportedByCard = computed(() => platform.value === 'twitch' || platform.value === 'kick')

  async function reload(): Promise<void> {
    if (!supportedByCard.value || !isActive.value) {
      metadata.value = null
      error.value = null
      loading.value = false
      return
    }

    const generation = requestGeneration.value + 1
    requestGeneration.value = generation
    loading.value = true
    error.value = null

    try {
      const response = await rpc.request.getUserCardMetadata({
        platform: platform.value as 'twitch' | 'kick',
        platformUserId: platformUserId.value,
        username: username.value,
        channelId: channelId.value,
        channelSlug: channelSlug.value,
      })

      if (generation !== requestGeneration.value) return
      metadata.value = response
    } catch (loadError) {
      if (generation !== requestGeneration.value) return
      metadata.value = null
      error.value = loadError instanceof Error ? loadError.message : String(loadError)
    } finally {
      if (generation === requestGeneration.value) {
        loading.value = false
      }
    }
  }

  watch(
    [platform, platformUserId, username, channelId, channelSlug],
    () => {
      requestGeneration.value += 1
      metadata.value = null
      error.value = null
      loading.value = false

      if (isActive.value && supportedByCard.value) {
        void reload()
      }
    },
    { flush: 'sync' },
  )

  watch(
    isActive,
    (active) => {
      if (active && supportedByCard.value) {
        void reload()
      }
    },
    { immediate: true },
  )

  return {
    metadata: readonly(metadata),
    loading: readonly(loading),
    error: readonly(error),
    supportedByCard: readonly(supportedByCard),
    reload,
  }
}
