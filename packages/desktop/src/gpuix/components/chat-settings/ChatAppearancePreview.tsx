/**
 * Compact sample chat inside the appearance popover. It is deliberately local
 * and static: every visual option in the popover (font size, layout, stripe,
 * platform icon, avatars, badges, timestamp) changes these rows immediately.
 */

import type { AppSettings, Platform } from '@twirchat/shared/types'
import { useMemo } from 'react'

import { initialsOf } from '../../../views/shared/utils/display-text'
import { useT, type MessageKey } from '../../i18n'
import { platformColor, readableOn } from '../../theme'
import { useFont, useTheme } from '../../theme-context'
import { PlatformIcon } from '../ui/Icon'
import { Text } from '../ui/Text'

interface PreviewBadge {
  text: string
}

interface PreviewAuthor {
  name: string
  color: string
}

interface PreviewMessage {
  id: string
  platform: Platform
  author: PreviewAuthor
  badges: readonly PreviewBadge[]
  time: string
  textKey: MessageKey
  highlighted?: boolean
}

interface PreviewToken {
  kind: 'text' | 'mention' | 'link'
  text: string
  offset: number
}

const PREVIEW_MESSAGES: readonly PreviewMessage[] = [
  {
    id: 'welcome',
    platform: 'twitch',
    author: { name: 'nightbot', color: '#7dd3fc' },
    badges: [{ text: 'MOD' }],
    time: '21:41:02',
    textKey: 'chat.preview.welcome',
  },
  {
    id: 'layout',
    platform: 'kick',
    author: { name: 'pixelpanda', color: '#53fc18' },
    badges: [{ text: 'SUB' }],
    time: '21:41:18',
    textKey: 'chat.preview.layout',
  },
  {
    id: 'mention',
    platform: 'youtube',
    author: { name: 'mod_maya', color: '#fca5a5' },
    badges: [{ text: 'MOD' }],
    time: '21:42:03',
    textKey: 'chat.preview.mention',
  },
  {
    id: 'self-ping',
    platform: 'twitch',
    author: { name: 'StreamerName', color: '#a78bfa' },
    badges: [],
    time: '21:42:11',
    textKey: 'chat.preview.selfPing',
    highlighted: true,
  },
  {
    id: 'guide',
    platform: 'kick',
    author: { name: 'pixelpanda', color: '#53fc18' },
    badges: [{ text: 'SUB' }],
    time: '21:42:24',
    textKey: 'chat.preview.guide',
  },
  {
    id: 'viewer',
    platform: 'twitch',
    author: { name: 'viewer42', color: '#fcd34d' },
    badges: [],
    time: '21:42:31',
    textKey: 'chat.preview.viewer',
  },
]

const TOKEN_PATTERN = /(@[a-zA-Z0-9_]+|https?:\/\/[^\s]+)/g

function tokenize(text: string): PreviewToken[] {
  const tokens: PreviewToken[] = []
  let cursor = 0
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index
    if (index === undefined) continue
    if (index > cursor) {
      tokens.push({ kind: 'text', text: text.slice(cursor, index), offset: cursor })
    }
    const value = match[0]
    const kind: PreviewToken['kind'] = value.startsWith('@') ? 'mention' : 'link'
    tokens.push({ kind, text: value, offset: index })
    cursor = index + value.length
  }
  if (cursor < text.length) {
    tokens.push({ kind: 'text', text: text.slice(cursor), offset: cursor })
  }
  return tokens
}

function badgeSize(fontSize: number): number {
  return Math.max(11, Math.round(fontSize * 1.15))
}

function timestampSize(fontSize: number): number {
  return Math.max(9, Math.round(fontSize * 0.78))
}

function platformIconSize(fontSize: number): number {
  return Math.max(8, Math.round(fontSize * 0.85))
}

function modernAvatarSize(fontSize: number): number {
  return Math.max(14, Math.round(fontSize * 2))
}

function compactAvatarSize(fontSize: number): number {
  return Math.max(12, Math.round(fontSize * 1.3))
}

function PreviewAvatar({ author, size }: { author: PreviewAuthor; size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: author.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Text
        style={{
          fontSize: size >= 24 ? 10 : 7,
          fontWeight: 700,
          color: 'rgba(255, 255, 255, 0.9)',
        }}
      >
        {initialsOf(author.name)}
      </Text>
    </div>
  )
}

function PreviewBadges({
  badges,
  fontSize,
}: {
  badges: readonly PreviewBadge[]
  fontSize: number
}) {
  const theme = useTheme()
  const size = badgeSize(fontSize)
  if (badges.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {badges.map((badge) => (
        <div
          key={badge.text}
          style={{
            minHeight: size,
            paddingLeft: Math.round(size * 0.3),
            paddingRight: Math.round(size * 0.3),
            paddingTop: 1,
            backgroundColor: theme.fillHover,
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: size - 4, color: theme.text, lineHeight: size - 2 }}>
            {badge.text}
          </Text>
        </div>
      ))}
    </div>
  )
}

function PreviewTokens({ text, fontSize }: { text: string; fontSize: number }) {
  const theme = useTheme()
  const font = useFont()
  const tokens = useMemo(() => tokenize(text), [text])
  const lineHeight = Math.round(fontSize * 1.45)
  return (
    <>
      {tokens.map((token) => (
        <Text
          key={`${token.kind}:${token.offset}`}
          style={{
            color:
              token.kind === 'mention'
                ? theme.accent.primary
                : token.kind === 'link'
                  ? theme.link
                  : theme.text,
            fontSize,
            fontFamily: font,
            lineHeight,
          }}
        >
          {token.text}
        </Text>
      ))}
    </>
  )
}

function PreviewRow({ message, settings }: { message: PreviewMessage; settings: AppSettings }) {
  const theme = useTheme()
  const { t } = useT()
  const text = t(message.textKey)
  const fontSize = settings.fontSize
  const authorColor = readableOn(message.author.color, theme.bg)
  const showStripe = settings.showPlatformColorStripe
  const highlighted = message.highlighted === true && settings.selfPing?.enabled === true
  const rowBackground = highlighted ? settings.selfPing?.color : undefined

  const stripe = showStripe ? (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 2,
        opacity: 0.55,
        backgroundColor: platformColor(message.platform),
      }}
    />
  ) : null

  if (settings.chatTheme === 'compact') {
    const tsSize = timestampSize(fontSize)
    return (
      <div
        testId={`appearance-preview-message-${message.id}`}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          rowGap: 1,
          paddingTop: 3,
          paddingBottom: 3,
          paddingLeft: 9,
          paddingRight: 9,
          backgroundColor: rowBackground,
          borderBottomWidth: 1,
          borderColor: theme.divider,
        }}
      >
        {stripe}
        {settings.showTimestamp ? (
          <Text
            style={{
              fontSize: tsSize,
              color: theme.text2,
              whiteSpace: 'nowrap',
              width: Math.ceil(tsSize * 4.6),
              textAlign: 'right',
              flexShrink: 0,
              marginRight: 5,
            }}
          >
            {message.time}
          </Text>
        ) : null}
        {settings.showAvatars ? (
          <div style={{ marginRight: 4, flexShrink: 0, display: 'flex' }}>
            <PreviewAvatar author={message.author} size={compactAvatarSize(fontSize)} />
          </div>
        ) : null}
        {settings.showPlatformIcon ? (
          <div style={{ marginRight: 4, flexShrink: 0, display: 'flex' }}>
            <PlatformIcon platform={message.platform} size={platformIconSize(fontSize)} />
          </div>
        ) : null}
        {settings.showBadges ? (
          <div style={{ marginRight: 4, flexShrink: 0, display: 'flex' }}>
            <PreviewBadges badges={message.badges} fontSize={fontSize} />
          </div>
        ) : null}
        <Text style={{ fontSize, fontWeight: 600, color: authorColor, flexShrink: 0 }}>
          {message.author.name}
        </Text>
        <Text style={{ fontSize, color: theme.text }}>: </Text>
        <PreviewTokens text={text} fontSize={fontSize} />
      </div>
    )
  }

  const leading = settings.showPlatformIcon || settings.showAvatars
  return (
    <div
      testId={`appearance-preview-message-${message.id}`}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        gap: 8,
        paddingTop: 5,
        paddingBottom: 5,
        paddingLeft: 10,
        paddingRight: 10,
        backgroundColor: rowBackground,
        borderBottomWidth: 1,
        borderColor: theme.divider,
      }}
    >
      {stripe}
      {leading ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 6,
            flexShrink: 0,
          }}
        >
          {settings.showPlatformIcon ? (
            <div style={{ marginTop: 5, display: 'flex', opacity: 0.85 }}>
              <PlatformIcon platform={message.platform} size={platformIconSize(fontSize)} />
            </div>
          ) : null}
          {settings.showAvatars ? (
            <div style={{ marginTop: 1 }}>
              <PreviewAvatar author={message.author} size={modernAvatarSize(fontSize)} />
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          flexGrow: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 4,
          }}
        >
          {settings.showBadges ? (
            <PreviewBadges badges={message.badges} fontSize={fontSize} />
          ) : null}
          <Text style={{ fontSize, fontWeight: 600, color: authorColor }}>
            {message.author.name}
          </Text>
          {settings.showTimestamp ? (
            <Text style={{ fontSize: timestampSize(fontSize), color: theme.text2 }}>
              {message.time}
            </Text>
          ) : null}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            rowGap: 1,
            minWidth: 0,
          }}
        >
          <PreviewTokens text={text} fontSize={fontSize} />
        </div>
      </div>
    </div>
  )
}

export function ChatAppearancePreview({
  settings,
  height = 160,
}: {
  settings: AppSettings
  height?: number
}) {
  const theme = useTheme()
  return (
    <div
      testId="appearance-chat-preview"
      style={{
        height,
        backgroundColor: theme.bg,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 10,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      {PREVIEW_MESSAGES.map((message) => (
        <PreviewRow key={message.id} message={message} settings={settings} />
      ))}
    </div>
  )
}
