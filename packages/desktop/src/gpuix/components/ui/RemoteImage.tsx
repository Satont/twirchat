/**
 * `<img>` for remote URLs — downloads via the local image cache first,
 * because GPUI's Linux build cannot load http(s) sources.
 * Renders an empty box of the declared size until the file is ready
 * (same contract as GPUI's loading state, minus the failure placeholder).
 */

import { useEffect } from 'react'

import { cachedImagePath, ensureImage, imageCacheRevisionStore } from '../../state/image-cache'
import { useStore } from '../../state/create-store'

export function RemoteImage({
  url,
  style,
  objectFit = 'contain',
}: {
  url: string | undefined
  style?: Record<string, unknown>
  objectFit?: 'fill' | 'contain' | 'cover' | 'scaleDown' | 'none'
}) {
  useStore(imageCacheRevisionStore)
  useEffect(() => ensureImage(url), [url])

  const localPath = cachedImagePath(url)
  if (!localPath) {
    return <div style={style} />
  }
  return <img src={localPath} objectFit={objectFit} style={style} />
}
