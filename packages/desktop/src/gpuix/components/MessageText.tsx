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
import { readableOn } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { EmoteTooltip } from './ui/EmoteTooltip'
import { RemoteImage } from './ui/RemoteImage'

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
}: {
  message: NormalizedChatMessage
  fontSize: number
  deleted?: boolean
  isAction?: boolean
  isSystem?: boolean
  /** `/me` messages render in the author's color (no italics in GPUIX). */
  actionColor?: string
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

  const baseColor = isSystem ? theme.text2 : (actionColor ?? theme.text)
  const textOpacity = deleted ? 0.5 : 1
  const emoteSize = Math.round(fontSize * (isSystem ? SYSTEM_EMOTE_SCALE : EMOTE_SCALE))
  const lineHeight = Math.round(fontSize * 1.45)

  return tokens.map((token, index) => {
    if (token.kind === 'emote') {
      const ratio =
        token.emote.aspectRatio && token.emote.aspectRatio > 0 ? token.emote.aspectRatio : 1
      const width = Math.min(Math.round(emoteSize * EMOTE_MAX_RATIO), Math.round(emoteSize * ratio))
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
        <text
          key={index}
          style={{
            color: token.color ? readableOn(token.color, theme.bg) : baseColor,
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
  actionColor?: string
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
