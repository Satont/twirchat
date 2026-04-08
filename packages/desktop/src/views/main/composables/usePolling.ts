import { onUnmounted, ref } from 'vue'

export function usePolling(fn: () => Promise<void>, intervalMs: number) {
  const isRunning = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  async function tick() {
    if (isRunning.value) return
    isRunning.value = true
    try {
      await fn()
    } finally {
      isRunning.value = false
    }
  }

  function start() {
    void tick()
    timer = setInterval(() => void tick(), intervalMs)
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  onUnmounted(stop)

  return { isRunning, start, stop }
}
