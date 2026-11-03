import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import type { CosmeticPaint, UserCosmetics } from '../../services/cosmetics'
import { runUiTask } from '../hooks/run-ui-task'
import { namePaintCache, userCosmeticsCache } from '../state/cosmetics'
import { useStoreSelector } from '../state/create-store'
import { emotePreferencesStore } from '../state/emote-preferences'
import { useFont } from '../theme-context'
import { BadgeTooltip } from './ui/BadgeTooltip'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'

export function useAuthorCosmetics(message: NormalizedChatMessage, visible = true) {
  const configured = useStoreSelector(
    emotePreferencesStore,
    (state) =>
      state.value.badges ||
      state.value.paints ||
      (state.value.personal && state.value.enabled.seventv),
  )
  const enabled = visible && configured && !!message.author.id && message.type !== 'system'
  const input = useMemo(
    () => ({
      platform: message.platform,
      platformUserId: message.author.id,
      username: message.author.username,
    }),
    [message.platform, message.author.id, message.author.username],
  )
  const subscribe = useCallback(
    (listener: () => void) => (enabled ? userCosmeticsCache.subscribe(input, listener) : () => {}),
    [enabled, input],
  )
  const snapshot = useCallback(
    () => (enabled ? userCosmeticsCache.snapshot(input) : undefined),
    [enabled, input],
  )
  const result = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (enabled && input.platformUserId && message.type !== 'system')
      runUiTask(userCosmeticsCache.ensure(input))
  }, [enabled, input, message.type])
  return result?.status === 'ready' ? result.value : null
}

export function CosmeticAuthorName({
  name,
  paint,
  fontSize,
  color,
  onClick,
}: {
  name: string
  paint?: CosmeticPaint
  fontSize: number
  color: string
  onClick: () => void
}) {
  const font = useFont()
  const enabled = useStoreSelector(emotePreferencesStore, (state) => state.value.paints)
  const input = useMemo(
    () => (paint && enabled ? { name, paint, fontSize, fontFamily: font } : null),
    [name, paint, fontSize, font, enabled],
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
  return (
    <div
      role="button"
      aria-label={`Open ${name}'s user card`}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          onClick()
        }
      }}
      style={{ display: 'flex', cursor: 'pointer', flexShrink: 0 }}
    >
      {result?.status === 'ready' ? (
        <img
          alt={name}
          src={result.value.path}
          style={{ width: result.value.width, height: result.value.height }}
        />
      ) : (
        <Text
          style={{
            fontSize,
            fontWeight: 700,
            color,
            cursor: 'pointer',
            fontFamily: font,
            lineHeight: Math.round(fontSize * 1.45),
          }}
        >
          {name}
        </Text>
      )}
    </div>
  )
}

export function CosmeticBadges({
  badges,
  size,
}: {
  badges: UserCosmetics['badges']
  size: number
}) {
  const enabled = useStoreSelector(emotePreferencesStore, (state) => state.value.badges)
  if (!enabled || !badges.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 3, alignItems: 'center' }}>
      {badges.map((badge) =>
        badge.imageUrl ? (
          <BadgeTooltip key={badge.id} badge={badge}>
            <RemoteImage
              url={badge.imageUrl}
              style={{ width: size, height: size, pointerEvents: 'none' }}
            />
          </BadgeTooltip>
        ) : null,
      )}
    </div>
  )
}
