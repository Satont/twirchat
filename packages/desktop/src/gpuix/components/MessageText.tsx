/**
 * Renders a chat message's text as tokens (words / mentions / links / emotes).
 *
 * `MessageTokens` returns the bare element list so it can be inlined into an
 * existing wrapping flex row (compact layout), while `MessageText` wraps it
 * into its own flex-wrap container (modern layout). Replaces the Vue app's
 * v-html="processText(...)" inline rendering.
 */

import { memo, useMemo } from 'react'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { useBackend } from '../backend/context'
import { buildMessageTokens } from '../message-tokens'
import { useStore } from '../state/create-store'
import { mentionColorRevisionStore } from '../state/caches'
import { accent } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { EmoteTooltip } from './ui/EmoteTooltip'
import { RemoteImage } from './ui/RemoteImage'

const EMOTE_HEIGHT = 24
const EMOTE_MAX_WIDTH = 72
const SYSTEM_EMOTE_HEIGHT = 20

export const MessageTokens = memo(function MessageTokens({
  message,
  fontSize,
  deleted,
  isAction,
  isSystem,
}: {
  message: NormalizedChatMessage
  fontSize: number
  deleted?: boolean
  isAction?: boolean
  isSystem?: boolean
}) {
  const theme = useTheme()
  const font = useFont()
  const backend = useBackend()
  // Re-render when a mention color resolves for this message's mentions.
  useStore(mentionColorRevisionStore)

  const tokens = useMemo(
    () => buildMessageTokens(message),
    // Message objects are immutable in our buffers; identity is enough.
    [message],
  )

  const baseColor = isSystem ? theme.text2 : theme.text
  const textOpacity = deleted ? 0.5 : isAction ? 0.85 : 1
  const emoteSize = isSystem ? SYSTEM_EMOTE_HEIGHT : EMOTE_HEIGHT
  const lineHeight = Math.round(fontSize * 1.45)

  return tokens.map((token, index) => {
    if (token.kind === 'emote') {
      const ratio =
        token.emote.aspectRatio && token.emote.aspectRatio > 0 ? token.emote.aspectRatio : 1
      const width = Math.min(
        EMOTE_MAX_WIDTH * (emoteSize / EMOTE_HEIGHT),
        Math.round(emoteSize * ratio),
      )
      return (
        <EmoteTooltip key={index} emote={token.emote}>
          <RemoteImage
            url={token.emote.imageUrl}
            objectFit="contain"
            style={{
              width,
              height: emoteSize,
              flexShrink: 0,
              marginRight: 4,
              cursor: 'pointer',
              opacity: textOpacity,
            }}
          />
        </EmoteTooltip>
      )
    }
    if (token.kind === 'link') {
      return (
        <text
          key={index}
          onClick={() => void backend.api.openExternalUrl({ url: token.url })}
          style={{
            color: accent.primary,
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
        <text
          key={index}
          style={{
            color: token.color ?? baseColor,
            fontWeight: token.color ? 600 : 400,
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
