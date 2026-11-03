import { z } from 'zod'

import { useStoreSelector } from './create-store'
import { persistentResource } from './persistent-resources'
import type { PreferenceStore } from './preferences'
import { createPreferenceStore, type PreferenceApi } from './preferences'
import { useWindowScope } from './window-scope'

export interface WindowPresentation {
  zoom: number
  tabVisibility: 'on' | 'off' | 'liveOnly'
}
const DEFAULT_PRESENTATION: WindowPresentation = { zoom: 1, tabVisibility: 'on' }
export const windowPresentationPreferences = persistentResource(
  'preference:window_presentation_v1',
  () =>
    createPreferenceStore<Record<string, WindowPresentation>>(
      'window_presentation_v1',
      {},
      (value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Invalid window appearance.')
        const entries = Object.entries(
          z
            .record(
              z.string(),
              z.object({ zoom: z.number(), tabVisibility: z.enum(['on', 'off', 'liveOnly']) }),
            )
            .parse(value),
        )
        if (entries.length > 256) throw new Error('Too many saved window appearances.')
        const result: Record<string, WindowPresentation> = {}
        for (const [id, raw] of entries) {
          const item = raw
          if (
            !id ||
            id.length > 128 ||
            ['__proto__', 'constructor', 'prototype'].includes(id) ||
            !item ||
            !Number.isFinite(item.zoom) ||
            item.zoom < 0.5 ||
            item.zoom > 3 ||
            !['on', 'off', 'liveOnly'].includes(item.tabVisibility)
          )
            throw new Error('Invalid window appearance.')
          result[id] = { zoom: item.zoom, tabVisibility: item.tabVisibility }
        }
        return result
      },
    ),
)
export function useWindowPresentation(): WindowPresentation {
  const scope = useWindowScope()
  return useStoreSelector(
    windowPresentationPreferences.store,
    (state) => state.value[scope] ?? DEFAULT_PRESENTATION,
  )
}
export async function changeWindowPresentation(
  api: PreferenceApi,
  scope: string,
  action: 'zoom' | 'tabs',
  argument?: string,
): Promise<void> {
  await windowPresentationPreferences.load(api)
  const entries = windowPresentationPreferences.store.get().value
  const previous = entries[scope] ?? DEFAULT_PRESENTATION
  const next = { ...previous }
  if (action === 'zoom')
    next.zoom =
      argument === 'reset'
        ? 1
        : Math.round(
            Math.max(0.5, Math.min(3, previous.zoom + (argument === 'in' ? 0.1 : -0.1))) * 10,
          ) / 10
  else
    next.tabVisibility =
      argument === 'liveOnly'
        ? 'liveOnly'
        : argument === 'on' || argument === 'off'
          ? argument
          : previous.tabVisibility === 'off'
            ? 'on'
            : 'off'
  const retained = Object.entries(entries)
    .filter(([id]) => id !== scope)
    .slice(-254)
  await windowPresentationPreferences.save(api, { ...Object.fromEntries(retained), [scope]: next })
}

declare module './persistent-resources' {
  interface PersistentResources {
    'preference:window_presentation_v1': PreferenceStore<Record<string, WindowPresentation>>
  }
}
