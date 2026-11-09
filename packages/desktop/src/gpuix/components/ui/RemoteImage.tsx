/**
 * `<img>` for remote URLs — downloads via the local image cache first,
 * because GPUI's Linux build cannot load http(s) sources.
 * Renders an empty box of the declared size until the file is ready
 * (same contract as GPUI's loading state); `fallback` replaces the box once
 * the download has failed.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { ensureImage, imageSnapshot, subscribeImage } from '../../state/image-cache'
import { useImageThumbnail } from '../../state/image-thumbnails'
export const ImageLoadingContext = createContext(true)

export function RemoteImage({
  url,
  style,
  objectFit = 'contain',
  fallback,
  thumbnailSize,
}: {
  url: string | undefined
  style?: Record<string, unknown>
  objectFit?: 'fill' | 'contain' | 'cover' | 'scaleDown' | 'none'
  fallback?: ReactNode
  thumbnailSize?: number
}) {
  const visible = useContext(ImageLoadingContext)
  const subscribe = useCallback(
    (listener: () => void) => (visible ? subscribeImage(url, listener) : () => {}),
    [url, visible],
  )
  const snapshot = useCallback(() => imageSnapshot(url), [url])
  const localPath = useSyncExternalStore(subscribe, snapshot, snapshot)
  const preparedPath = useImageThumbnail(
    localPath,
    thumbnailSize,
    objectFit === 'cover' ? 'cover' : 'inside',
    visible,
  )
  useEffect(() => {
    if (visible) ensureImage(url)
  }, [url, visible])

  if (!preparedPath) {
    if (fallback !== undefined && localPath === null) return fallback
    return <div style={style} />
  }
  return <img src={preparedPath} objectFit={objectFit} style={style} />
}
