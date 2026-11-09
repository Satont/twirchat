import type { Platform } from '@twirchat/shared/types'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import type { CosmeticPaint, UserCosmeticPreferences } from '../../services/cosmetics'
import { namePaintCache, userCosmeticsCache } from '../state/cosmetics'
import { runUiTask } from './run-ui-task'

export function useUserCosmetics(
  platform: Platform,
  platformUserId: string | undefined,
  username: string | undefined,
  enabled: boolean,
  preferences?: UserCosmeticPreferences,
) {
  const input = useMemo(
    () => (enabled && platformUserId ? { platform, platformUserId, username, preferences } : null),
    [enabled, platform, platformUserId, username, preferences],
  )
  const subscribe = useCallback(
    (listener: () => void) => (input ? userCosmeticsCache.subscribe(input, listener) : () => {}),
    [input],
  )
  const snapshot = useCallback(
    () => (input ? userCosmeticsCache.snapshot(input) : undefined),
    [input],
  )
  const result = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (input) runUiTask(userCosmeticsCache.ensure(input))
  }, [input])
  return result?.status === 'ready' ? result.value : null
}

export function usePaintImage(
  name: string,
  paint: CosmeticPaint | undefined,
  fontSize: number,
  fontFamily: string | undefined,
) {
  const input = useMemo(
    () => (paint ? { name, paint, fontSize, fontFamily } : null),
    [name, paint, fontSize, fontFamily],
  )
  const subscribe = useCallback(
    (listener: () => void) => (input ? namePaintCache.subscribe(input, listener) : () => {}),
    [input],
  )
  const snapshot = useCallback(() => (input ? namePaintCache.snapshot(input) : undefined), [input])
  const result = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (input) runUiTask(namePaintCache.ensure(input))
  }, [input])
  return result?.status === 'ready' ? result.value : undefined
}
