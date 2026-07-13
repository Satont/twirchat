import { onUnmounted } from 'vue'

import { desktopEvents, type DesktopEventMap } from '../services/desktop-events'

export function useRpcListener<K extends keyof DesktopEventMap>(
  event: K,
  handler: (payload: DesktopEventMap[K]) => void,
): void {
  const unsubscribe = desktopEvents.on(event, handler)

  onUnmounted(() => {
    unsubscribe()
  })
}
