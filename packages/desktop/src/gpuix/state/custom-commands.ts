import type { DesktopApi } from '../backend/api'
import { validateCustomCommands, type CustomCommandDefinition } from '../commands'
import { t } from '../i18n'
import { createStore, type Store } from './create-store'
import { persistentResource } from './persistent-resources'

export const CUSTOM_COMMANDS_KEY = 'custom_commands_v1'
type PersistenceApi = Pick<DesktopApi, 'getUiState' | 'setUiState'>

export interface CustomCommandsState {
  commands: CustomCommandDefinition[]
  loaded: boolean
  loading: boolean
  saving: boolean
  error: string | null
}

const INITIAL_STATE: CustomCommandsState = {
  commands: [],
  loaded: false,
  loading: false,
  saving: false,
  error: null,
}

export function createCustomCommandsController(
  store: Store<CustomCommandsState> = createStore(INITIAL_STATE),
) {
  let loading: Promise<void> | null = null
  let writes: Promise<void> = Promise.resolve()
  let pendingWrites = 0

  const load = (api: PersistenceApi): Promise<void> => {
    if (store.get().loaded) return Promise.resolve()
    if (loading) return loading
    store.update({ loading: true, error: null })
    loading = (async () => {
      let raw: string | null
      try {
        raw = await api.getUiState({ key: CUSTOM_COMMANDS_KEY })
      } catch (error) {
        store.update({ loading: false, error: errorText(error) })
        throw error
      }
      try {
        const value: unknown = raw === null ? [] : JSON.parse(raw)
        store.update({
          commands: validateCustomCommands(value),
          loaded: true,
          loading: false,
          error: null,
        })
      } catch (error) {
        // A corrupt saved list is visible and can be replaced by an explicit save.
        store.update({
          loaded: true,
          loading: false,
          error: t('notices.customCommands.loadFailed', { error: errorText(error) }),
        })
      }
    })().finally(() => {
      loading = null
    })
    return loading
  }

  const save = (api: PersistenceApi, commands: CustomCommandDefinition[]): Promise<void> => {
    let validated: CustomCommandDefinition[]
    try {
      validated = validateCustomCommands(commands)
    } catch (error) {
      store.update({ error: errorText(error) })
      return Promise.reject(error)
    }
    pendingWrites++
    store.update({ saving: true, error: null })
    const write = writes
      .catch(() => {})
      .then(async () => {
        await load(api)
        await api.setUiState({ key: CUSTOM_COMMANDS_KEY, value: JSON.stringify(validated) })
        store.update({ commands: validated, error: null })
      })
      .catch((error: unknown) => {
        store.update({
          error: t('notices.customCommands.saveFailed', { error: errorText(error) }),
        })
        throw error
      })
      .finally(() => {
        pendingWrites--
        store.update({ saving: pendingWrites > 0 })
      })
    writes = write
    return write
  }
  return { store, load, save }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const customCommandsStore = persistentResource('customCommands', () =>
  createStore<CustomCommandsState>(INITIAL_STATE),
)
const controllerStore = persistentResource('customCommandsController', () =>
  createStore<ReturnType<typeof createCustomCommandsController> | null>(null),
)
const controller = controllerStore.get() ?? createCustomCommandsController(customCommandsStore)
controllerStore.set(controller)

export const loadCustomCommands = controller.load
export const saveCustomCommands = controller.save

declare module './persistent-resources' {
  interface PersistentResources {
    customCommands: Store<CustomCommandsState>
    customCommandsController: Store<ReturnType<typeof createCustomCommandsController> | null>
  }
}
