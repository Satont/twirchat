import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
/**
 * Emote hover tooltip — port of EmoteTooltip.vue onto the GPUIX Tooltip
 * primitive: 64px preview, name, "View on 7TV" link.
 */
import type { Emote } from '@twirchat/shared/types'
import { useEffect, type ReactNode } from 'react'

import { emoteProvider } from '../../../services/provider-emotes'
import { useBackend } from '../../backend/context'
import { runUiTask } from '../../hooks/run-ui-task'
import { useT } from '../../i18n'
import { showNotice } from '../../state/app'
import { useStoreSelector } from '../../state/create-store'
import {
  emotePreferencesStore,
  favoriteEntry,
  favoriteEmoteKey,
  loadEmotePreferences,
  toggleFavoriteEmote,
} from '../../state/emote-preferences'
import type { Theme } from '../../theme'
import { useFont } from '../../theme-context'
import { Icon } from './Icon'
import { RemoteImage } from './RemoteImage'

export function EmoteTooltip({
  emote,
  children,
  theme,
}: {
  emote: Emote
  children: ReactNode
  theme: Theme
}) {
  const backend = useBackend()
  const font = useFont()
  const { t } = useT()
  const entry = favoriteEntry(emote)
  const provider = emoteProvider(entry)
  const url =
    provider === 'seventv'
      ? `https://7tv.app/emotes/${encodeURIComponent(emote.id)}`
      : provider === 'bttv'
        ? `https://betterttv.com/emotes/${encodeURIComponent(emote.id)}`
        : provider === 'ffz'
          ? `https://www.frankerfacez.com/emoticon/${encodeURIComponent(emote.id)}-${encodeURIComponent(emote.name)}`
          : emote.imageUrl
  const label = provider === 'seventv' ? '7TV' : provider === 'bttv' ? 'BetterTTV' : 'FrankerFaceZ'
  const favorite = useStoreSelector(emotePreferencesStore, (state) =>
    state.value.favorites.some((item) => favoriteEmoteKey(item) === favoriteEmoteKey(entry)),
  )
  useEffect(() => {
    runUiTask(loadEmotePreferences(backend.api))
  }, [backend])

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        style={{
          backgroundColor: theme.popover,
          borderWidth: 1,
          borderColor: theme.dialogBorder,
          borderRadius: 10,
          padding: 12,
          minWidth: 140,
          boxShadow: {
            offsetX: 0,
            offsetY: 8,
            blurRadius: 32,
            spreadRadius: 0,
            color: '#00000080',
          },
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <div
            style={{
              width: 64,
              height: 64,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.fill,
              borderRadius: 8,
              flexShrink: 0,
            }}
          >
            <RemoteImage
              url={emote.imageUrl}
              objectFit="contain"
              style={{ width: 56, height: 56 }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <text style={{ fontSize: 13, fontWeight: 600, color: theme.text, fontFamily: font }}>
              {emote.name}
            </text>
            <div
              onClick={() => {
                if (/^https?:\/\//i.test(url)) runUiTask(backend.api.openExternalUrl({ url }))
              }}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
              }}
            >
              <Icon name="externalLink" size={12} color={theme.link} />
              <text style={{ fontSize: 12, color: theme.link, fontFamily: font }}>
                {provider === 'twitch'
                  ? t('misc.emote.openImage')
                  : t('misc.emote.viewOn', { provider: label })}
              </text>
            </div>
            <div
              tabIndex={0}
              onClick={() => {
                void toggleFavoriteEmote(backend.api, entry).catch((error: unknown) =>
                  showNotice('error', error instanceof Error ? error.message : String(error)),
                )
              }}
              onKeyDown={(event) => {
                if (event.key === 'enter' || event.key === 'space') {
                  event.preventDefault()
                  void toggleFavoriteEmote(backend.api, entry).catch((error: unknown) =>
                    showNotice('error', error instanceof Error ? error.message : String(error)),
                  )
                }
              }}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
                paddingTop: 4,
              }}
            >
              <Icon name="star" size={12} color={favorite ? theme.warningText : theme.link} />
              <text style={{ fontSize: 12, color: theme.link, fontFamily: font }}>
                {favorite ? t('misc.emote.removeFavorite') : t('misc.emote.addFavorite')}
              </text>
            </div>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
