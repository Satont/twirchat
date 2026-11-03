import type {
  NormalizedChatMessage,
  Platform,
  WatchedChannel,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'

import type { DesktopApi } from '../backend/api'
import { chatMessageKey, compileChatSearch, type SearchDetails } from '../chat-tools'
import { compileMessageRules } from '../message-rules'
import {
  accountsStore,
  activeTabStore,
  activeWatchedTabStore,
  aliasesStore,
  channelStatusStore,
  homeMessagesStore,
  moderationOutcomeFor,
  showNotice,
  tabChannelIdsStore,
  watchedChannelsStore,
  watchedMessagesStore,
} from './app'
import { chatRulesStore } from './chat-rules'
import { chatWindowsStore, isMainChatWindowOpen, activateChatSearchWindow } from './chat-windows'
import type { Store } from './create-store'
import { createStore } from './create-store'
import { allPanels, layoutStore } from './layout'
import { getMessageSimilarity } from './message-similarity'
import { persistentResource } from './persistent-resources'

export interface ChatSearchLocation {
  tabId: string
  windowId?: string
  paneId?: string
  watchedChannelId: string | null
}
export interface ChatSearchResult {
  key: string
  message: NormalizedChatMessage
  details: SearchDetails
  locations: ChatSearchLocation[]
}
export interface ChatSearchSnapshot {
  capturedAt: number
  results: ChatSearchResult[]
  sourceCount: number
  unavailableTabs: string[]
}
export interface ChatSearchInput {
  includeHome?: boolean
  windowIds?: ReadonlyMap<string, string>
  tabIds: readonly string[]
  layouts: ReadonlyMap<string, WatchedChannelsLayout | null>
  channels: readonly WatchedChannel[]
  homeMessages: readonly NormalizedChatMessage[]
  watchedMessages: ReadonlyMap<string, NormalizedChatMessage[]>
  detailsFor?: (message: NormalizedChatMessage, channel?: WatchedChannel) => SearchDetails
}

/** The home tab is always open; saved channels outside open layouts are excluded. */
export function openChatSearchLocations(input: ChatSearchInput): ChatSearchLocation[] {
  const locations: ChatSearchLocation[] = []
  if (input.includeHome !== false && !input.layouts.get('home'))
    locations.push({ tabId: 'home', watchedChannelId: null })
  const knownChannels = new Set(input.channels.map((channel) => channel.id))
  for (const tabId of new Set([
    ...(input.includeHome === false ? [] : ['home']),
    ...input.tabIds,
  ])) {
    for (const panel of allPanels(input.layouts.get(tabId) ?? null)) {
      if (panel.content.type === 'empty') continue
      const id = panel.content.type === 'watched' ? panel.content.channelId : null
      if (id !== null && !knownChannels.has(id)) continue
      locations.push({
        tabId,
        paneId: `${tabId}:${panel.id}`,
        watchedChannelId: id,
        ...(input.windowIds?.has(tabId) ? { windowId: input.windowIds.get(tabId) } : {}),
      })
    }
  }
  return locations
}

export function buildChatSearchSnapshot(
  input: ChatSearchInput,
  capturedAt = Date.now(),
): ChatSearchSnapshot {
  const entries = new Map<string, ChatSearchResult>()
  const locations = openChatSearchLocations(input)
  for (const location of locations) {
    const channel = input.channels.find((item) => item.id === location.watchedChannelId)
    const messages =
      location.watchedChannelId === null
        ? input.homeMessages
        : (input.watchedMessages.get(location.watchedChannelId) ?? [])
    for (const message of messages) {
      const key = chatMessageKey(message)
      const previous = entries.get(key)
      if (previous) {
        previous.locations.push({ ...location })
        continue
      }
      entries.set(key, {
        key,
        message: structuredClone(message),
        details: { channelName: channel?.channelSlug, ...input.detailsFor?.(message, channel) },
        locations: [{ ...location }],
      })
    }
  }
  return {
    capturedAt,
    results: [...entries.values()].sort(
      (a, b) => new Date(b.message.timestamp).getTime() - new Date(a.message.timestamp).getTime(),
    ),
    sourceCount: new Set(locations.map((location) => location.watchedChannelId ?? 'home')).size,
    unavailableTabs: input.tabIds.filter((id) => !input.layouts.get(id)),
  }
}

function currentInput(): ChatSearchInput {
  const mainOpen = isMainChatWindowOpen()
  const windows = [...chatWindowsStore.get()].flatMap(([scope, entry]) =>
    entry.tabId ? [[entry.tabId, scope] satisfies [string, string]] : [],
  )
  return {
    includeHome: mainOpen,
    windowIds: new Map(windows),
    tabIds: [...(mainOpen ? tabChannelIdsStore.get() : []), ...windows.map(([tabId]) => tabId)],
    layouts: new Map(
      [...layoutStore.get()].map(([id, state]) => [id, state.error ? null : state.layout]),
    ),
    channels: watchedChannelsStore.get(),
    homeMessages: homeMessagesStore.get(),
    watchedMessages: watchedMessagesStore.get(),
  }
}

const captureRequests = new Map<string, object>()

export async function captureOpenChatSnapshot(
  api: Pick<DesktopApi, 'getWatchedChannelsLayout'>,
  signal?: AbortSignal,
): Promise<ChatSearchSnapshot> {
  signal?.throwIfAborted()
  const ids = [...currentInput().tabIds]
  const missing = ids.filter((id) => {
    const state = layoutStore.get().get(id)
    return !state?.layout || !!state.error
  })
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(4, missing.length) }, async () => {
      while (next < missing.length) {
        signal?.throwIfAborted()
        const id = missing[next++]
        if (!id) return
        const request = {}
        captureRequests.set(id, request)
        try {
          // Each worker fetches one layout at a time to bound backend work.
          // eslint-disable-next-line no-await-in-loop
          const layout = await api.getWatchedChannelsLayout({ tabId: id })
          signal?.throwIfAborted()
          if (captureRequests.get(id) !== request) continue
          if (!currentInput().tabIds.includes(id)) continue
          layoutStore.modify((states) => {
            if (states.get(id)?.layout && !states.get(id)?.error) return states
            return new Map(states).set(id, { layout, isLoading: false, error: null })
          })
        } catch {
          signal?.throwIfAborted()
          // Unavailable layouts are surfaced in the snapshot instead of searching closed buffers.
        } finally {
          if (captureRequests.get(id) === request) captureRequests.delete(id)
        }
      }
    }),
  )
  signal?.throwIfAborted()
  const engine = compileMessageRules(
    chatRulesStore.get().value,
    accountsStore.get(),
    (message) => ({ similar: getMessageSimilarity(message)?.similar }),
  )
  const aliases = new Map(
    aliasesStore.get().map((alias) => [`${alias.platform}:${alias.platformUserId}`, alias.alias]),
  )
  const statuses = channelStatusStore.get()
  return buildChatSearchSnapshot({
    ...currentInput(),
    detailsFor: (message, channel) => ({
      alias: aliases.get(`${message.platform}:${message.author.id}`),
      channelName: channel?.channelSlug ?? statuses[message.platform]?.channelLogin,
      highlighted: engine.classify(message).highlighted,
      similar: getMessageSimilarity(message)?.similar,
      deleted: moderationOutcomeFor(message)?.isTombstone === true,
    }),
  })
}

export function searchChatSnapshot(
  snapshot: ChatSearchSnapshot,
  query: string,
): { results: ChatSearchResult[]; error?: string } {
  const search = compileChatSearch(query)
  return {
    results: snapshot.results.filter((result) => search.matches(result.message, result.details)),
    error: search.error,
  }
}

export interface ChatSearchJump {
  requestId: string
  messageKey: string
  messageId: string
  platform: Platform
  channelId: string
  target: ChatSearchLocation
}
export const chatSearchJumpStore = persistentResource('chatSearchJump', () =>
  createStore<ChatSearchJump | null>(null),
)
let jumpTimeout: ReturnType<typeof setTimeout> | undefined

export function resolveChatSearchJump(
  result: ChatSearchResult,
  input: ChatSearchInput,
  preferredWindowId = 'main',
): ChatSearchLocation | null {
  const available = openChatSearchLocations(input)
  const targets = result.locations.toSorted(
    (a, b) =>
      Number((b.windowId ?? 'main') === preferredWindowId) -
      Number((a.windowId ?? 'main') === preferredWindowId),
  )
  for (const target of targets) {
    if (
      !available.some(
        (location) =>
          location.tabId === target.tabId &&
          location.paneId === target.paneId &&
          location.watchedChannelId === target.watchedChannelId,
      )
    )
      continue
    const messages =
      target.watchedChannelId === null
        ? input.homeMessages
        : (input.watchedMessages.get(target.watchedChannelId) ?? [])
    if (messages.some((message) => chatMessageKey(message) === result.key)) return { ...target }
  }
  return null
}

export function requestChatSearchJump(
  result: ChatSearchResult,
  preferredWindowId = 'main',
): boolean {
  const target = resolveChatSearchJump(result, currentInput(), preferredWindowId)
  if (!target) {
    showNotice(
      'info',
      'This message is no longer in an open chat buffer. Refresh search to update the snapshot.',
    )
    return false
  }
  if (jumpTimeout) clearTimeout(jumpTimeout)
  const requestId = crypto.randomUUID()
  if (target.windowId && target.windowId !== 'main') activateChatSearchWindow(target.windowId)
  else {
    activeTabStore.set('chat')
    activeWatchedTabStore.set(target.tabId)
    activateChatSearchWindow('main')
  }
  chatSearchJumpStore.set({
    requestId,
    messageKey: result.key,
    messageId: result.message.id,
    platform: result.message.platform,
    channelId: result.message.channelId,
    target,
  })
  jumpTimeout = setTimeout(() => {
    if (chatSearchJumpStore.get()?.requestId === requestId) finishChatSearchJump(requestId, false)
  }, 5000)
  jumpTimeout.unref?.()
  return true
}

export function finishChatSearchJump(requestId: string, found: boolean): void {
  if (chatSearchJumpStore.get()?.requestId !== requestId) return
  if (jumpTimeout) clearTimeout(jumpTimeout)
  jumpTimeout = undefined
  chatSearchJumpStore.set(null)
  if (!found)
    showNotice(
      'info',
      'The message could not be revealed in this pane. It may have left the buffer; refresh search to update the snapshot.',
    )
}

declare module './persistent-resources' {
  interface PersistentResources {
    chatSearchJump: Store<ChatSearchJump | null>
  }
}
