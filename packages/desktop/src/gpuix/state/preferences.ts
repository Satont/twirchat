import { createStore, type Store } from './create-store'

export interface PreferenceApi {
  getUiState(params: { key: string }): Promise<string | null>
  setUiState(params: { key: string; value: string }): Promise<void>
}

export interface PreferenceState<T> {
  value: T
  loaded: boolean
  loading: boolean
  saving: boolean
  error: string | null
}

export interface PreferenceStore<T> {
  store: Store<PreferenceState<T>>
  load(api: PreferenceApi): Promise<void>
  save(api: PreferenceApi, value: T): Promise<void>
}

/** JSON preferences stay behind the desktop bridge and serialize disk writes. */
export function createPreferenceStore<T>(
  key: string,
  defaults: T,
  validate: (value: unknown) => T,
): PreferenceStore<T> {
  const initialDefaults = structuredClone(defaults)
  const store = createStore<PreferenceState<T>>({
    value: structuredClone(initialDefaults),
    loaded: false,
    loading: false,
    saving: false,
    error: null,
  })
  let loading: Promise<void> | null = null
  let writes: Promise<void> = Promise.resolve()
  let revision = 0
  const preferences: PreferenceStore<T> = {
    store,
    async load(api) {
      if (store.get().loaded && !store.get().error) return
      if (loading) return loading
      const requestedAt = revision
      store.update({ loading: true, error: null })
      loading = (async () => {
        try {
          const raw = await api.getUiState({ key })
          const value = raw === null ? structuredClone(initialDefaults) : validate(JSON.parse(raw))
          if (revision === requestedAt) store.update({ value, loaded: true, loading: false })
          else store.update({ loaded: true, loading: false })
        } catch (error) {
          store.update(
            revision === requestedAt
              ? {
                  loaded: true,
                  loading: false,
                  error: error instanceof Error ? error.message : String(error),
                }
              : { loaded: true, loading: false },
          )
        } finally {
          loading = null
        }
      })()
      return loading
    },
    save(api, value) {
      let validated: T
      try {
        validated = validate(structuredClone(value))
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        store.update({ error: failure.message })
        return Promise.reject(failure)
      }
      const savedAt = ++revision
      store.update({ value: validated, loaded: true, saving: true, error: null })
      const write = async () => {
        try {
          await api.setUiState({ key, value: JSON.stringify(validated) })
          if (revision === savedAt) store.update({ saving: false, error: null })
        } catch (error) {
          if (revision === savedAt)
            store.update({
              saving: false,
              error: error instanceof Error ? error.message : String(error),
            })
          throw error
        }
      }
      const result = writes.then(write, write)
      writes = result.catch(() => {})
      return result
    },
  }
  return preferences
}
