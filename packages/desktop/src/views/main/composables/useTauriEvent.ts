import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { onMounted, onUnmounted } from 'vue'

export function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
  let unlisten: UnlistenFn | null = null
  onMounted(async () => {
    unlisten = await listen<T>(event, (e) => handler(e.payload))
  })
  onUnmounted(() => {
    unlisten?.()
  })
}
