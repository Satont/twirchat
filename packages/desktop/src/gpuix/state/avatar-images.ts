import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import { avatarThumbnailer } from '../../services/avatar-image'
import { runInBackground } from '../../services/background-task'
import { persistentResource } from './persistent-resources'
import { createResourceCache } from './resource-cache'

interface AvatarImageRequest {
  path: string
  size: number
}

function createAvatarImages() {
  return createResourceCache<AvatarImageRequest, string>({
    key: ({ path, size }) => JSON.stringify([path, size]),
    load: ({ path, size }) => avatarThumbnailer.render(path, size),
    capacity: 512,
    concurrency: 2,
    ttlMs: 24 * 60 * 60_000,
  })
}

const avatarImages = persistentResource('avatarImages', createAvatarImages)

export function useAvatarImage(
  path: string | null | undefined,
  size: number | undefined,
  visible: boolean,
): string | undefined {
  const input = useMemo(() => (path && size ? { path, size } : undefined), [path, size])
  const subscribe = useCallback(
    (listener: () => void) =>
      input && visible ? avatarImages.subscribe(input, listener) : () => {},
    [input, visible],
  )
  const snapshot = useCallback(() => (input ? avatarImages.snapshot(input) : undefined), [input])
  const image = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (input && visible) runInBackground(avatarImages.ensure(input), 'Avatar preparation failed')
  }, [input, visible])
  if (!input) return typeof path === 'string' ? path : undefined
  if (image?.status === 'ready') return image.value
  return image?.status === 'error' ? input.path : undefined
}

declare module './persistent-resources' {
  interface PersistentResources {
    avatarImages: ReturnType<typeof createAvatarImages>
  }
}
