import {
  createRendererState,
  registerEventHandler,
  unregisterEventHandler,
  type NativeRenderer,
} from '@gpuix/native/host'
import { z } from 'zod'

const scaleFactorSchema = z.number().finite().positive()
const WINDOW_SCALE_ELEMENT = 0
const WINDOW_SCALE_EVENT = 'windowScaleChange'

/** This native getter reads a cached value without requesting layout. */
export function readWindowScale(renderer: NativeRenderer): number {
  const getter: unknown = Reflect.get(renderer, 'getWindowScaleFactor')
  if (typeof getter !== 'function')
    throw new Error(
      'The loaded GPUIX runtime does not report window scale. Rebuild the native runtime.',
    )
  const value: unknown = Reflect.apply(getter, renderer, [])
  return scaleFactorSchema.parse(value)
}

export function observeWindowScale(
  renderer: NativeRenderer,
  listener: (scale: number) => void,
): () => void {
  const root = createRendererState(renderer).current()
  if (!root) throw new Error('Window scale observation requires a mounted GPUIX root.')
  let active = true
  const changed = () => {
    if (active) listener(readWindowScale(renderer))
  }
  registerEventHandler(root.eventHandlers, WINDOW_SCALE_ELEMENT, WINDOW_SCALE_EVENT, changed)
  // Capture a monitor change between the provider's initial read and subscription.
  changed()
  return () => {
    active = false
    if (root.eventHandlers.get(WINDOW_SCALE_ELEMENT)?.get(WINDOW_SCALE_EVENT) === changed)
      unregisterEventHandler(root.eventHandlers, WINDOW_SCALE_ELEMENT, WINDOW_SCALE_EVENT)
  }
}
