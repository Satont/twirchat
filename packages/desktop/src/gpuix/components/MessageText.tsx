import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
/**
 * Renders a chat message's text as tokens (words / mentions / links / emotes).
 *
 * `MessageTokens` returns the bare element list so it can be inlined into an
 * existing wrapping flex row (compact layout), while `MessageText` wraps it
 * into its own flex-wrap container (modern layout). Replaces the Vue app's
 * v-html="processText(...)" inline rendering.
 */
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { memo, useEffect, useMemo, useContext } from 'react'

import { authorEmoteCatalog, enrichProviderEmotes } from '../../services/provider-emotes'
import type { UserCardTarget } from '../../views/main/utils/chatCommands'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { buildMessageTokens } from '../message-tokens'
import { accountsStore, authorEmoteStore, emoteStore } from '../state/app'
import { ensureMentionColors, mentionColor, mentionColorRevisionStore } from '../state/caches'
import { chatPauseStore } from '../state/chat-pause'
import { useStoreSelector } from '../state/create-store'
import { emotePreferencesStore } from '../state/emote-preferences'
import { useFont, useTheme } from '../theme-context'
import { MessageMention } from './MessageMention'
import { EmoteArtwork } from './ui/EmoteArtwork'
import { EmoteTooltip } from './ui/EmoteTooltip'
import { ImageLoadingContext } from './ui/RemoteImage'

const EMPTY_CATALOG: EmoteCatalogEntry[] = []

// Emote height scales with the chat font (2x = 28px at the 14px default —
// Twitch's native 1x size, so emote rows stay close to text rows). Wide
// emotes cap at 3x their height.
const EMOTE_SCALE = 2
const SYSTEM_EMOTE_SCALE = 1.5
const EMOTE_MAX_RATIO = 3

export const MessageTokens = memo(function MessageTokens({
  message,
  fontSize,
  deleted,
  isSystem,
  actionColor,
  channelSlug,
  onOpenUserCard,
}: {
  message: NormalizedChatMessage
  fontSize: number
  deleted?: boolean
  isAction?: boolean
  isSystem?: boolean
  /** `/me` messages render in the author's color (no italics in GPUIX). */
  actionColor?: string
  channelSlug?: string
  onOpenUserCard?: (target: UserCardTarget) => void
}) {
  const theme = useTheme()
  const font = useFont()
  const backend = useBackend()
  const visible = useContext(ImageLoadingContext)
  const doubleClickLinks = useStoreSelector(chatPauseStore, (state) => state.value.doubleClickLinks)
  // Re-render when a mention color resolves for this message's mentions.
  const mentions = useMemo(() => message.text.match(/@[a-zA-Z0-9_]+/g) ?? [], [message])
  useStoreSelector(mentionColorRevisionStore, () =>
    mentions.map((mention) => mentionColor(message.platform, mention.slice(1)) ?? '').join('|'),
  )
  useEffect(() => {
    if (visible) ensureMentionColors(message.platform, message.text)
  }, [message, visible])

  const catalog = useStoreSelector(
    emoteStore,
    (state) => state.get(`${message.platform}:${message.channelId}`) ?? EMPTY_CATALOG,
  )
  const renderPreferences = useStoreSelector(emotePreferencesStore, (state) => state.value)
  const ownUserId = useStoreSelector(
    accountsStore,
    (accounts) => accounts.find((account) => account.platform === message.platform)?.platformUserId,
  )
  const personal = useStoreSelector(
    authorEmoteStore,
    (catalogs) => catalogs.get(`${message.platform}:${message.author.id}`) ?? EMPTY_CATALOG,
  )
  const authorCatalog = useMemo(
    () => authorEmoteCatalog(catalog, personal, message.author.id === ownUserId),
    [personal, catalog, ownUserId, message.author.id],
  )
  const tokens = useMemo(
    () => {
      const preferences = renderPreferences
      return buildMessageTokens(enrichProviderEmotes(message, authorCatalog, preferences), {
        zeroWidth: preferences.zeroWidth,
        modifiers: preferences.modifiers,
      })
    },
    // Message objects are immutable in our buffers; identity is enough.
    [message, authorCatalog, renderPreferences],
  )

  const baseColor = isSystem ? theme.text2 : (actionColor ?? theme.text)
  const textOpacity = deleted ? 0.5 : 1
  const emoteSize = Math.round(fontSize * (isSystem ? SYSTEM_EMOTE_SCALE : EMOTE_SCALE))
  const lineHeight = Math.round(fontSize * 1.45)

  return tokens.map((token, index) => {
    if (token.kind === 'emote') {
      const ratio =
        token.emote.aspectRatio && token.emote.aspectRatio > 0 ? token.emote.aspectRatio : 1
      const wide = token.modifiers?.includes('wide') ? 4 : 1
      const width =
        Math.min(Math.round(emoteSize * EMOTE_MAX_RATIO), Math.round(emoteSize * ratio)) * wide
      const fallback = (
        <text
          style={{
            color: theme.text2,
            fontSize,
            fontFamily: font,
            lineHeight,
            opacity: textOpacity,
          }}
        >
          {token.emote.name}
        </text>
      )
      return (
        <EmoteTooltip key={index} emote={token.emote}>
          <div
            style={{
              position: 'relative',
              width,
              height: emoteSize,
              flexShrink: 0,
              marginRight: token.modifiers?.includes('zero-space') ? 0 : 4,
              cursor: 'pointer',
            }}
          >
            <EmoteArtwork
              url={token.emote.imageUrl}
              width={width}
              height={emoteSize}
              modifiers={token.modifiers}
              opacity={textOpacity}
              fallback={fallback}
            />
            {token.overlays?.map((overlay, overlayIndex) => {
              const overlayWidth = Math.min(
                emoteSize * EMOTE_MAX_RATIO,
                Math.round(emoteSize * (overlay.aspectRatio ?? 1)),
              )
              return (
                <div
                  key={`${overlay.provider}:${overlay.id}:${overlayIndex}`}
                  style={{
                    position: 'absolute',
                    left: (width - overlayWidth) / 2,
                    bottom: 0,
                    width: overlayWidth,
                    height: emoteSize,
                    pointerEvents: 'none',
                  }}
                >
                  <EmoteArtwork
                    url={overlay.imageUrl}
                    width={overlayWidth}
                    height={emoteSize}
                    opacity={textOpacity}
                  />
                </div>
              )
            })}
          </div>
        </EmoteTooltip>
      )
    }
    if (token.kind === 'link') {
      return (
        <text
          key={index}
          tabIndex={0}
          onClick={(event) => {
            if (
              event.button === 2 ||
              event.isRightClick ||
              (doubleClickLinks && event.button !== 1 && (event.clickCount ?? 1) < 2)
            )
              return
            runUiTask(backend.api.openExternalUrl({ url: token.url }))
          }}
          onKeyDown={(event) => {
            if (event.key === 'enter') {
              event.preventDefault()
              runUiTask(backend.api.openExternalUrl({ url: token.url }))
            }
          }}
          style={{
            color: theme.link,
            fontSize,
            fontFamily: font,
            cursor: 'pointer',
            lineHeight,
            opacity: textOpacity,
          }}
        >
          {token.text}
        </text>
      )
    }
    if (token.kind === 'mention') {
      return (
        <MessageMention
          key={index}
          token={token}
          message={message}
          channelSlug={channelSlug}
          onOpenUserCard={onOpenUserCard}
          fontSize={fontSize}
          baseColor={baseColor}
          opacity={textOpacity}
        />
      )
    }
    return (
      <text
        key={index}
        style={{
          color: baseColor,
          fontSize,
          fontFamily: font,
          lineHeight,
          opacity: textOpacity,
        }}
      >
        {token.text}
      </text>
    )
  })
})

export const MessageText = memo(function MessageText(props: {
  message: NormalizedChatMessage
  fontSize: number
  deleted?: boolean
  isAction?: boolean
  isSystem?: boolean
  actionColor?: string
  channelSlug?: string
  onOpenUserCard?: (target: UserCardTarget) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 0,
        rowGap: 2,
        minWidth: 0,
      }}
    >
      <MessageTokens {...props} />
    </div>
  )
})
