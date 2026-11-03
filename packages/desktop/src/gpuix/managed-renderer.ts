import type { NativeWindowOptions } from './native-window'

/** Initialize the existing renderer without installing a global stdin automation listener. */
export function initializeManagedRenderer(renderer: object, options: NativeWindowOptions): void {
  // Pinned GPUIX 0.11 wraps own init when stdin is non-TTY. That wrapper installs
  // an automation listener with no disposer, retaining every closed renderer.
  // Native in-process automation APIs remain available through the same object.
  const prototype: unknown = Object.getPrototypeOf(renderer)
  if (typeof prototype !== 'object' || prototype === null)
    throw new Error('The native renderer prototype does not provide init().')
  const init: unknown = Reflect.get(prototype, 'init')
  if (typeof init !== 'function')
    throw new Error('The native renderer prototype does not provide init().')
  Reflect.apply(init, renderer, [options])
}
