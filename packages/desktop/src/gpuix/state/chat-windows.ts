import type { Store } from './create-store'
import { createStore } from './create-store'
import { persistentResource } from './persistent-resources'

interface ChatWindowRegistration {
  tabId?: string
  reading?: boolean
  activate(): void
}
export const chatWindowsStore = persistentResource('chatWindows', () =>
  createStore<Map<string, ChatWindowRegistration>>(new Map()),
)
interface ChatWindowRuntime {
  managers: number
  navigators: Map<string, () => void>
}
const runtime = persistentResource('chatWindowRuntime', (): ChatWindowRuntime => ({
  managers: 0,
  navigators: new Map(),
}))
const { navigators } = runtime
export function registerChatWindow(
  scope: string,
  registration: ChatWindowRegistration,
): () => void {
  chatWindowsStore.modify((entries) => new Map(entries).set(scope, registration))
  return () =>
    chatWindowsStore.modify((entries) => {
      if (entries.get(scope) !== registration) return entries
      const next = new Map(entries)
      next.delete(scope)
      return next
    })
}
export function registerChatWindowManager(): () => void {
  runtime.managers++
  let active = true
  return () => {
    if (active) {
      active = false
      runtime.managers--
    }
  }
}
export function isMainChatWindowOpen(): boolean {
  return runtime.managers === 0 || chatWindowsStore.get().has('main')
}
export function setChatWindowReading(scope: string, reading: boolean): void {
  chatWindowsStore.modify((entries) => {
    const entry = entries.get(scope)
    if (!entry || entry.reading === reading) return entries
    entry.reading = reading
    return new Map(entries)
  })
}
export function registerChatWindowNavigator(scope: string, navigate: () => void): () => void {
  navigators.set(scope, navigate)
  return () => {
    if (navigators.get(scope) === navigate) navigators.delete(scope)
  }
}
export function activateChatSearchWindow(scope: string): boolean {
  const registration = chatWindowsStore.get().get(scope)
  if (!registration) return false
  navigators.get(scope)?.()
  registration.activate()
  return true
}

declare module './persistent-resources' {
  interface PersistentResources {
    chatWindows: Store<Map<string, ChatWindowRegistration>>
    chatWindowRuntime: ChatWindowRuntime
  }
}
