import { runInBackground } from '../../services/background-task'
import {
  DEFAULT_STREAMER_MODE_SETTINGS,
  type StreamerMode,
  type StreamerModeSettings,
  type StreamerModeStatus,
} from '../../services/streamer-mode'
import type { DesktopApi } from '../backend/api'
import type { DesktopBackend } from '../backend/server'
import type { Store } from './create-store'
import { createStore } from './create-store'
import { persistentResource } from './persistent-resources'

export const streamerModeStore = persistentResource('streamerMode', () =>
  createStore<StreamerModeStatus>({
    mode: 'auto',
    effectiveEnabled: false,
    settings: { ...DEFAULT_STREAMER_MODE_SETTINGS },
    error: null,
    checking: false,
  }),
)
export const streamerModeRequestStore = persistentResource('streamerModeRequests', () =>
  createStore<StreamerModeRequestState>({
    loaded: false,
    loading: false,
    saving: false,
    error: null,
  }),
)
let revision = 0
let loading: Promise<void> | undefined
function apply(status: StreamerModeStatus) {
  revision++
  streamerModeStore.set(status)
  streamerModeRequestStore.update({ loaded: true, error: null })
}
export function loadStreamerMode(backend: {
  api: Pick<DesktopApi, 'getStreamerMode'>
}): Promise<void> {
  if (loading) return loading
  const requested = revision
  streamerModeRequestStore.update({ loading: true, error: null })
  loading = backend.api
    .getStreamerMode()
    .then((status) => {
      if (requested === revision) apply(status)
    })
    .catch((cause: unknown) => {
      streamerModeRequestStore.update({
        error: cause instanceof Error ? cause.message : String(cause),
      })
    })
    .finally(() => {
      loading = undefined
      streamerModeRequestStore.update({ loading: false })
    })
  return loading
}
export function wireStreamerMode(backend: {
  events: DesktopBackend['events']
  api: Pick<DesktopApi, 'getStreamerMode'>
}): () => void {
  const off = backend.events.on('streamer_mode_changed', apply)
  runInBackground(loadStreamerMode(backend), 'streamer-mode background operation failed')
  return off
}
let pendingSaves = 0
async function save(operation: () => Promise<StreamerModeStatus>): Promise<void> {
  pendingSaves++
  const requested = revision
  streamerModeRequestStore.update({ saving: true, error: null })
  try {
    const status = await operation()
    if (requested === revision) apply(status)
  } catch (cause) {
    streamerModeRequestStore.update({
      error: cause instanceof Error ? cause.message : String(cause),
    })
    throw cause
  } finally {
    pendingSaves--
    streamerModeRequestStore.update({ saving: pendingSaves > 0 })
  }
}
export const saveStreamerMode = (
  backend: { api: Pick<DesktopApi, 'setStreamerMode'> },
  mode: StreamerMode | 'toggle',
): Promise<void> => save(() => backend.api.setStreamerMode({ mode }))
export const saveStreamerModeSettings = (
  backend: { api: Pick<DesktopApi, 'setStreamerModeSettings'> },
  settings: StreamerModeSettings,
): Promise<void> => save(() => backend.api.setStreamerModeSettings({ settings }))

interface StreamerModeRequestState {
  loaded: boolean
  loading: boolean
  saving: boolean
  error: string | null
}

declare module './persistent-resources' {
  interface PersistentResources {
    streamerMode: Store<StreamerModeStatus>
    streamerModeRequests: Store<StreamerModeRequestState>
  }
}
