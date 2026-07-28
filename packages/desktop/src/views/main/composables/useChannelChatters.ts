import { computed, readonly, ref, watch, type Ref } from 'vue'

import { desktopApi, type ChattersResponse, type ChattersTarget } from '../services/desktop-api'
import { filterChatterGroups } from '../utils/chatters'

export type FetchChannelChatters = (targets: ChattersTarget[]) => Promise<ChattersResponse>

const defaultFetchChatters: FetchChannelChatters = (targets) =>
  desktopApi.request.getChatters({ targets })

function serializeTargets(targets: readonly ChattersTarget[]): string {
  return targets.map((target) => `${target.platform}:${target.channelSlug.toLowerCase()}`).join('|')
}

export function useChannelChatters(
  open: Ref<boolean>,
  targets: Ref<ChattersTarget[]>,
  fetchChatters: FetchChannelChatters = defaultFetchChatters,
) {
  const chatters = ref<ChattersResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const query = ref('')
  const requestGeneration = ref(0)
  const targetsKey = computed(() => serializeTargets(targets.value))

  async function reload(): Promise<void> {
    const currentTargets = targets.value
    if (!open.value || currentTargets.length === 0) return

    const generation = requestGeneration.value + 1
    requestGeneration.value = generation
    loading.value = true
    error.value = null

    try {
      const response = await fetchChatters(currentTargets)
      if (generation !== requestGeneration.value) return
      chatters.value = response
    } catch (loadError) {
      if (generation !== requestGeneration.value) return
      chatters.value = null
      error.value = loadError instanceof Error ? loadError.message : String(loadError)
    } finally {
      if (generation === requestGeneration.value) {
        loading.value = false
      }
    }
  }

  watch(
    [open, targetsKey],
    ([isOpen, key]) => {
      requestGeneration.value += 1
      chatters.value = null
      error.value = null
      loading.value = false
      query.value = ''

      if (isOpen && key.length > 0) {
        void reload()
      }
    },
    { flush: 'sync' },
  )

  const visibleResults = computed(() =>
    (chatters.value?.results ?? []).map((channel) => ({
      ...channel,
      groups: filterChatterGroups(channel.groups, query.value),
    })),
  )

  return {
    chatters: readonly(chatters),
    loading: readonly(loading),
    error: readonly(error),
    query,
    visibleResults,
    reload,
  }
}
