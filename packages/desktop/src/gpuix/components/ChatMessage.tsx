/**
 * One chat message row — port of ChatMessage.vue with its three layouts
 * (modern / compact / system) plus hover actions, delivery states,
 * moderation outcomes and the self-ping highlight.
 *
 * GPUIX deltas: no italics (action messages use opacity only), no
 * strikethrough (tombstones dim instead), hover actions are JS-state driven
 * because parent `hover` styles do not reach children.
 */

import { memo, useEffect, useState } from 'react'
import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'

import { useBackend } from '../backend/context'
import { avatarRevisionStore, avatarUrlFor, ensureAvatar } from '../state/caches'
import { useStore } from '../state/create-store'
import type { ResolvedModerationOutcome } from '../state/app'
import { platformColor, semantic } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { resolveBadgeImage } from '../../views/main/utils/badge-image'
import type { UserCardTarget } from '../../views/main/utils/chatCommands'
import { PlatformIcon } from './ui/Icon'
import { icons } from '../icons'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'
import { MessageText, MessageTokens } from './MessageText'

const DEFAULT_FONT_SIZE = 14

function badgeSize(fontSize: number): number {
  return Math.max(12, Math.round(fontSize * 1.15))
}

function platformIconSize(fontSize: number): number {
  return Math.max(9, Math.round(fontSize * 0.85))
}

// Avatars scale with the chat font size (28/18px at the 14px default).
function modernAvatarSize(fontSize: number): number {
  return Math.max(14, Math.round(fontSize * 2))
}

function compactAvatarSize(fontSize: number): number {
  return Math.max(12, Math.round(fontSize * 1.3))
}

export function formatMessageTime(ts: Date): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

// ── Avatar (fallback circle with the image layered on top once decoded) ─────

export function Avatar({ message, size }: { message: NormalizedChatMessage; size: number }) {
  useStore(avatarRevisionStore)
  useEffect(() => ensureAvatar(message), [message])
  const url = avatarUrlFor(message)

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: message.author.color ?? '#444444',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontSize: size >= 24 ? 11 : 8,
            fontWeight: 700,
            color: 'rgba(255, 255, 255, 0.9)',
          }}
        >
          {message.author.displayName.slice(0, 1).toUpperCase()}
        </Text>
      </div>
      {url ? (
        <RemoteImage
          url={url}
          objectFit="cover"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size,
            height: size,
            borderRadius: size / 2,
          }}
        />
      ) : null}
    </div>
  )
}

// ── Badges ──────────────────────────────────────────────────────────────────

function badgeDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function Badge({ imageUrl, text, size }: { imageUrl?: string; text: string; size: number }) {
  const resolved = resolveBadgeImage(imageUrl)
  if (resolved?.startsWith('<svg')) {
    // Embedded Kick badge SVG: render full-colour through <img> (the <svg>
    // element is monochrome and would lose the brand colors).
    return (
      <img
        src={badgeDataUrl(resolved)}
        objectFit="contain"
        style={{ width: size, height: size, flexShrink: 0 }}
      />
    )
  }
  if (resolved) {
    // Square tight box: Vue uses width:auto so the box hugs the image. Twitch
    // badges are square; `contain` keeps wider images undistorted.
    return (
      <RemoteImage
        url={resolved}
        objectFit="contain"
        style={{ height: size, width: size, flexShrink: 0 }}
      />
    )
  }
  return (
    <div
      style={{
        minHeight: size,
        paddingLeft: Math.round(size * 0.35),
        paddingRight: Math.round(size * 0.35),
        paddingTop: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 3,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: size - 4, color: '#e2e2e8', lineHeight: size - 2 }}>{text}</Text>
    </div>
  )
}

export function BadgeList({
  badges,
  size,
}: {
  badges: NormalizedChatMessage['author']['badges']
  size: number
}) {
  if (badges.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {badges.map((badge) => (
        <Badge key={badge.id} imageUrl={badge.imageUrl} text={badge.text} size={size} />
      ))}
    </div>
  )
}

// ── Reply preview ───────────────────────────────────────────────────────────

function ReplyPreview({ message, fontSize }: { message: NormalizedChatMessage; fontSize: number }) {
  const theme = useTheme()
  const reply = message.reply
  if (!reply) return null
  const text =
    reply.parentMessageText.length > 80
      ? `${reply.parentMessageText.slice(0, 80)}…`
      : reply.parentMessageText
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        overflow: 'hidden',
      }}
    >
      <Text
        style={{ fontSize: Math.round(fontSize * 0.8 * 1.1), color: theme.text2, opacity: 0.7 }}
      >
        ↩
      </Text>
      <Text
        style={{
          fontSize: Math.round(fontSize * 0.8),
          color: theme.text,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        {reply.parentAuthor.displayName}
      </Text>
      <Text
        style={{ fontSize: Math.round(fontSize * 0.8), color: theme.text2, whiteSpace: 'nowrap' }}
      >
        :
      </Text>
      <Text
        style={{
          fontSize: Math.round(fontSize * 0.8),
          color: theme.text2,
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          overflow: 'hidden',
          flexShrink: 1,
          minWidth: 0,
        }}
      >
        {text}
      </Text>
    </div>
  )
}

// ── Action buttons (reply / copy) ───────────────────────────────────────────
// Hover-reveal via COLOR toggling — the only pattern that survives GPUI's
// hit-test quirks (all verified with automation): buttons are always mounted
// and absolutely positioned (no mounts → no spurious-leave cascade), their
// own enter/leave works, and hidden buttons are painted fully transparent.
// A hidden button keeps its hitbox (positioned boxes always take hits), so it
// reveals on approach before any click lands; the trade-off is that the thin
// button strip is not text-selectable.

function ActionButton({
  visible,
  onHoverChange,
  onClick,
  testId,
  icon,
  color,
  bg,
}: {
  visible: boolean
  onHoverChange: (hovered: boolean) => void
  onClick: () => void
  testId: string
  icon: string
  color: string
  bg?: string
}) {
  return (
    <div
      testId={testId}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onClick={onClick}
      style={{
        borderRadius: 4,
        padding: 3,
        cursor: 'pointer',
        display: 'flex',
        backgroundColor: visible ? (bg ?? 'rgba(255, 255, 255, 0.1)') : 'transparent',
        hover: { backgroundColor: 'rgba(255, 255, 255, 0.15)' },
      }}
    >
      <svg
        source={icon}
        style={{
          width: 13,
          height: 13,
          flexShrink: 0,
          color: visible ? color : 'transparent',
        }}
      />
    </div>
  )
}

function HoverActions({
  rowHovered,
  onReply,
  onCopy,
  copySuccess,
}: {
  rowHovered: boolean
  onReply: () => void
  onCopy: () => void
  copySuccess: boolean
}) {
  const theme = useTheme()
  const [replyHover, setReplyHover] = useState(false)
  const [copyHover, setCopyHover] = useState(false)
  const visible = rowHovered || replyHover || copyHover

  return (
    <div
      style={{
        position: 'absolute',
        right: 8,
        top: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        userSelect: 'none',
      }}
    >
      <ActionButton
        visible={visible}
        onHoverChange={setReplyHover}
        onClick={onReply}
        testId="msg-reply"
        icon={icons.reply}
        color={theme.text2}
      />
      <ActionButton
        visible={visible}
        onHoverChange={setCopyHover}
        onClick={onCopy}
        testId="msg-copy"
        icon={copySuccess ? icons.check : icons.copy}
        color={copySuccess ? semantic.successSoft : theme.text2}
        bg={copySuccess ? 'rgba(74, 222, 128, 0.2)' : undefined}
      />
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export interface ChatMessageProps {
  message: NormalizedChatMessage
  channelSlug?: string
  showPlatformColorStripe?: boolean
  showPlatformIcon?: boolean
  showTimestamp?: boolean
  showAvatar?: boolean
  showBadges?: boolean
  fontSize?: number
  chatTheme?: 'modern' | 'compact'
  accounts?: Account[]
  selfPingEnabled?: boolean
  selfPingColor?: string
  alias?: string
  moderationOutcome?: ResolvedModerationOutcome
  /** Moderation drag rail, rendered over the row's left edge. */
  moderationRail?: import('react').ReactNode
  onOpenUserCard?: (target: UserCardTarget) => void
  onReply?: (message: NormalizedChatMessage) => void
}

export const ChatMessage = memo(function ChatMessage(props: ChatMessageProps) {
  const { message } = props
  const theme = useTheme()
  const font = useFont()
  const backend = useBackend()
  const [hovered, setHovered] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

  const fontSize = props.fontSize ?? DEFAULT_FONT_SIZE
  const isSystem = message.type === 'system'
  const isAction = message.type === 'action'
  const isTombstone = props.moderationOutcome?.isTombstone === true

  const isSelfPing = (() => {
    if (!props.selfPingEnabled || !props.accounts?.length) return false
    const myAccount = props.accounts.find((a) => a.platform === message.platform)
    if (!myAccount) return false
    const lower = message.text.toLowerCase()
    return (
      lower.includes(`@${myAccount.username.toLowerCase()}`) ||
      lower.includes(`@${myAccount.displayName.toLowerCase()}`)
    )
  })()

  const copyMessage = () => {
    void backend.api
      .copyText({ text: message.text })
      .then(() => {
        setCopySuccess(true)
        setTimeout(() => setCopySuccess(false), 1500)
      })
      .catch(() => undefined)
  }

  const openUserCard = () => {
    props.onOpenUserCard?.({
      platform: message.platform,
      platformUserId: message.author.id,
      messageId: message.id,
      channelId: message.channelId,
      channelSlug: props.channelSlug,
      displayName: message.author.displayName,
      username: message.author.username,
      avatarUrl: avatarUrlFor(message),
      currentAlias: props.alias,
    })
  }

  const authorColor = message.author.color ?? theme.text
  const authorName = props.alias ?? message.author.displayName

  // ── System message ────────────────────────────────────────────────────────
  if (isSystem) {
    const t = message.text
    const action = t.includes(' added ') ? 'added' : t.includes(' removed ') ? 'removed' : 'renamed'
    const palette =
      action === 'added'
        ? {
            border: '#4ade80',
            bg: 'rgba(74, 222, 128, 0.04)',
            iconBg: 'rgba(74, 222, 128, 0.15)',
            iconColor: '#4ade80',
            glyph: '+',
          }
        : action === 'removed'
          ? {
              border: '#ff5050',
              bg: 'rgba(255, 80, 80, 0.05)',
              iconBg: 'rgba(255, 80, 80, 0.18)',
              iconColor: '#ff6060',
              glyph: '−',
            }
          : {
              border: '#818cf8',
              bg: 'rgba(129, 140, 248, 0.06)',
              iconBg: 'rgba(129, 140, 248, 0.18)',
              iconColor: '#818cf8',
              glyph: '~',
            }

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingTop: 3,
          paddingBottom: 3,
          paddingLeft: 14,
          paddingRight: 14,
          borderLeftWidth: 2,
          borderColor: palette.border,
          backgroundColor: palette.bg,
          position: 'relative',
        }}
      >
        <div
          style={{
            width: 17,
            height: 17,
            borderRadius: 9,
            backgroundColor: palette.iconBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            userSelect: 'none',
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: 800, color: palette.iconColor, lineHeight: 12 }}>
            {palette.glyph}
          </Text>
        </div>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <MessageText message={message} fontSize={Math.round(fontSize * 0.88)} isSystem />
        </div>
        {props.showTimestamp ? (
          <Text style={{ fontSize: 10, color: theme.text2, opacity: 0.7, flexShrink: 0 }}>
            {formatMessageTime(message.timestamp)}
          </Text>
        ) : null}
      </div>
    )
  }

  // ── Compact (single wrapping line) ────────────────────────────────────────
  if (props.chatTheme === 'compact') {
    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 2,
          paddingBottom: 2,
          paddingLeft: 14,
          paddingRight: 14,
          position: 'relative',
          gap: 2,
          opacity:
            message.delivery?.state === 'pending' ? 0.52 : props.moderationOutcome ? 0.48 : 1,
          backgroundColor: isSelfPing
            ? (props.selfPingColor ?? 'rgba(167, 139, 250, 0.15)')
            : message.delivery?.state === 'failed'
              ? 'rgba(239, 68, 68, 0.08)'
              : undefined,
          borderLeftWidth: message.delivery?.state === 'failed' ? 2 : 0,
          borderColor: semantic.error,
          hover: { backgroundColor: isSelfPing ? undefined : 'rgba(255, 255, 255, 0.025)' },
        }}
      >
        {props.showPlatformColorStripe !== false ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 2,
              bottom: 2,
              width: 2,
              borderRadius: 2,
              opacity: 0.7,
              backgroundColor: platformColor(message.platform),
            }}
          />
        ) : null}

        {message.reply && !isTombstone ? (
          <ReplyPreview message={message} fontSize={fontSize} />
        ) : null}

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            // No columnGap: word tokens carry their own trailing spaces, and
            // structural elements use explicit margins (same as the Vue CSS).
            rowGap: 1,
          }}
        >
          {props.showTimestamp ? (
            <Text
              style={{
                fontSize: 10,
                color: theme.text2,
                opacity: 0.8,
                whiteSpace: 'nowrap',
                width: 56,
                flexShrink: 0,
                marginRight: 4,
              }}
            >
              {formatMessageTime(message.timestamp)}
            </Text>
          ) : null}
          {props.showAvatar !== false ? (
            <div style={{ marginRight: 3, flexShrink: 0, display: 'flex' }}>
              <Avatar message={message} size={compactAvatarSize(fontSize)} />
            </div>
          ) : null}
          {props.showPlatformIcon ? (
            <div style={{ marginRight: 3, flexShrink: 0, display: 'flex' }}>
              <PlatformIcon platform={message.platform} size={platformIconSize(fontSize)} />
            </div>
          ) : null}
          {props.showBadges !== false ? (
            <div style={{ marginRight: 3, flexShrink: 0, display: 'flex' }}>
              <BadgeList badges={message.author.badges ?? []} size={badgeSize(fontSize)} />
            </div>
          ) : null}
          <Text
            onClick={openUserCard}
            style={{
              fontWeight: 700,
              fontSize: Math.round(fontSize * 0.9),
              color: authorColor,
              cursor: 'pointer',
              fontFamily: font,
            }}
          >
            {authorName}
          </Text>
          <Text style={{ color: theme.text2, fontSize, fontFamily: font }}>{': '}</Text>
          <MessageTokens
            message={message}
            fontSize={fontSize}
            deleted={isTombstone}
            isAction={isAction}
          />
          {message.delivery?.state === 'failed' ? (
            <Text style={{ fontSize: Math.round(fontSize * 0.82), color: semantic.errorText }}>
              {`Not sent: ${message.delivery.error ?? ''}`}
            </Text>
          ) : null}
          {props.moderationOutcome ? (
            <Text style={{ fontSize: Math.round(fontSize * 0.82), color: theme.text2 }}>
              {props.moderationOutcome.label}
            </Text>
          ) : null}
          {!isTombstone ? (
            <HoverActions
              rowHovered={hovered}
              onReply={() => props.onReply?.(message)}
              onCopy={copyMessage}
              copySuccess={copySuccess}
            />
          ) : null}
        </div>

        {/* Paint order = document order: the rail sits last so its fill and
            preview draw above the row content. */}
        {props.moderationRail}
      </div>
    )
  }

  // ── Modern (default) ──────────────────────────────────────────────────────
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 14,
        paddingRight: 14,
        position: 'relative',
        opacity: message.delivery?.state === 'pending' ? 0.52 : props.moderationOutcome ? 0.48 : 1,
        backgroundColor: isSelfPing
          ? (props.selfPingColor ?? 'rgba(167, 139, 250, 0.15)')
          : message.delivery?.state === 'failed'
            ? 'rgba(239, 68, 68, 0.08)'
            : undefined,
        borderLeftWidth: message.delivery?.state === 'failed' ? 2 : 0,
        borderColor: semantic.error,
        hover: { backgroundColor: 'rgba(255, 255, 255, 0.025)' },
      }}
    >
      {props.showPlatformColorStripe !== false ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 6,
            bottom: 6,
            width: 2,
            borderRadius: 2,
            opacity: 0.7,
            backgroundColor: platformColor(message.platform),
          }}
        />
      ) : null}

      {props.showPlatformIcon ? (
        <div style={{ marginTop: 6, flexShrink: 0, opacity: 0.85, display: 'flex' }}>
          <PlatformIcon platform={message.platform} size={platformIconSize(fontSize)} />
        </div>
      ) : null}

      {props.showAvatar !== false ? (
        <div style={{ marginTop: 1, flexShrink: 0 }}>
          <Avatar message={message} size={modernAvatarSize(fontSize)} />
        </div>
      ) : null}

      <div
        style={{
          flexGrow: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {message.reply && !isTombstone ? (
          <ReplyPreview message={message} fontSize={fontSize} />
        ) : null}

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            flexWrap: 'wrap',
          }}
        >
          {props.showBadges !== false ? (
            <BadgeList badges={message.author.badges ?? []} size={badgeSize(fontSize)} />
          ) : null}
          <Text
            onClick={openUserCard}
            style={{
              fontWeight: 700,
              fontSize: Math.round(fontSize * 0.9),
              color: authorColor,
              cursor: 'pointer',
              fontFamily: font,
            }}
          >
            {authorName}
          </Text>
          {props.showTimestamp ? (
            <Text style={{ fontSize: 10, color: theme.text2, marginLeft: 2 }}>
              {formatMessageTime(message.timestamp)}
            </Text>
          ) : null}
          {!isTombstone ? (
            <HoverActions
              rowHovered={hovered}
              onReply={() => props.onReply?.(message)}
              onCopy={copyMessage}
              copySuccess={copySuccess}
            />
          ) : null}
        </div>

        <MessageText
          message={message}
          fontSize={fontSize}
          deleted={isTombstone}
          isAction={isAction}
        />

        {message.delivery?.state === 'failed' ? (
          <Text
            style={{
              fontSize: Math.round(fontSize * 0.82),
              color: semantic.errorText,
              marginTop: 2,
            }}
          >
            {`Not sent: ${message.delivery.error ?? ''}`}
          </Text>
        ) : null}
        {props.moderationOutcome ? (
          <Text
            style={{ fontSize: Math.round(fontSize * 0.82), color: theme.text2, marginLeft: 4 }}
          >
            {props.moderationOutcome.label}
          </Text>
        ) : null}
      </div>

      {/* Paint order = document order: the rail sits last so its fill and
          preview draw above the row content. */}
      {props.moderationRail}
    </div>
  )
})
