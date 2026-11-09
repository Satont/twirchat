import { basename } from 'node:path'

import { z } from 'zod'

import { t } from '../gpuix/i18n'
import { runInBackground } from './background-task'

export type StreamerMode = 'auto' | 'on' | 'off'
export interface StreamerModeSettings {
  hideUsercardAvatars: boolean
  hideLinkThumbnails: boolean
  hideModActions: boolean
  hideRestrictedUsers: boolean
  muteMentions: boolean
  suppressInlineWhispers: boolean
  hideBlockedTermText: boolean
  hideViewerCountAndDuration: boolean
  suppressLiveNotifications: boolean
}
export const DEFAULT_STREAMER_MODE_SETTINGS: StreamerModeSettings = {
  hideUsercardAvatars: true,
  hideLinkThumbnails: true,
  hideModActions: true,
  hideRestrictedUsers: true,
  muteMentions: true,
  suppressInlineWhispers: true,
  hideBlockedTermText: true,
  hideViewerCountAndDuration: false,
  suppressLiveNotifications: false,
}
export interface StreamerModeStatus {
  mode: StreamerMode
  effectiveEnabled: boolean
  settings: StreamerModeSettings
  error: string | null
  checking: boolean
}
export interface StreamerModeConfiguration {
  mode: StreamerMode
  settings: StreamerModeSettings
}
const streamerSettingsSchema = z.toZod<StreamerModeSettings>()(
  z.object({
    hideUsercardAvatars: z.boolean(),
    hideLinkThumbnails: z.boolean(),
    hideModActions: z.boolean(),
    hideRestrictedUsers: z.boolean(),
    muteMentions: z.boolean(),
    suppressInlineWhispers: z.boolean(),
    hideBlockedTermText: z.boolean(),
    hideViewerCountAndDuration: z.boolean(),
    suppressLiveNotifications: z.boolean(),
  }),
)
export function validateStreamerModeSettings(value: unknown): StreamerModeSettings {
  const parsed = streamerSettingsSchema.safeParse(value)
  if (!parsed.success) throw new Error(t('notices.streamerMode.invalidSettings'))
  return parsed.data
}
export function validateStreamerModeConfiguration(value: unknown): StreamerModeConfiguration {
  const parsed = z
    .object({ mode: z.enum(['auto', 'on', 'off']), settings: streamerSettingsSchema })
    .safeParse(value)
  if (!parsed.success) throw new Error(t('notices.streamerMode.invalidConfiguration'))
  return parsed.data
}
const UNIX_PROCESSES = new Set(['obs', 'twitch studio', 'streamlabs desktop'])
const WINDOWS_PROCESSES = new Set([
  'obs.exe',
  'obs64.exe',
  'prismlivestudio.exe',
  'xsplit.core.exe',
  'twitchstudio.exe',
  'twitch studio.exe',
  'vmix64.exe',
  'streamlabs desktop.exe',
  'streamlabs obs.exe',
  'streamlabsdesktop.exe',
])
export function hasStreamingProcess(names: readonly string[], platform: string): boolean {
  const allowed = platform === 'win32' ? WINDOWS_PROCESSES : UNIX_PROCESSES
  return names.some((name) => allowed.has(name.toLowerCase()))
}
export function parseStreamingProcessOutput(output: string, platform: string): string[] {
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return []
    if (platform === 'win32') {
      const match = /^"((?:[^"]|"")*)"/.exec(line.trim())
      return match?.[1] ? [match[1].replace(/""/g, '"')] : []
    }
    return [basename(line.trim())]
  })
}
export async function listStreamingProcesses(
  platform: string,
  signal: AbortSignal,
): Promise<string[]> {
  const argv =
    platform === 'win32'
      ? ['tasklist', '/FO', 'CSV', '/NH']
      : ['ps', '-A', '-o', platform === 'darwin' ? 'comm=' : 'exe=']
  const child = Bun.spawn(argv, {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
    windowsHide: true,
  })
  const abort = () => {
    child.kill()
  }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  try {
    const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    if (signal.aborted) throw new Error(t('notices.streamerMode.detectionTimeout'))
    if (code !== 0) throw new Error(t('notices.streamerMode.detectionExitCode', { code }))
    if (output.length > 8_000_000) throw new Error(t('notices.streamerMode.processListTooLarge'))
    return parseStreamingProcessOutput(output, platform)
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
export interface StreamerModeDependencies {
  read(): unknown
  write(value: StreamerModeConfiguration): Promise<void> | void
  publish(status: StreamerModeStatus): void
  platform?: string
  processes?(platform: string, signal: AbortSignal): Promise<string[]>
  scheduleInterval?(callback: () => void, delay: number): () => void
  scheduleTimeout?(callback: () => void, delay: number): () => void
}
export function createStreamerModeService(dependencies: StreamerModeDependencies) {
  let configuration: StreamerModeConfiguration = {
    mode: 'auto',
    settings: structuredClone(DEFAULT_STREAMER_MODE_SETTINGS),
  }
  let effective = false
  let configurationError: string | null = null
  let error: string | null = null
  try {
    const saved = dependencies.read()
    if (saved !== null && saved !== undefined)
      configuration = validateStreamerModeConfiguration(saved)
  } catch (cause) {
    configurationError = cause instanceof Error ? cause.message : String(cause)
  }
  if (configuration.mode !== 'auto') effective = configuration.mode === 'on'
  let started = false
  let generation = 0
  let timer: (() => void) | undefined
  let running:
    | {
        controller: AbortController
        promise: Promise<void>
        deadline: () => void
      }
    | undefined
  let checking = false
  let writes: Promise<unknown> = Promise.resolve()
  const interval =
    dependencies.scheduleInterval ??
    ((callback: () => void, delay: number) => {
      const handle = setInterval(callback, delay)
      handle.unref()
      return () => clearInterval(handle)
    })
  const timeout =
    dependencies.scheduleTimeout ??
    ((callback: () => void, delay: number) => {
      const handle = setTimeout(callback, delay)
      handle.unref()
      return () => clearTimeout(handle)
    })
  const clearEvery = (cancel: () => void) => cancel()
  const clearAfter = (cancel: () => void) => cancel()
  const getStatus = (): StreamerModeStatus => ({
    mode: configuration.mode,
    effectiveEnabled: effective,
    settings: { ...configuration.settings },
    error: configurationError ?? error,
    checking,
  })
  const publish = () => dependencies.publish(getStatus())
  const check = (): Promise<void> => {
    if (!started || configuration.mode !== 'auto') return Promise.resolve()
    if (running) return running.promise
    const revision = generation
    const controller = new AbortController()
    checking = true
    publish()
    let timedOut = false
    const limit = timeout(() => {
      timedOut = true
      controller.abort()
      if (started && revision === generation && configuration.mode === 'auto') {
        error = t('notices.streamerMode.detectionTimeoutOverride')
        checking = false
        publish()
      }
    }, 1000)
    const promise = Promise.resolve()
      .then(() =>
        (dependencies.processes ?? listStreamingProcesses)(
          dependencies.platform ?? process.platform,
          controller.signal,
        ),
      )
      .then((names) => {
        if (!started || revision !== generation || timedOut || configuration.mode !== 'auto') return
        effective = hasStreamingProcess(names, dependencies.platform ?? process.platform)
        error = null
      })
      .catch((cause) => {
        if (started && revision === generation && !timedOut)
          error = t('notices.streamerMode.detectionFailed', {
            error: cause instanceof Error ? cause.message : String(cause),
          })
      })
      .finally(() => {
        clearAfter(limit)
        if (running?.controller === controller) running = undefined
        if (started && revision === generation) {
          checking = false
          publish()
        }
      })
    running = { controller, promise, deadline: limit }
    return promise
  }
  const stopDetector = () => {
    generation++
    if (timer !== undefined) clearEvery(timer)
    timer = undefined
    if (running) {
      clearAfter(running.deadline)
      running.controller.abort()
    }
    checking = false
  }
  const startDetector = () => {
    if (!started || configuration.mode !== 'auto') return
    if (timer === undefined) {
      timer = interval(() => {
        runInBackground(check(), 'streamer-mode background operation failed')
      }, 20000)
    }
    if (running)
      runInBackground(
        running.promise.then(() => {
          if (started && configuration.mode === 'auto')
            runInBackground(check(), 'Streamer mode detection failed')
        }),
        'streamer-mode background operation failed',
      )
    else runInBackground(check(), 'streamer-mode background operation failed')
  }
  const change = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = writes.catch(() => {}).then(operation)
    writes = next
    return next
  }
  return {
    getStatus,
    check,
    start(): void {
      if (started) return
      started = true
      startDetector()
      publish()
    },
    stop(): void {
      started = false
      stopDetector()
    },
    setMode(mode: StreamerMode | 'toggle'): Promise<StreamerModeStatus> {
      return change(async () => {
        if (!['auto', 'on', 'off', 'toggle'].includes(mode))
          throw new Error(t('notices.streamerMode.invalidMode'))
        const next = mode === 'toggle' ? (effective ? 'off' : 'on') : mode
        await dependencies.write({ ...configuration, mode: next })
        stopDetector()
        configuration = { ...configuration, mode: next }
        if (next !== 'auto') effective = next === 'on'
        error = null
        configurationError = null
        startDetector()
        publish()
        return getStatus()
      })
    },
    setSettings(settings: StreamerModeSettings): Promise<StreamerModeStatus> {
      return change(async () => {
        const next = validateStreamerModeSettings(settings)
        await dependencies.write({ ...configuration, settings: next })
        configuration = { ...configuration, settings: next }
        configurationError = null
        publish()
        return getStatus()
      })
    },
  }
}
export type StreamerModeService = ReturnType<typeof createStreamerModeService>
