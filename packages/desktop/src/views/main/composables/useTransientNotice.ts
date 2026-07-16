import { ref } from 'vue'
import type { ConnectionNotice } from './useConnectionNotice'

export type TransientNotice = Pick<ConnectionNotice, 'kind' | 'text'>

const notice = ref<TransientNotice | null>(null)
let dismissalTimer: ReturnType<typeof setTimeout> | undefined

function clear(): void {
  if (dismissalTimer) clearTimeout(dismissalTimer)
  dismissalTimer = undefined
  notice.value = null
}

function show(nextNotice: TransientNotice, durationMs: number): void {
  if (dismissalTimer) clearTimeout(dismissalTimer)
  notice.value = nextNotice
  dismissalTimer = setTimeout(clear, durationMs)
}

export function useTransientNotice(): {
  clear: () => void
  notice: typeof notice
  show: (nextNotice: TransientNotice, durationMs: number) => void
} {
  return { clear, notice, show }
}
