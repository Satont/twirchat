import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
import type { Account, WatchedChannel } from '@twirchat/shared/types'
import { memo, useEffect, useMemo, useState } from 'react'

import { resolveTwirTargets, type TwirChannelTarget } from '../../services/twir-channels'
import type { TwirNowPlaying } from '../../services/twir-now-playing'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../i18n'
import { useDesktopWindows } from '../state/desktop-windows'
import { useTheme } from '../theme-context'
import { Icon } from './ui/Icon'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'

const REFRESH_MS = 30_000
const ARTWORK_SIZE = 24
const trackText = {
  flexShrink: 1,
  minWidth: 0,
  fontSize: 12,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

interface PlayingTrack {
  targets: readonly TwirChannelTarget[]
  track: TwirNowPlaying
}

export const ChatTwirNowPlaying = memo(function ChatTwirNowPlaying({
  accounts,
  watchedChannel,
  watchedChannelId,
}: {
  accounts: readonly Account[]
  watchedChannel?: WatchedChannel | null
  watchedChannelId?: string
}) {
  const { api } = useBackend()
  const windows = useDesktopWindows()
  const { t } = useT()
  const theme = useTheme()
  const targets = useMemo(
    () => resolveTwirTargets({ accounts, watchedChannel, watchedChannelId }),
    [accounts, watchedChannel, watchedChannelId],
  )
  const [playing, setPlaying] = useState<PlayingTrack | null>(null)
  useEffect(() => {
    if (!targets.length) return undefined
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const publish = (track: TwirNowPlaying | null) => {
      if (disposed) return
      setPlaying((previous) => {
        if (!track) return null
        if (
          previous?.targets === targets &&
          previous.track.title === track.title &&
          previous.track.artist === track.artist &&
          previous.track.imageUrl === track.imageUrl
        )
          return previous
        return { targets, track }
      })
      timer = setTimeout(refresh, REFRESH_MS)
    }
    const refresh = () => {
      api.getTwirNowPlaying(targets).then(publish, () => publish(null))
    }
    refresh()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [api, targets])

  if (playing?.targets !== targets) return null
  const { title, artist, imageUrl } = playing.track
  const label = t('chat.banner.nowPlaying', { track: artist ? `${title} · ${artist}` : title })
  const openArtwork =
    imageUrl && windows
      ? () => {
          runUiTask(
            api.getChatImagePreview(imageUrl, AbortSignal.timeout(12_000)).then((result) => {
              if (!result) throw new Error(t('chat.imagePreview.unavailable'))
              return windows.openImage(result.full)
            }),
          )
        }
      : undefined

  return (
    <Tooltip delayDuration={250} style={{ width: '100%', flexShrink: 0 }}>
      <TooltipTrigger asChild>
        <div
          testId="chat-twir-now-playing"
          role="group"
          aria-label={label}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingTop: 5,
            paddingBottom: 5,
            paddingLeft: 8,
            paddingRight: 8,
            width: '100%',
            minWidth: 0,
            overflow: 'hidden',
            backgroundColor: theme.surface,
            borderBottomWidth: 1,
            borderColor: theme.border,
          }}
        >
          <div
            testId="chat-twir-now-playing-artwork"
            role={openArtwork ? 'button' : undefined}
            aria-label={openArtwork ? t('chat.imagePreview.open') : undefined}
            tabIndex={openArtwork ? 0 : undefined}
            onClick={
              openArtwork &&
              ((event) => {
                if (event.isRightClick || (event.button !== undefined && event.button !== 0)) return
                if ((event.clickCount ?? 1) === 1) openArtwork()
              })
            }
            onKeyDown={
              openArtwork &&
              ((event) => {
                if (event.key !== 'enter' && event.key !== 'space') return
                event.preventDefault()
                openArtwork()
              })
            }
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: ARTWORK_SIZE,
              height: ARTWORK_SIZE,
              flexShrink: 0,
              borderRadius: 4,
              backgroundColor: theme.surface2,
              overflow: 'hidden',
              cursor: openArtwork ? 'pointer' : undefined,
              focusVisible: openArtwork
                ? { outlineWidth: 1, outlineColor: theme.link, outlineOffset: -2 }
                : undefined,
            }}
          >
            <Icon name="music" size={14} color={theme.text2} />
            {imageUrl ? (
              <RemoteImage
                url={imageUrl}
                thumbnailSize={ARTWORK_SIZE * 2}
                objectFit="cover"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: ARTWORK_SIZE,
                  height: ARTWORK_SIZE,
                }}
              />
            ) : null}
          </div>
          <Text style={{ ...trackText, color: theme.text, fontWeight: 600 }}>{title}</Text>
          {artist ? (
            <Text style={{ ...trackText, color: theme.text2, maxWidth: '44%' }}>
              {`· ${artist}`}
            </Text>
          ) : null}
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        style={{ maxWidth: 300, backgroundColor: theme.popover, padding: 7, borderRadius: 5 }}
      >
        <Text style={{ fontSize: 12, color: theme.text }}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  )
})
