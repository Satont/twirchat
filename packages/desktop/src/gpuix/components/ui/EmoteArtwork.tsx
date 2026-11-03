import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { getBackendUrl } from '../../../runtime-config'
import { modifiedEmoteImage } from '../../../services/emote-image'
import { inlineEmoteImageSource } from '../../../services/emote-image-source'
import { ensureImage, imageSnapshot, subscribeImage } from '../../state/image-cache'
import { useWindowScale } from '../../state/window-scale'
import { ImageLoadingContext, RemoteImage } from './RemoteImage'

/** Transform animations once; GPUI plays the cached WebP without row timers. */
export function EmoteArtwork({
  url,
  width,
  height,
  modifiers = [],
  opacity = 1,
  fallback,
}: {
  url: string
  width: number
  height: number
  modifiers?: string[]
  opacity?: number
  fallback?: ReactNode
}) {
  const visible = useContext(ImageLoadingContext)
  const scale = useWindowScale()
  const backendUrl = getBackendUrl()
  const source = useMemo(
    () => inlineEmoteImageSource(url, { height, scale, backendUrl }),
    [url, height, scale, backendUrl],
  )
  const subscribe = useCallback(
    (listener: () => void) => (visible ? subscribeImage(source, listener) : () => {}),
    [source, visible],
  )
  const snapshot = useCallback(() => imageSnapshot(source), [source])
  const local = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [modified, setModified] = useState<{ key: string; path: string } | null>(null)
  const modifierKey = modifiers.join(',')
  const transform = modifiers.some((modifier) =>
    [
      'flip-horizontal',
      'flip-vertical',
      'rotate-left',
      'rotate-right',
      'cursed',
      'party',
      'shake',
    ].includes(modifier),
  )
  useEffect(() => {
    if (visible) ensureImage(source)
  }, [source, visible])
  const key = `${source}:${modifierKey}:${width}:${height}:${scale}`
  useEffect(() => {
    if (!visible || !transform || !local) return
    let active = true
    void modifiedEmoteImage(local, width, height, modifierKey ? modifierKey.split(',') : [])
      .then((path) => {
        if (active) setModified({ key, path })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [local, width, height, modifierKey, key, transform, visible])
  const style = { width, height, opacity, flexShrink: 0 }
  const image =
    modified?.key === key ? (
      <img src={modified.path} objectFit="fill" style={style} />
    ) : (
      <RemoteImage
        url={source}
        objectFit={modifiers.includes('wide') ? 'fill' : 'contain'}
        style={style}
        fallback={fallback}
      />
    )
  return image
}
