import { onUnmounted, ref, type Ref } from 'vue'

export function usePolling(
  pollFn: () => Promise<void>,
  intervalMs: number,
): { isRunning: Ref<boolean>; start: () => void; stop: () => void } {
  const isRunning = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  async function tick(): Promise<void> {
    if (isRunning.value) return
    isRunning.value = true
    try {
      await pollFn()
    } finally {
      isRunning.value = false
    }
  }

  function start(): void {
    void tick()
    timer = setInterval(() => void tick(), intervalMs)
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  onUnmounted(stop)

  return { isRunning, start, stop }
}
