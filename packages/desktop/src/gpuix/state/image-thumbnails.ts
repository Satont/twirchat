import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import { runInBackground } from '../../services/background-task'
import { imageThumbnailer } from '../../services/image-thumbnail'
import type { ThumbnailFit } from '../../services/paint-worker-client'
import { persistentResource } from './persistent-resources'
import { createResourceCache } from './resource-cache'

interface ThumbnailRequest {
  path: string
  size: number
  fit: ThumbnailFit
}

function createImageThumbnails() {
  return createResourceCache<ThumbnailRequest, string>({
    key: ({ path, size, fit }) => JSON.stringify([path, size, fit]),
    load: ({ path, size, fit }) => imageThumbnailer.render(path, size, { fit }),
    capacity: 512,
    concurrency: 2,
    ttlMs: 24 * 60 * 60_000,
  })
}

const imageThumbnails = persistentResource('imageThumbnails', createImageThumbnails)

export function useImageThumbnail(
  path: string | null | undefined,
  size: number | undefined,
  fit: ThumbnailFit,
  visible: boolean,
): string | undefined {
  const input = useMemo(() => (path && size ? { path, size, fit } : undefined), [path, size, fit])
  const subscribe = useCallback(
    (listener: () => void) =>
      input && visible ? imageThumbnails.subscribe(input, listener) : () => {},
    [input, visible],
  )
  const snapshot = useCallback(() => (input ? imageThumbnails.snapshot(input) : undefined), [input])
  const image = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (input && visible)
      runInBackground(imageThumbnails.ensure(input), 'Image thumbnail preparation failed')
  }, [input, visible])
  if (!input) return typeof path === 'string' ? path : undefined
  if (image?.status === 'ready') return image.value
  return image?.status === 'error' ? input.path : undefined
}

declare module './persistent-resources' {
  interface PersistentResources {
    imageThumbnails: ReturnType<typeof createImageThumbnails>
  }
}
