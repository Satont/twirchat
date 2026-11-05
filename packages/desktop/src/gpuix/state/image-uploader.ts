import type { ImageUploaderSettings } from '../../services/image-uploader'
import type { DesktopApi } from '../backend/api'
import { createStore, type Store } from './create-store'
import { persistentResource } from './persistent-resources'

export const imageUploaderSettingsStore = persistentResource('imageUploaderSettings', () =>
  createStore<ImageUploaderSettings | null>(null),
)

let pending: Promise<ImageUploaderSettings> | null = null

export function applyImageUploaderSettings(settings: ImageUploaderSettings): void {
  imageUploaderSettingsStore.set(settings)
}

export async function loadImageUploaderSettings(
  api: Pick<DesktopApi, 'getImageUploaderSettings'>,
): Promise<ImageUploaderSettings> {
  const saved = imageUploaderSettingsStore.get()
  if (saved) return Promise.resolve(saved)
  if (pending) return pending
  pending = api
    .getImageUploaderSettings()
    .then((loaded) => {
      const current = imageUploaderSettingsStore.get()
      if (current) return current
      applyImageUploaderSettings(loaded)
      return loaded
    })
    .finally(() => {
      pending = null
    })
  return pending
}

declare module './persistent-resources' {
  interface PersistentResources {
    imageUploaderSettings: Store<ImageUploaderSettings | null>
  }
}
