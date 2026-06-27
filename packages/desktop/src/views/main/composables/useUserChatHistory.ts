import { readonly, ref, watch, type Ref } from 'vue'

import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'
import type { UserChatHistoryCursor } from '../../../bindings'
import { useRpcListener } from './useRpcListener'

const PAGE_SIZE = 50

function compareMessages(a: NormalizedChatMessage, b: NormalizedChatMessage): number {
  const timestampDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  if (timestampDiff !== 0) return timestampDiff
  return a.id.localeCompare(b.id)
}

function mergeUniqueMessages(
  olderMessages: NormalizedChatMessage[],
  existingMessages: NormalizedChatMessage[],
): NormalizedChatMessage[] {
  const existingIds = new Set(existingMessages.map((message) => message.id))
  const uniqueOlderMessages = olderMessages.filter((message) => !existingIds.has(message.id))
  return [...uniqueOlderMessages, ...existingMessages]
}

function insertMessageInOrder(
  existingMessages: NormalizedChatMessage[],
  incomingMessage: NormalizedChatMessage,
): NormalizedChatMessage[] {
  if (existingMessages.some((entry) => entry.id === incomingMessage.id)) {
    return existingMessages
  }

  const nextMessages = [...existingMessages]
  const insertIndex = nextMessages.findIndex((entry) => compareMessages(incomingMessage, entry) < 0)

  if (insertIndex === -1) {
    nextMessages.push(incomingMessage)
  } else {
    nextMessages.splice(insertIndex, 0, incomingMessage)
  }

  return nextMessages
}

export function useUserChatHistory(
  platform: Ref<Platform>,
  platformUserId: Ref<string>,
  isActive: Ref<boolean>,
): {
  messages: Ref<NormalizedChatMessage[]>
  loadingInitial: Readonly<Ref<boolean>>
  loadingOlder: Readonly<Ref<boolean>>
  error: Readonly<Ref<string | null>>
  hasMore: Readonly<Ref<boolean>>
  loadInitial: () => Promise<void>
  loadOlder: () => Promise<void>
  reset: () => void
} {
  const messages = ref<NormalizedChatMessage[]>([])
  const loadingInitial = ref(false)
  const loadingOlder = ref(false)
  const error = ref<string | null>(null)
  const hasMore = ref(false)
  const nextCursor = ref<UserChatHistoryCursor | null>(null)
  const requestGeneration = ref(0)

  function reset(): void {
    requestGeneration.value += 1
    messages.value = []
    loadingInitial.value = false
    loadingOlder.value = false
    error.value = null
    hasMore.value = false
    nextCursor.value = null
  }

  async function loadInitial(): Promise<void> {
    const generation = requestGeneration.value + 1
    requestGeneration.value = generation
    loadingInitial.value = true
    error.value = null

    try {
      const page = await bindings.getUserChatHistory({
        platform: platform.value,
        platformUserId: platformUserId.value,
        limit: PAGE_SIZE,
      })

      if (generation !== requestGeneration.value) return

      messages.value = page.messages
      hasMore.value = page.hasMore
      nextCursor.value = page.nextCursor
    } catch (loadError) {
      if (generation !== requestGeneration.value) return
      error.value = loadError instanceof Error ? loadError.message : String(loadError)
    } finally {
      if (generation === requestGeneration.value) {
        loadingInitial.value = false
      }
    }
  }

  async function loadOlder(): Promise<void> {
    if (
      !isActive.value ||
      loadingInitial.value ||
      loadingOlder.value ||
      !hasMore.value ||
      !nextCursor.value
    ) {
      return
    }

    loadingOlder.value = true
    error.value = null
    const generation = requestGeneration.value

    try {
      const page = await bindings.getUserChatHistory({
        platform: platform.value,
        platformUserId: platformUserId.value,
        limit: PAGE_SIZE,
        cursor: nextCursor.value,
      })

      if (generation !== requestGeneration.value) return

      messages.value = mergeUniqueMessages(page.messages, messages.value)
      hasMore.value = page.hasMore
      nextCursor.value = page.nextCursor
    } catch (loadError) {
      if (generation !== requestGeneration.value) return
      error.value = loadError instanceof Error ? loadError.message : String(loadError)
    } finally {
      if (generation === requestGeneration.value) {
        loadingOlder.value = false
      }
    }
  }

  watch(
    [platform, platformUserId],
    () => {
      reset()
      if (isActive.value) {
        void loadInitial()
      }
    },
    { flush: 'sync' },
  )

  watch(
    isActive,
    (active) => {
      if (active) {
        void loadInitial()
      }
    },
    { immediate: true },
  )

  useRpcListener('chat_message', (message) => {
    if (!isActive.value) return
    if (message.platform !== platform.value || message.author.id !== platformUserId.value) return

    messages.value = insertMessageInOrder(messages.value, message)
  })

  return {
    messages,
    loadingInitial: readonly(loadingInitial),
    loadingOlder: readonly(loadingOlder),
    error: readonly(error),
    hasMore: readonly(hasMore),
    loadInitial,
    loadOlder,
    reset,
  }
}
