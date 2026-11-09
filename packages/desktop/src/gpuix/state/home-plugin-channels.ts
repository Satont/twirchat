import {
  HOME_PLUGIN_CHANNELS_KEY,
  homePluginChannelIdsSchema,
  MAX_HOME_PLUGIN_CHANNELS,
} from '../../watched-channels/home-plugin-preference'
import {
  isPluginWatchedChannel,
  type DesktopWatchedChannel,
  type PluginWatchedChannel,
} from '../../watched-channels/plugin-channel-types'
import type {
  PluginChannelMessage,
  PluginChannelSnapshot,
} from '../../watched-channels/plugin-channels'
import type { DesktopApi } from '../backend/api'
import { t } from '../i18n'
import { createStore, type Store } from './create-store'
import { persistentResource } from './persistent-resources'
import { createPreferenceStore, type PreferenceApi, type PreferenceStore } from './preferences'

const MAX_ROWS = 500

interface HomePluginPreferences {
  preferences: PreferenceStore<string[]>
  writes: Promise<void>
}

const sourceState = persistentResource('homePluginChannels', (): HomePluginPreferences => ({
  preferences: createPreferenceStore<string[]>(HOME_PLUGIN_CHANNELS_KEY, [], (value) =>
    homePluginChannelIdsSchema.parse(value),
  ),
  writes: Promise.resolve(),
}))

export const homePluginChannelsStore = sourceState.preferences.store

export function loadHomePluginChannels(api: PreferenceApi): Promise<void> {
  return sourceState.preferences.load(api)
}

export function setHomePluginChannel(
  api: PreferenceApi,
  id: string,
  included: boolean,
): Promise<void> {
  const write = sourceState.writes.then(async () => {
    await loadHomePluginChannels(api)
    const { value: previous, error } = homePluginChannelsStore.get()
    if (error) throw new Error(error)
    if (previous.includes(id) === included) return undefined
    if (included && previous.length >= MAX_HOME_PLUGIN_CHANNELS)
      throw new Error(t('notices.homePlugin.sourceLimit'))
    const next = included ? [...previous, id] : previous.filter((source) => source !== id)
    try {
      await sourceState.preferences.save(api, next)
    } catch (cause) {
      homePluginChannelsStore.update({ value: previous })
      throw cause
    }
    return undefined
  })
  sourceState.writes = write.catch(() => {})
  return write
}

export interface HomePluginRow {
  channel: PluginWatchedChannel
  message: PluginChannelMessage
  key: string
}

interface HomePluginFeed {
  channels: readonly PluginWatchedChannel[]
  rows: readonly HomePluginRow[]
  total: number
}

interface Source {
  channel: PluginWatchedChannel
  messages: readonly PluginChannelMessage[]
  stop: () => void
}

const emptyFeed: HomePluginFeed = { channels: [], rows: [], total: 0 }
export const homePluginFeedStore = persistentResource('homePluginFeed', () =>
  createStore<HomePluginFeed>(emptyFeed),
)

export function selectedHomePluginChannels(
  channels: readonly DesktopWatchedChannel[],
  ids: readonly string[],
): PluginWatchedChannel[] {
  if (ids.length === 0) return []
  const idsSet = new Set(ids)
  const selected: PluginWatchedChannel[] = []
  for (const channel of channels) {
    if (idsSet.has(channel.id) && isPluginWatchedChannel(channel)) selected.push(channel)
  }
  return selected
}

function sameSource(left: PluginWatchedChannel, right: PluginWatchedChannel | undefined): boolean {
  return (
    left.id === right?.id &&
    left.platform === right.platform &&
    left.channelSlug === right.channelSlug &&
    left.displayName === right.displayName &&
    left.transportName === right.transportName
  )
}

export function observeHomePluginFeed(observe: DesktopApi['observePluginChannel']) {
  const sources = new Map<string, Source>()
  const added = new Map<string, HomePluginRow>()
  const removed = new Map<string, number>()
  let channels: readonly PluginWatchedChannel[] = []
  let retained: HomePluginRow[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let total = homePluginFeedStore.get().total

  function publish() {
    timer = undefined
    let rows = homePluginFeedStore.get().rows
    if (removed.size > 0 || added.size > 0) {
      for (const [key, timestamp] of removed) {
        const index = rowIndex(timestamp, key)
        if (retained[index]?.key === key) retained.splice(index, 1)
      }
      for (const row of added.values()) insertRow(row)
      rows = retained.slice(-MAX_ROWS)
      removed.clear()
      added.clear()
    }
    homePluginFeedStore.set({ channels, rows, total })
  }

  function precedes(row: HomePluginRow, timestamp: number, key: string): boolean {
    return (
      row.message.timestamp < timestamp || (row.message.timestamp === timestamp && row.key < key)
    )
  }

  function rowIndex(timestamp: number, key: string): number {
    let low = 0
    let high = retained.length
    while (low < high) {
      const mid = (low + high) >>> 1
      const candidate = retained[mid]
      if (candidate && precedes(candidate, timestamp, key)) low = mid + 1
      else high = mid
    }
    return low
  }

  function insertRow(row: HomePluginRow) {
    const timestamp = row.message.timestamp
    const last = retained.at(-1)
    if (!last || precedes(last, timestamp, row.key)) retained.push(row)
    else retained.splice(rowIndex(timestamp, row.key), 0, row)
  }

  function schedulePublish() {
    timer ??= setTimeout(publish, 0)
  }

  function rowKey(source: Source, message: PluginChannelMessage): string {
    return `plugin:${source.channel.id}:${message.id}`
  }

  function dropRows(source: Source, count: number) {
    for (const message of source.messages.slice(0, count)) {
      const key = rowKey(source, message)
      if (!added.delete(key)) removed.set(key, message.timestamp)
    }
  }

  function update(source: Source, snapshot: PluginChannelSnapshot) {
    const previous = source.messages
    const next = snapshot.messages
    const last = previous.at(-1)
    if (last === next.at(-1) && previous.length === next.length) return
    // Plugin snapshots append to a ring buffer. The unchanged tail object
    // identifies overlap without revisiting messages still in the buffer.
    const overlap = last ? next.lastIndexOf(last) + 1 : 0
    dropRows(source, previous.length - overlap)
    for (const message of next.slice(overlap)) {
      const key = rowKey(source, message)
      added.set(key, { channel: source.channel, message, key })
    }
    total += next.length - overlap
    source.messages = next
    schedulePublish()
  }

  return {
    sync(selected: readonly PluginWatchedChannel[]) {
      if (
        channels.length === selected.length &&
        channels.every((channel, i) => sameSource(channel, selected[i]))
      )
        return
      const next = new Map(selected.map((channel) => [channel.id, channel]))
      for (const [id, source] of sources) {
        if (sameSource(source.channel, next.get(id))) continue
        dropRows(source, source.messages.length)
        source.stop()
        sources.delete(id)
      }
      channels = selected.map((channel) => sources.get(channel.id)?.channel ?? channel)
      for (const channel of channels) {
        if (sources.has(channel.id)) continue
        const source: Source = {
          channel,
          messages: [],
          stop: () => {},
        }
        sources.set(channel.id, source)
        source.stop = observe(channel.id, (snapshot) => {
          if (sources.get(channel.id) === source) update(source, snapshot)
        })
      }
      schedulePublish()
    },
    stop() {
      for (const source of sources.values()) source.stop()
      sources.clear()
      added.clear()
      removed.clear()
      retained = []
      clearTimeout(timer)
      homePluginFeedStore.set({ ...emptyFeed, total })
    },
  }
}

declare module './persistent-resources' {
  interface PersistentResources {
    homePluginChannels: HomePluginPreferences
    homePluginFeed: Store<HomePluginFeed>
  }
}
