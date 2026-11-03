import type { NativeRenderer, PublicInstance } from '@gpuix/react'
import { useId, type RefObject } from 'react'

import type { HotkeyContext } from '../hotkey-bindings'
import type { NativeWindowControls } from '../native-window'
import { useHotkeyContext, useHotkeyRoute } from '../state/action-bindings'

type PopupAction =
  | 'reject'
  | 'accept'
  | 'delete'
  | 'search'
  | 'openProfilePictureMenu'
  | 'pin'
  | 'openTab'
  | 'scrollPage'
  | 'execModeratorAction'
export type PopupHotkeyHandlers = Partial<Pick<HotkeyContext['handlers'], PopupAction>>

/** A mounted popup owns its route even when a requested capability is unsupported. */
export function usePopupContextId(name: string): string {
  return `popup:${name}:${useId()}`
}

export function usePopupHotkeys(
  name: string,
  handlers: PopupHotkeyHandlers,
  enabled = true,
  contextId?: string,
): string {
  const generatedId = usePopupContextId(name)
  const id = contextId ?? generatedId
  useHotkeyContext({ id, category: 'popupWindow', handlers: enabled ? handlers : {} })
  useHotkeyRoute([id], enabled, 100)
  return id
}

type PopupSearchRenderer = Pick<NativeRenderer, 'focusElement'> &
  Pick<NativeWindowControls, 'runTextInputAction'>
type PopupElementRef = RefObject<Pick<PublicInstance, 'id'> | null>
interface PopupViewportRenderer {
  getListScrollTop?(id: number): readonly number[] | null
  getElementBounds?(id: number): { height: number } | null
  scrollToItem?(id: number, index: number, offset?: number): void
  getScrollOffset?(id: number): readonly number[] | null
  scrollTo?(id: number, x: number, y: number): void
}
export async function focusPopupSearch(
  renderer: PopupSearchRenderer,
  input: PopupElementRef,
): Promise<void> {
  if (!input.current) return
  renderer.focusElement?.(input.current.id)
  await renderer.runTextInputAction('selectAll')
}

export function popupPageTarget(
  anchor: readonly number[] | null,
  height: number | undefined,
  direction: string,
): [number, number] | null {
  if (
    !anchor ||
    !height ||
    height <= 0 ||
    !Number.isFinite(height) ||
    !['up', 'down'].includes(direction)
  )
    return null
  return [anchor[0] ?? 0, (anchor[1] ?? 0) + (direction === 'up' ? -height : height)]
}

export function scrollPopupPage(
  renderer: PopupViewportRenderer,
  viewport: PopupElementRef,
  direction: string,
): void {
  if (!viewport.current) return
  const id = viewport.current.id
  const anchor = renderer.getListScrollTop?.(id)
  const height = renderer.getElementBounds?.(id)?.height ?? anchor?.[2]
  const target = popupPageTarget(anchor ?? null, height, direction)
  if (target) renderer.scrollToItem?.(id, ...target)
  else if (height && ['up', 'down'].includes(direction)) {
    const offset = renderer.getScrollOffset?.(id)
    if (offset)
      renderer.scrollTo?.(
        id,
        offset[0] ?? 0,
        (offset[1] ?? 0) + (direction === 'up' ? height : -height),
      )
  }
}

export function popupTabIndex(current: number, target: string, count: number): number | null {
  if (!count) return null
  if (target === 'last') return count - 1
  if (target === 'next') return (current + 1) % count
  if (target === 'previous') return (current + count - 1) % count
  const index = /^(0|[1-9]\d*)$/u.test(target) ? Number(target) : NaN
  return Number.isSafeInteger(index) && index < count ? index : null
}
