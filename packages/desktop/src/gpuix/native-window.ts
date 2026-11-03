import type { NativeRenderer, WindowOptions } from '@gpuix/react'

import type { WindowVisibility } from './state/window-visibility'

export interface NativeWindowBounds {
  x: number
  y: number
  width: number
  height: number
  mode: 'windowed' | 'maximized' | 'fullscreen'
}
export type NativePaintedElementBounds = Pick<NativeWindowBounds, 'x' | 'y' | 'width' | 'height'>

export type NativeTextAction =
  | 'undo'
  | 'redo'
  | 'selectAll'
  | 'selectWord'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'cursorToStart'
  | 'cursorToEnd'
  | 'selectToStart'
  | 'selectToEnd'
export interface NativeWindowControls {
  getTwirNativeApiVersion(): number
  closeWindow(): void
  isWindowOpen(): boolean
  isWindowActive(): boolean
  getWindowVisibility(): WindowVisibility
  configureTray(enabled: boolean, notifications: boolean): Promise<void>
  notifyFromTray(title: string, body: string): Promise<boolean>
  takeTrayEvents(): string[]
  setHotkeyPlan(json: string): void
  getPaintedElementBounds(elementId: number): NativePaintedElementBounds | null
  getWindowBounds(): NativeWindowBounds | null
  getWindowCapabilities(): { position: boolean; clickThrough: boolean }
  setWindowBounds(bounds: Partial<NativeWindowBounds>): Promise<void>
  setClickThrough(enabled: boolean): Promise<void>
  runTextInputAction(action: NativeTextAction): Promise<boolean>
}
export type NativeWindowOptions = WindowOptions & {
  x?: number
  y?: number
  kind?: 'normal' | 'floating' | 'popup'
}
const nativeControlMethods: (keyof NativeWindowControls)[] = [
  'getTwirNativeApiVersion',
  'closeWindow',
  'isWindowOpen',
  'isWindowActive',
  'getWindowVisibility',
  'configureTray',
  'notifyFromTray',
  'takeTrayEvents',
  'setHotkeyPlan',
  'getPaintedElementBounds',
  'getWindowBounds',
  'getWindowCapabilities',
  'setWindowBounds',
  'setClickThrough',
  'runTextInputAction',
]

export function hasNativeControls(renderer: object): renderer is NativeWindowControls {
  if (!nativeControlMethods.every((name) => typeof Reflect.get(renderer, name) === 'function'))
    return false
  const version: unknown = Reflect.get(renderer, 'getTwirNativeApiVersion')
  return typeof version === 'function' && Reflect.apply(version, renderer, []) === 3
}

export function nativeWindow<T extends NativeRenderer>(renderer: T): T & NativeWindowControls {
  if (!hasNativeControls(renderer))
    throw new Error(
      'The loaded GPUIX runtime does not support TwirChat windows. Rebuild the native runtime.',
    )
  return renderer
}
