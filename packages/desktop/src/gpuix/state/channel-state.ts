import type { RoomState } from '@twirchat/shared/channel-tools'
import type { Platform } from '@twirchat/shared/types'

import type { DesktopBackend } from '../backend/server'
import { applyChannelClear } from './app'
import type { Store } from './create-store'
import { createStore } from './create-store'
import { persistentResource } from './persistent-resources'

export const channelRoomStore = persistentResource('channelRooms', () =>
  createStore<Map<string, RoomState>>(new Map()),
)
export function roomKey(platform: Platform, channel: string): string {
  return `${platform}:${channel.replace(/^#/u, '').toLowerCase()}`
}
export function updateRoomState(state: RoomState): void {
  const key = roomKey(state.platform, state.channelId)
  channelRoomStore.modify((rooms) => new Map(rooms).set(key, { ...rooms.get(key), ...state }))
}
const pending = new Map<string, Promise<void>>()
export async function loadRoomState(
  backend: DesktopBackend,
  platform: Platform,
  channelSlug: string,
): Promise<void> {
  if (platform !== 'twitch') return
  const key = roomKey(platform, channelSlug)
  if (pending.has(key)) return pending.get(key)
  const request = backend.api
    .getChannelRoomState({ platform, channelSlug })
    .then(updateRoomState)
    .catch(() => {})
    .finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}
export function wireChannelState(backend: DesktopBackend): () => void {
  const unsubscribe = [
    backend.events.on('channel_room_state', updateRoomState),
    backend.events.on('chat_clear', applyChannelClear),
  ]
  return () => {
    for (const off of unsubscribe) off()
  }
}

declare module './persistent-resources' {
  interface PersistentResources {
    channelRooms: Store<Map<string, RoomState>>
  }
}
