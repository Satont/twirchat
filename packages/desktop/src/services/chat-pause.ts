import { z } from 'zod'
export type ChatPauseReason = 'mouse' | 'keyboardModifier' | 'doubleClick' | 'manual' | 'search'
export const DOUBLE_CLICK_PAUSE_MS = 200
export type PauseModifierKey = 'ctrl' | 'alt' | 'shift' | 'cmd'
export const PAUSE_MODIFIER_KEYS: PauseModifierKey[] = ['ctrl', 'alt', 'shift', 'cmd']
export interface ChatPausePreferences {
  hoverSeconds: number
  modifier: string
  doubleClickLinks: boolean
}
export const DEFAULT_CHAT_PAUSE_PREFERENCES: Readonly<ChatPausePreferences> = {
  hoverSeconds: 0,
  modifier: 'none',
  doubleClickLinks: false,
}

export function normalizePauseModifier(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'none') return 'none'
  const keys = normalized.split('+').map((key) => key.trim())
  if (
    !keys.length ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !PAUSE_MODIFIER_KEYS.some((candidate) => candidate === key))
  )
    throw new Error('Choose none or a combination of Ctrl, Alt, Shift and Cmd.')
  return PAUSE_MODIFIER_KEYS.filter((key) => keys.includes(key)).join('+')
}

export function validateChatPausePreferences(value: unknown): ChatPausePreferences {
  if (!value || typeof value !== 'object') throw new Error('Invalid chat pause settings.')
  const input = z
    .object({ hoverSeconds: z.number(), modifier: z.string(), doubleClickLinks: z.boolean() })
    .parse(value)
  if (
    typeof input.hoverSeconds !== 'number' ||
    !Number.isFinite(input.hoverSeconds) ||
    (input.hoverSeconds !== -1 && (input.hoverSeconds < 0 || input.hoverSeconds > 300))
  )
    throw new Error('Hover pause must be -1, or between 0 and 300 seconds.')
  if (typeof input.modifier !== 'string' || typeof input.doubleClickLinks !== 'boolean')
    throw new Error('Invalid chat pause settings.')
  return {
    hoverSeconds: input.hoverSeconds,
    modifier: normalizePauseModifier(input.modifier),
    doubleClickLinks: input.doubleClickLinks,
  }
}

export function matchesPauseModifier(
  setting: string,
  held: Partial<Record<PauseModifierKey, boolean>> = {},
): boolean {
  let normalized: string
  try {
    normalized = normalizePauseModifier(setting)
  } catch {
    return false
  }
  if (normalized === 'none') return false
  const expected = normalized.split('+')
  return PAUSE_MODIFIER_KEYS.every((key) => !!held[key] === expected.includes(key))
}

export function hoverPauseDurationMs(seconds: number): number | null {
  return seconds === -1 ? null : seconds * 1000
}

export interface ChatPauseController {
  add(reason: ChatPauseReason, durationMs?: number | null): void
  remove(reason: ChatPauseReason): void
  clear(): void
  deactivate(): void
  isPaused(): boolean
  reasons(): ReadonlySet<ChatPauseReason>
  dispose(): void
}
export interface ChatPauseControllerOptions<T = ReturnType<typeof setTimeout>> {
  onChange(paused: boolean): void
  now?: () => number
  schedule?: (callback: () => void, durationMs: number) => T
  cancel?: (handle: T) => void
}

/** Each reason owns its deadline; an indefinite reason never masks finite expiry. */
export function createPauseController<T = ReturnType<typeof setTimeout>>(
  options: ChatPauseControllerOptions<T>,
): ChatPauseController {
  const now = options.now ?? (() => performance.now())
  const schedule = (callback: () => void, ms: number): (() => void) => {
    if (options.schedule && options.cancel) {
      const handle = options.schedule(callback, ms)
      return () => options.cancel?.(handle)
    }
    const handle = setTimeout(callback, ms)
    return () => clearTimeout(handle)
  }
  const cancel = (handle: () => void) => handle()
  const deadlines = new Map<ChatPauseReason, number | null>()
  let timer: { handle: () => void; deadline: number } | null = null
  let generation = 0
  let paused = false
  let disposed = false

  function cancelTimer(): void {
    generation++
    if (timer !== null) cancel(timer.handle)
    timer = null
  }
  function expire(): void {
    const current = now()
    for (const [reason, deadline] of deadlines)
      if (deadline !== null && deadline <= current) deadlines.delete(reason)
  }
  function synchronize(): void {
    expire()
    let nearest = Infinity
    for (const deadline of deadlines.values())
      if (deadline !== null) nearest = Math.min(nearest, deadline)
    if (timer?.deadline !== nearest) {
      cancelTimer()
      if (nearest !== Infinity) {
        const scheduledGeneration = generation
        const handle = schedule(
          () => {
            if (disposed || scheduledGeneration !== generation) return
            timer = null
            synchronize()
          },
          Math.min(2_147_483_647, Math.max(0, nearest - now())),
        )
        timer = { handle, deadline: nearest }
      }
    }
    const next = deadlines.size > 0
    if (next !== paused) {
      paused = next
      options.onChange(next)
    }
  }
  function liveReasons(): ReadonlySet<ChatPauseReason> {
    const current = now()
    return new Set(
      [...deadlines]
        .filter(([, deadline]) => deadline === null || deadline > current)
        .map(([reason]) => reason),
    )
  }
  return {
    add(reason, durationMs) {
      if (disposed) return
      if (durationMs !== undefined && durationMs !== null) {
        if (!Number.isFinite(durationMs) || !Number.isFinite(now() + durationMs))
          throw new Error('Pause duration must be finite, or null for an indefinite pause.')
        if (durationMs <= 0) deadlines.delete(reason)
        else deadlines.set(reason, now() + durationMs)
      } else deadlines.set(reason, null)
      synchronize()
    },
    remove(reason) {
      if (disposed) return
      deadlines.delete(reason)
      synchronize()
    },
    clear() {
      if (disposed) return
      deadlines.clear()
      synchronize()
    },
    deactivate() {
      if (disposed) return
      deadlines.delete('keyboardModifier')
      deadlines.delete('doubleClick')
      synchronize()
    },
    isPaused: () => !disposed && liveReasons().size > 0,
    reasons: () => liveReasons(),
    dispose() {
      if (disposed) return
      disposed = true
      cancelTimer()
      deadlines.clear()
    },
  }
}
