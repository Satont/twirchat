import type { NormalizedChatMessage } from '@twirchat/shared/types'

import type { CosmeticPaint, UserCosmetics } from '../../services/cosmetics'
import { usePaintImage, useUserCosmetics } from '../hooks/use-cosmetics'
import { useT } from '../i18n'
import { useStoreSelector } from '../state/create-store'
import { emotePreferencesStore } from '../state/emote-preferences'
import { useFont } from '../theme-context'
import { BadgeTooltip } from './ui/BadgeTooltip'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'

export function useAuthorCosmetics(message: NormalizedChatMessage, visible = true) {
  const preferences = useStoreSelector(emotePreferencesStore, (state) => state.value)
  const configured =
    preferences.badges ||
    preferences.paints ||
    (preferences.personal && preferences.enabled.seventv)
  return useUserCosmetics(
    message.platform,
    message.author.id,
    message.author.username,
    visible && configured && message.type !== 'system',
    preferences,
  )
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
  const { t } = useT()
  const enabled = useStoreSelector(emotePreferencesStore, (state) => state.value.paints)
  const image = usePaintImage(name, enabled ? paint : undefined, fontSize, font)
  return (
    <div
      role="button"
      aria-label={t('misc.userCard.openFor', { name })}
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
      {image ? (
        <img alt={name} src={image.path} style={{ width: image.width, height: image.height }} />
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
  marginRight,
}: {
  badges: UserCosmetics['badges']
  size: number
  marginRight?: number
}) {
  const enabled = useStoreSelector(emotePreferencesStore, (state) => state.value.badges)
  if (!enabled || !badges.some((badge) => badge.imageUrl)) return null
  return (
    <div
      style={{ display: 'flex', flexDirection: 'row', gap: 3, alignItems: 'center', marginRight }}
    >
      {badges.map((badge) =>
        badge.imageUrl ? (
          <BadgeTooltip key={badge.id} badge={badge}>
            <RemoteImage
              url={badge.imageUrl}
              thumbnailSize={badge.type === 'twir' ? size : undefined}
              style={{ width: size, height: size, flexShrink: 0, pointerEvents: 'none' }}
            />
          </BadgeTooltip>
        ) : null,
      )}
    </div>
  )
}
