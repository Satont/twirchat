import type { NativeRenderer, PublicInstance } from '@gpuix/react'
import { useEffect, useRef, type RefObject } from 'react'

import { useWindowScope } from './window-scope'

interface ComposerFocusEntry {
  paneKey: string
  paneIdentity: string
  callback: () => void | boolean
}
const runtime = globalThis
const windows = (runtime.__twirchatComposerFocus ??= new Map())
export function registerComposerFocus(
  paneKey: string,
  callback: () => void | boolean,
  scope = 'main',
  activityKey?: string,
): () => void {
  const entries = windows.get(scope) ?? new Map<string, ComposerFocusEntry>()
  const suffix =
    activityKey === undefined
      ? paneKey.lastIndexOf(':')
      : paneKey.endsWith(`:${activityKey}`)
        ? paneKey.length - activityKey.length - 1
        : -1
  const entry = { paneKey, paneIdentity: suffix < 0 ? '' : paneKey.slice(0, suffix), callback }
  entries.delete(paneKey)
  entries.set(paneKey, entry)
  windows.set(scope, entries)
  return () => {
    if (entries.get(paneKey) === entry) entries.delete(paneKey)
    if (!entries.size && windows.get(scope) === entries) windows.delete(scope)
  }
}
export function focusComposerForPane(tabId: string, panelId: string, scope = 'main'): boolean {
  const identity = `${tabId}:${panelId}`
  const entries = windows.get(scope)
  if (!entries) return false
  const entry = [...entries.values()]
    .reverse()
    .find((candidate) => candidate.paneIdentity === identity)
  if (!entry) return false
  return entry.callback() !== false
}
/** Focuses the exact composer key when the pane's activity is already known. */
export function focusComposerByKey(paneKey: string, scope = 'main'): boolean {
  const entry = windows.get(scope)?.get(paneKey)
  if (!entry) return false
  return entry.callback() !== false
}
export function cleanupWindowComposerFocus(scope: string): void {
  windows.delete(scope)
}
/** Registration only: composition, history and sending behavior stay in ChatInput. */
export function useComposerFocusRegistration(
  paneKey: string,
  renderer: NativeRenderer,
  input: RefObject<PublicInstance | null>,
  activityKey?: string,
): void {
  const scope = useWindowScope()
  const latest = useRef({ renderer, input })
  latest.current = { renderer, input }
  useEffect(
    () =>
      registerComposerFocus(
        paneKey,
        () => {
          const current = latest.current
          if (!current.input.current) return false
          current.renderer.focusElement?.(current.input.current.id)
          return true
        },
        scope,
        activityKey,
      ),
    [paneKey, scope, activityKey],
  )
}

declare global {
  var __twirchatComposerFocus: Map<string, Map<string, ComposerFocusEntry>> | undefined
}
