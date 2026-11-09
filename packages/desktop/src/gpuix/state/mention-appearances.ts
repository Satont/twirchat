import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'

import { createStore, type Store } from './create-store'
import { persistentResource } from './persistent-resources'

type Appearance = Readonly<Pick<NormalizedChatMessage['author'], 'id' | 'username' | 'color'>>

interface Entry {
  appearance: Appearance
  timestamp: number
}

interface Observation {
  store: Store<Appearance | undefined>
  subscribers: number
}

function normalizeName(name: string): string {
  return (name.startsWith('@') ? name.slice(1) : name).toLowerCase()
}

export function mentionAppearanceKey(platform: Platform, name: string): string {
  return `${platform}:${normalizeName(name)}`
}

export function createMentionAppearances(capacity = 5000) {
  const entries = new Map<string, Entry>()
  const observations = new Map<string, Observation>()

  function remember(key: string, author: NormalizedChatMessage['author'], timestamp: number) {
    const existing = entries.get(key)
    if (existing) {
      if (existing.timestamp > timestamp) return
      existing.timestamp = timestamp
      const { id, username, color } = existing.appearance
      if (author.id === id && author.username === username && author.color === color) return
    } else if (entries.size >= capacity) {
      // Trim in one pass so successive insertions don't each traverse deleted keys.
      const retain = Math.floor(capacity / 2)
      for (const oldest of entries.keys()) {
        if (entries.size <= retain) break
        entries.delete(oldest)
        observations.get(oldest)?.store.set(undefined)
      }
    }
    const { id, username, color } = author
    const appearance = { id, username, color }
    entries.set(key, { appearance, timestamp })
    observations.get(key)?.store.set(appearance)
  }

  return {
    addMessage({ platform, author, timestamp, type, delivery }: NormalizedChatMessage): void {
      if (type === 'system' || delivery || !author.id) return
      const username = author.username ? normalizeName(author.username) : ''
      const displayName = normalizeName(author.displayName)
      const time = timestamp.getTime()
      if (username) remember(`${platform}:${username}`, author, time)
      if (displayName && displayName !== username)
        remember(`${platform}:${displayName}`, author, time)
    },
    snapshot(key: string): Appearance | undefined {
      return entries.get(key)?.appearance
    },
    subscribe(key: string, listener: () => void): () => void {
      let observation = observations.get(key)
      if (!observation) {
        observation = { store: createStore(entries.get(key)?.appearance), subscribers: 0 }
        observations.set(key, observation)
      }
      observation.subscribers++
      const unsubscribe = observation.store.subscribe(listener)
      return () => {
        unsubscribe()
        if (--observation.subscribers === 0) observations.delete(key)
      }
    },
  }
}

export const mentionAppearances = persistentResource('mentionAppearances', createMentionAppearances)

declare module './persistent-resources' {
  interface PersistentResources {
    mentionAppearances: ReturnType<typeof createMentionAppearances>
  }
}
