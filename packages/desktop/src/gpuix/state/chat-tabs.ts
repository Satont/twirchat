import type { LayoutNode, WatchedChannel, WatchedChannelsLayout } from '@twirchat/shared/types'
import type { PanelNode, SplitDirection } from '@twirchat/shared/types'
import { z } from 'zod'

import { panelNodeSchema, watchedChannelsLayoutSchema } from '../../services/persisted-schemas'
import { getAllPanels } from '../../views/main/utils/layout-tree'
import { sanitizeDisplayText, truncateGraphemes } from '../../views/shared/utils/display-text'
import type {
  DesktopWatchedChannel,
  WatchedPlatform,
} from '../../watched-channels/plugin-channel-types'
import type { DesktopApi } from '../backend/api'
import { t } from '../i18n'
import {
  activeWatchedTabStore,
  tabChannelIdsStore,
  tabChannelNamesStore,
  watchedChannelsStore,
} from './app'
import { chatRulesPreferences, chatRulesStore } from './chat-rules'
import { createStore, type Store } from './create-store'
import { layoutStore, saveLayoutNow } from './layout'
import { persistentResource } from './persistent-resources'
import { setMainTab } from './settings-session'
import { clearTabUnread } from './tab-unread'

const KEY = 'chat_tabs_v1'
const MAX_CLOSED = 20
export interface ChatTabMetadata {
  channelId?: string
  title?: string
  color?: string
  locked: boolean
}
export interface ClosedChatTab {
  id: string
  index: number
  metadata: ChatTabMetadata
  layout: WatchedChannelsLayout
}
export interface ClosedSplit {
  id: string
  tabId: string
  panel: PanelNode
  restorePanelId: string
  parent?: {
    id: string
    direction: SplitDirection
    index: number
    flex: number
    siblingIds: string[]
  }
  filters: Record<string, string[]>
}
const closedSplitSchema = z.toZod<ClosedSplit>()(
  z.object({
    id: z.string(),
    tabId: z.string(),
    panel: panelNodeSchema,
    restorePanelId: z.string(),
    parent: z
      .object({
        id: z.string(),
        direction: z.enum(['horizontal', 'vertical']),
        index: z.number().int().min(0),
        flex: z.number().positive().max(100),
        siblingIds: z.array(z.string()),
      })
      .optional(),
    filters: z.record(z.string(), z.array(z.string())),
  }),
)
export interface ChatTabConfiguration {
  version: 1
  openIds: string[]
  metadata: Record<string, ChatTabMetadata>
  closed: ClosedChatTab[]
  closedSplits?: ClosedSplit[]
}
export interface ChatTabsState {
  value: ChatTabConfiguration
  loaded: boolean
  saving: boolean
  error: string | null
}
const emptyConfiguration = (): ChatTabConfiguration => ({
  version: 1,
  openIds: [],
  metadata: {},
  closed: [],
})
export const chatTabsStore = persistentResource('chatTabs', () =>
  createStore<ChatTabsState>({
    value: emptyConfiguration(),
    loaded: false,
    saving: false,
    error: null,
  }),
)
export type ChatTabApi = Pick<
  DesktopApi,
  | 'getUiState'
  | 'setUiState'
  | 'getTabChannelIds'
  | 'setTabChannelIds'
  | 'getWatchedChannelsLayout'
  | 'setWatchedChannelsLayout'
>
interface TabEnvironment {
  channels(): DesktopWatchedChannel[]
  activeId(): string
  activate(id: string): void
  publishIds(ids: string[]): void
  layout(id: string): WatchedChannelsLayout | null
  publishLayout(id: string, layout: WatchedChannelsLayout): void
}
function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    value !== 'home' &&
    !['__proto__', 'constructor', 'prototype'].includes(value)
  )
}
function metadata(value: unknown): ChatTabMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { locked: false }
  const input = z.record(z.string(), z.unknown()).parse(value)
  return {
    locked: input.locked === true,
    ...(validId(input.channelId) ? { channelId: input.channelId } : {}),
    ...(typeof input.title === 'string' && input.title.trim()
      ? { title: truncateGraphemes(sanitizeDisplayText(input.title).trim(), 80) }
      : {}),
    ...(typeof input.color === 'string' && /^#[a-f0-9]{6}$/iu.test(input.color)
      ? { color: input.color }
      : {}),
  }
}
function validLayout(value: unknown): value is WatchedChannelsLayout {
  try {
    const parsed = watchedChannelsLayoutSchema.safeParse(value)
    if (!parsed.success) return false
    const layout = parsed.data
    const ids = new Set<string>()
    let panels = 0
    const visit = (node: LayoutNode, depth: number): boolean => {
      if (
        !node ||
        typeof node !== 'object' ||
        depth > 64 ||
        ids.size > 256 ||
        typeof node.id !== 'string' ||
        !node.id ||
        ids.has(node.id) ||
        !Number.isFinite(node.flex) ||
        node.flex <= 0 ||
        node.flex > 100
      )
        return false
      ids.add(node.id)
      if (node.type === 'panel') {
        panels++
        if (panels > 64 || !node.content || typeof node.content !== 'object') return false
        return (
          node.content.type === 'main' ||
          node.content.type === 'empty' ||
          (node.content.type === 'watched' &&
            typeof node.content.channelId === 'string' &&
            node.content.channelId.length > 0)
        )
      }
      return (
        node.type === 'split' &&
        ['horizontal', 'vertical'].includes(node.direction) &&
        Array.isArray(node.children) &&
        node.children.length >= 2 &&
        node.children.length <= 64 &&
        node.children.every((child) => visit(child, depth + 1))
      )
    }
    return visit(layout.root, 0) && panels > 0
  } catch {
    return false
  }
}
export function validateChatTabs(value: unknown): ChatTabConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid saved tabs.')
  const input = z.record(z.string(), z.unknown()).parse(value)
  if (
    input.version !== 1 ||
    !Array.isArray(input.openIds) ||
    input.openIds.length > 256 ||
    !input.openIds.every(validId)
  )
    throw new Error('Invalid saved tab order.')
  const entries =
    input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? z.record(z.string(), z.unknown()).parse(input.metadata)
      : {}
  const openIds = [...new Set(input.openIds)]
  const config: ChatTabConfiguration = { version: 1, openIds, metadata: {}, closed: [] }
  for (const id of openIds) config.metadata[id] = metadata(entries[id])
  if (Array.isArray(input.closed))
    for (const raw of input.closed.slice(0, MAX_CLOSED)) {
      if (!raw || typeof raw !== 'object') continue
      const item = z.record(z.string(), z.unknown()).parse(raw)
      if (!validId(item.id) || openIds.includes(item.id) || !validLayout(item.layout)) continue
      if (config.closed.some((closed) => closed.id === item.id)) continue
      config.closed.push({
        id: item.id,
        index:
          typeof item.index === 'number' && Number.isSafeInteger(item.index)
            ? Math.max(0, item.index)
            : openIds.length,
        metadata: metadata(item.metadata),
        layout: structuredClone(item.layout),
      })
    }
  if (Array.isArray(input.closedSplits))
    config.closedSplits = input.closedSplits.slice(0, MAX_CLOSED).flatMap((raw) => {
      const parsed = closedSplitSchema.safeParse(raw)
      if (!parsed.success || !validLayout({ version: 2, root: parsed.data.panel })) return []
      return [parsed.data]
    })
  return config
}
export function cloneChatTabLayout(layout: WatchedChannelsLayout): WatchedChannelsLayout {
  const copy = structuredClone(layout)
  const visit = (node: LayoutNode) => {
    node.id = crypto.randomUUID()
    if (node.type === 'split') node.children.forEach(visit)
  }
  visit(copy.root)
  copy.meta = { createdAt: Date.now(), updatedAt: Date.now() }
  return copy
}

/** Canonical tab metadata/order are one durable write; legacy IDs remain a compatibility mirror. */
export function createChatTabController(
  api: ChatTabApi,
  environment: TabEnvironment,
  store: Store<ChatTabsState> = createStore<ChatTabsState>({
    value: emptyConfiguration(),
    loaded: false,
    saving: false,
    error: null,
  }),
) {
  let writes: Promise<unknown> = Promise.resolve()
  let loading: Promise<void> | null = null
  async function initialize() {
    if (store.get().loaded) return
    if (loading) return loading
    loading = (async () => {
      const raw = await api.getUiState({ key: KEY })
      let value: ChatTabConfiguration | undefined
      let recoveryError: string | null = null
      if (raw !== null) {
        try {
          if (raw.length > 1_000_000) throw new Error('Saved tab configuration is too large.')
          value = validateChatTabs(JSON.parse(raw))
        } catch {
          recoveryError = t('notices.chatTabs.recovered')
        }
      }
      if (!value) {
        const legacy = await api.getTabChannelIds()
        const channels = environment.channels()
        const ids =
          legacy === null
            ? channels.map((channel) => channel.id)
            : legacy.filter((id) => channels.some((channel) => channel.id === id))
        value = {
          version: 1,
          openIds: [...new Set(ids)],
          metadata: Object.fromEntries(ids.map((id) => [id, { channelId: id, locked: false }])),
          closed: [],
        }
        if (raw === null) await api.setUiState({ key: KEY, value: JSON.stringify(value) })
      }
      const loaded = value
      let index = 0
      const labels = new Map<string, string[]>()
      await Promise.all(
        Array.from({ length: Math.min(4, loaded.openIds.length) }, async () => {
          while (index < loaded.openIds.length) {
            const id = loaded.openIds[index++]
            if (!id) return
            try {
              // eslint-disable-next-line no-await-in-loop
              const layout = await api.getWatchedChannelsLayout({ tabId: id })
              if (!layout || !validLayout(layout)) continue
              environment.publishLayout(id, layout)
              const names = getAllPanels(layout.root).flatMap((panel) => {
                const content = panel.content
                return content.type === 'watched'
                  ? environment
                      .channels()
                      .filter((channel) => channel.id === content.channelId)
                      .map((channel) => channel.displayName)
                  : []
              })
              if (names.length) labels.set(id, names)
            } catch {
              /* The pane loader exposes its own retry/error when this tab is opened. */
            }
          }
        }),
      )
      store.set({ value, loaded: true, saving: false, error: recoveryError })
      environment.publishIds(value.openIds)
      tabChannelNamesStore.set(labels)
      if (environment.activeId() !== 'home' && !value.openIds.includes(environment.activeId()))
        environment.activate('home')
    })()
      .catch((error: unknown) => {
        store.update({ error: error instanceof Error ? error.message : String(error) })
        throw error
      })
      .finally(() => {
        loading = null
      })
    return loading
  }
  async function persist(value: ChatTabConfiguration) {
    await api.setUiState({ key: KEY, value: JSON.stringify(value) })
    store.update({ value, loaded: true, error: null })
    environment.publishIds(value.openIds)
    try {
      await api.setTabChannelIds({ ids: value.openIds })
    } catch (error) {
      store.update({
        error: t('notices.chatTabs.compatibilitySaveFailed', { error: String(error) }),
      })
    }
  }
  function change<T>(operation: (value: ChatTabConfiguration) => Promise<T>): Promise<T> {
    const next = writes
      .catch(() => {})
      .then(async () => {
        await initialize()
        store.update({ saving: true, error: null })
        try {
          return await operation(structuredClone(store.get().value))
        } catch (error) {
          store.update({ error: error instanceof Error ? error.message : String(error) })
          throw error
        } finally {
          store.update({ saving: false })
        }
      })
    writes = next
    return next
  }
  const requireOpen = (value: ChatTabConfiguration, id: string) => {
    if (!value.openIds.includes(id)) throw new Error(t('notices.chatTabs.tabClosed'))
  }
  async function readLayout(id: string) {
    const layout = environment.layout(id) ?? (await api.getWatchedChannelsLayout({ tabId: id }))
    if (!layout || !validLayout(layout)) throw new Error(t('notices.chatTabs.layoutUnavailable'))
    return structuredClone(layout)
  }
  return {
    store,
    initialize,
    close: (id: string) =>
      change(async (value) => {
        requireOpen(value, id)
        if (value.metadata[id]?.locked) throw new Error(t('notices.chatTabs.unlockBeforeClose'))
        const index = value.openIds.indexOf(id)
        const layout = await readLayout(id)
        value.closed = [
          { id, index, metadata: value.metadata[id] ?? { channelId: id, locked: false }, layout },
          ...value.closed.filter((closed) => closed.id !== id),
        ].slice(0, MAX_CLOSED)
        value.openIds.splice(index, 1)
        delete value.metadata[id]
        await persist(value)
        if (environment.activeId() === id)
          environment.activate(value.openIds[Math.min(index, value.openIds.length - 1)] ?? 'home')
        clearTabUnread(id)
      }),
    restore: (id?: string) =>
      change(async (value) => {
        const index = id ? value.closed.findIndex((entry) => entry.id === id) : 0
        const closed = index < 0 ? undefined : value.closed.splice(index, 1)[0]
        if (!closed) return null
        if (value.openIds.length >= 256) throw new Error(t('notices.chatTabs.closeBeforeRestore'))
        await api.setWatchedChannelsLayout({ tabId: closed.id, layout: closed.layout })
        value.openIds.splice(Math.min(closed.index, value.openIds.length), 0, closed.id)
        value.metadata[closed.id] = closed.metadata
        await persist(value)
        environment.publishLayout(closed.id, closed.layout)
        environment.activate(closed.id)
        return closed.id
      }),
    createEmpty: () =>
      change(async (value) => {
        if (value.openIds.length >= 256) throw new Error(t('notices.chatTabs.closeBeforeOpen'))
        const id = `tab:${crypto.randomUUID()}`
        const layout: WatchedChannelsLayout = {
          version: 2,
          root: { type: 'panel', id: crypto.randomUUID(), flex: 100, content: { type: 'empty' } },
        }
        await api.setWatchedChannelsLayout({ tabId: id, layout })
        value.openIds.push(id)
        value.metadata[id] = { locked: false }
        await persist(value)
        environment.publishLayout(id, layout)
        environment.activate(id)
        return id
      }),
    rememberSplit: (entry: ClosedSplit) =>
      change(async (value) => {
        value.closedSplits = [
          structuredClone(entry),
          ...(value.closedSplits ?? []).filter((item) => item.id !== entry.id),
        ].slice(0, MAX_CLOSED)
        await persist(value)
      }),
    consumeSplit: (id: string) =>
      change(async (value) => {
        value.closedSplits = (value.closedSplits ?? []).filter((item) => item.id !== id)
        await persist(value)
      }),
    duplicate: (id: string) =>
      change(async (value) => {
        requireOpen(value, id)
        if (value.openIds.length >= 256) throw new Error(t('notices.chatTabs.closeBeforeDuplicate'))
        const original = await readLayout(id)
        const layout = cloneChatTabLayout(original)
        const copyId = `tab:${crypto.randomUUID()}`
        await api.setWatchedChannelsLayout({ tabId: copyId, layout })
        const oldPanels = getAllPanels(original.root)
        const newPanels = getAllPanels(layout.root)
        const filters: Record<string, string[]> = {}
        oldPanels.forEach((panel, index) => {
          const prefix = `${id}:${panel.id}`
          for (const [key, ids] of Object.entries(chatRulesStore.get().value.paneFilters)) {
            if (key === prefix || key.startsWith(`${prefix}:`))
              if (newPanels[index])
                filters[`${copyId}:${newPanels[index].id}${key.slice(prefix.length)}`] = [...ids]
          }
        })
        if (Object.keys(filters).length)
          await chatRulesPreferences.save(api, {
            ...chatRulesStore.get().value,
            paneFilters: { ...chatRulesStore.get().value.paneFilters, ...filters },
          })
        value.openIds.splice(value.openIds.indexOf(id) + 1, 0, copyId)
        value.metadata[copyId] = {
          ...value.metadata[id],
          ...(value.metadata[id]?.channelId
            ? { channelId: value.metadata[id].channelId }
            : environment.channels().some((channel) => channel.id === id)
              ? { channelId: id }
              : {}),
          locked: false,
        }
        await persist(value)
        environment.publishLayout(copyId, layout)
        environment.activate(copyId)
        return copyId
      }),
    rename: (id: string, title: string) =>
      change(async (value) => {
        requireOpen(value, id)
        value.metadata[id] = {
          ...value.metadata[id],
          locked: value.metadata[id]?.locked ?? false,
          title: truncateGraphemes(sanitizeDisplayText(title).trim(), 80) || undefined,
        }
        await persist(value)
      }),
    color: (id: string, color?: string) =>
      change(async (value) => {
        requireOpen(value, id)
        if (color && !/^#[a-f0-9]{6}$/iu.test(color))
          throw new Error(t('notices.chatTabs.invalidColor'))
        value.metadata[id] = {
          ...value.metadata[id],
          locked: value.metadata[id]?.locked ?? false,
          color: color || undefined,
        }
        await persist(value)
      }),
    lock: (id: string, locked: boolean) =>
      change(async (value) => {
        requireOpen(value, id)
        value.metadata[id] = { ...value.metadata[id], locked }
        await persist(value)
      }),
    reorder: (id: string, targetIndex: number) =>
      change(async (value) => {
        requireOpen(value, id)
        if (value.metadata[id]?.locked) throw new Error(t('notices.chatTabs.unlockBeforeMove'))
        if (!Number.isSafeInteger(targetIndex)) throw new Error('Invalid tab position.')
        value.openIds.splice(value.openIds.indexOf(id), 1)
        value.openIds.splice(Math.max(0, Math.min(value.openIds.length, targetIndex)), 0, id)
        await persist(value)
      }),
    /** Opens the chat's tab, or with `another` a new tab even when the chat is already open. */
    open: (channel: DesktopWatchedChannel, { another = false }: { another?: boolean } = {}) =>
      change(async (value) => {
        const existing = value.openIds.find(
          (id) => value.metadata[id]?.channelId === channel.id || id === channel.id,
        )
        if (existing && !another) {
          environment.activate(existing)
          return existing
        }
        if (value.openIds.length >= 256) throw new Error(t('notices.chatTabs.closeBeforeOpen'))
        const id = existing ? `tab:${crypto.randomUUID()}` : channel.id
        if (existing) {
          const layout: WatchedChannelsLayout = {
            version: 2,
            root: {
              type: 'panel',
              id: crypto.randomUUID(),
              content: { type: 'watched', channelId: channel.id },
              flex: 100,
            },
            meta: { createdAt: Date.now(), updatedAt: Date.now() },
          }
          await api.setWatchedChannelsLayout({ tabId: id, layout })
          environment.publishLayout(id, layout)
        }
        value.openIds.push(id)
        value.metadata[id] = { channelId: channel.id, locked: false }
        value.closed = value.closed.filter((closed) => closed.id !== id)
        await persist(value)
        environment.activate(id)
        return id
      }),
  }
}

const controllers = new WeakMap<ChatTabApi, ReturnType<typeof createChatTabController>>()
function controller(api: ChatTabApi) {
  let value = controllers.get(api)
  if (!value) {
    value = createChatTabController(
      api,
      {
        channels: () => watchedChannelsStore.get(),
        activeId: () => activeWatchedTabStore.get(),
        activate: (id) => {
          activeWatchedTabStore.set(id)
          setMainTab('chat')
        },
        publishIds: (ids) => tabChannelIdsStore.set(ids),
        layout: (id) => layoutStore.get().get(id)?.layout ?? null,
        publishLayout: (id, layout) =>
          layoutStore.modify((states) =>
            new Map(states).set(id, { layout, isLoading: false, error: null }),
          ),
      },
      chatTabsStore,
    )
    controllers.set(api, value)
  }
  return value
}
export const initializeChatTabs = (backend: { api: ChatTabApi }) =>
  controller(backend.api).initialize()
export const closeChatTab = async (
  backend: { api: ChatTabApi },
  id: string,
  layoutAlreadyFlushed = false,
) => {
  if (!layoutAlreadyFlushed) await saveLayoutNow(backend, id)
  return controller(backend.api).close(id)
}
export const restoreClosedChatTab = (backend: { api: ChatTabApi }, id?: string) =>
  controller(backend.api).restore(id)
export const createEmptyChatTab = (backend: { api: ChatTabApi }) =>
  controller(backend.api).createEmpty()
export const rememberClosedSplit = (backend: { api: ChatTabApi }, entry: ClosedSplit) =>
  controller(backend.api).rememberSplit(entry)
export const consumeClosedSplit = (backend: { api: ChatTabApi }, id: string) =>
  controller(backend.api).consumeSplit(id)
export const duplicateChatTab = (backend: { api: ChatTabApi }, id: string) =>
  controller(backend.api).duplicate(id)
export const renameChatTab = (backend: { api: ChatTabApi }, id: string, title: string) =>
  controller(backend.api).rename(id, title)
export const setChatTabColor = (backend: { api: ChatTabApi }, id: string, color?: string) =>
  controller(backend.api).color(id, color)
export const setChatTabLocked = (backend: { api: ChatTabApi }, id: string, locked: boolean) =>
  controller(backend.api).lock(id, locked)
export const reorderChatTab = (backend: { api: ChatTabApi }, id: string, index: number) =>
  controller(backend.api).reorder(id, index)
export const openChannelChatTab = (
  backend: { api: ChatTabApi },
  channel: DesktopWatchedChannel,
  options?: { another?: boolean },
) => controller(backend.api).open(channel, options)

export interface ChatTabView extends Omit<WatchedChannel, 'platform'> {
  platform?: WatchedPlatform
  empty?: boolean
  sourceChannelId: string
}
export function tabsForChannels(
  channels: DesktopWatchedChannel[],
  ids: string[],
  entries: Record<string, ChatTabMetadata>,
): ChatTabView[] {
  return ids.flatMap<ChatTabView>((id) => {
    const entry = entries[id]
    const layout = layoutStore.get().get(id)?.layout
    const assigned = layout
      ? getAllPanels(layout.root).find((panel) => panel.content.type === 'watched')
      : undefined
    const assignedId = assigned?.content.type === 'watched' ? assigned.content.channelId : undefined
    const channel =
      channels.find((candidate) => candidate.id === entry?.channelId) ??
      channels.find((candidate) => candidate.id === id) ??
      channels.find((candidate) => candidate.id === assignedId)
    return channel
      ? [
          {
            ...channel,
            sourceChannelId: channel.id,
            id,
            displayName: entry?.title ?? channel.displayName,
          },
        ]
      : [
          {
            id,
            empty: true,
            channelSlug: '',
            displayName: entry?.title ?? t('notices.chatTabs.emptyTab'),
            sourceChannelId: '',
            createdAt: 0,
          },
        ]
  })
}

declare module './persistent-resources' {
  interface PersistentResources {
    chatTabs: Store<ChatTabsState>
  }
}
