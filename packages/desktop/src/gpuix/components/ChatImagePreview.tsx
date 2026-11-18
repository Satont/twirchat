import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { memo, useContext, useEffect, useMemo, useState } from 'react'

import type { ChatImagePreview as PreparedImage } from '../../services/chat-image-preview-cache'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../i18n'
import { claimMessageRowClick } from '../message-row-click'
import { buildMessageTokens } from '../message-tokens'
import { settingsStore } from '../state/app'
import { useStore } from '../state/create-store'
import { useDesktopWindows } from '../state/desktop-windows'
import { resolveTheme, ThemeContext, useTheme } from '../theme-context'
import { ActionButton } from './ui/Form'
import { ImageLoadingContext } from './ui/RemoteImage'

const MAX_LINKS_PER_MESSAGE = 2

export const ChatImagePreviews = memo(function ChatImagePreviews({
  message,
}: {
  message: NormalizedChatMessage
}) {
  const urls = useMemo(() => {
    const links = new Set<string>()
    for (const token of buildMessageTokens(message)) {
      if (token.kind === 'link') links.add(token.url)
      if (links.size === MAX_LINKS_PER_MESSAGE) break
    }
    return [...links]
  }, [message])
  return urls.map((url) => <ChatImageThumbnail key={url} url={url} messageId={message.id} />)
})

function ChatImageThumbnail({ url, messageId }: { url: string; messageId: string }) {
  const { api } = useBackend()
  const visible = useContext(ImageLoadingContext)
  const windows = useDesktopWindows()
  const theme = useTheme()
  const { t } = useT()
  const [image, setImage] = useState<Omit<PreparedImage, 'full'>>()

  useEffect(() => {
    if (!visible || !windows || image) return
    const request = new AbortController()
    api
      .getChatImagePreview(url, request.signal)
      .then((result) => {
        if (!request.signal.aborted && result) {
          const { thumbnail, width, height } = result
          setImage({ thumbnail, width, height })
        }
      })
      .catch(() => undefined)
    return () => request.abort()
  }, [api, image, url, visible, windows])

  if (!image || !windows) return null
  const label = t('chat.imagePreview.open')
  const open = () => {
    runUiTask(
      api.getChatImagePreview(url, AbortSignal.timeout(12_000)).then((result) => {
        if (!result) throw new Error(t('chat.imagePreview.unavailable'))
        return windows.openImage(result.full)
      }),
    )
  }
  return (
    <div
      testId={`chat-image-thumbnail-${messageId}`}
      role="button"
      aria-label={label}
      tabIndex={0}
      onClick={(event) => {
        if (
          claimMessageRowClick(event) &&
          !event.isRightClick &&
          event.button !== 2 &&
          (event.clickCount ?? 1) === 1
        )
          open()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'enter' && event.key !== 'space') return
        event.preventDefault()
        open()
      }}
      style={{
        display: 'flex',
        alignSelf: 'flex-start',
        width: image.width + 4,
        maxWidth: '100%',
        height: image.height + 4,
        marginTop: 4,
        padding: 1,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface,
        overflow: 'hidden',
        cursor: 'pointer',
        hover: { borderColor: theme.accent.primary },
        focusVisible: { outlineWidth: 1, outlineColor: theme.link, outlineOffset: -2 },
      }}
    >
      <img src={image.thumbnail} objectFit="contain" style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

export function ChatImageWindow({ src }: { src: string }) {
  const windows = useDesktopWindows()
  const theme = resolveTheme(useStore(settingsStore))
  const { t } = useT()
  const close = () => {
    if (windows) runUiTask(windows.close())
  }
  return (
    <ThemeContext.Provider value={theme}>
      <div
        testId="chat-image-viewer"
        tabIndex={0}
        autoFocus
        onKeyDown={(event) => {
          if (event.key !== 'escape') return
          event.preventDefault()
          close()
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: theme.bg,
          padding: 12,
          gap: 8,
        }}
      >
        <img src={src} objectFit="contain" style={{ width: '100%', flexGrow: 1, minHeight: 0 }} />
        <ActionButton onClick={close} style={{ alignSelf: 'flex-end' }}>
          {t('common.close')}
        </ActionButton>
      </div>
    </ThemeContext.Provider>
  )
}
