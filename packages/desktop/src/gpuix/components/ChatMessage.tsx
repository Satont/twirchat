/**
 * One chat message row — port of ChatMessage.vue with its three layouts
 * (modern / compact / system) plus hover actions, delivery states,
 * moderation outcomes and the self-ping highlight.
 *
 * GPUIX deltas: no italics (action messages use opacity only), no
 * strikethrough (tombstones dim instead), hover actions are JS-state driven
 * because parent `hover` styles do not reach children.
 */

import type { Account, NormalizedChatMessage, Platform } from '@twirchat/shared/types'
import { memo, useEffect, useMemo, useState } from 'react'

import { deleteOldestEntry } from '../../services/bounded-cache'
import { resolveBadgeImage } from '../../views/main/utils/badge-image'
import type { UserCardTarget } from '../../views/main/utils/chatCommands'
import type { ModerationDragAction } from '../../views/main/utils/moderation-drag'
import {
  initialsOf,
  sanitizeDisplayText,
  truncateGraphemes,
} from '../../views/shared/utils/display-text'
import { useBackend } from '../backend/context'
import { createMentionMatcher } from '../chat-tools'
import { icons } from '../icons'
import type { ResolvedModerationOutcome } from '../state/app'
import { avatarRevisionStore, avatarUrlFor, ensureAvatar } from '../state/caches'
import { useStoreSelector } from '../state/create-store'
import { platformColor, readableOn, semantic } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { ChatAnnouncement } from './ChatAnnouncement'
import { CosmeticAuthorName, CosmeticBadges, useAuthorCosmetics } from './CosmeticAuthor'
import { MessageActionsMenu } from './MessageActionsMenu'
import { MessageModerationRail } from './MessageModerationRail'
import { MessageText, MessageTokens } from './MessageText'
import { MessageTranslation } from './MessageTranslation'
import { BadgeTooltip } from './ui/BadgeTooltip'
import { Icon, PlatformIcon } from './ui/Icon'
import { ImageLoadingContext, RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'

const DEFAULT_FONT_SIZE = 14
const MAX_NAME_GRAPHEMES = 32
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function badgeSize(fontSize: number): number {
  return Math.max(12, Math.round(fontSize * 1.15))
}

function platformIconSize(fontSize: number): number {
  return Math.max(9, Math.round(fontSize * 0.85))
}

function timestampSize(fontSize: number): number {
  return Math.max(10, Math.round(fontSize * 0.78))
}

// Avatars scale with the chat font size (28/18px at the 14px default).
function modernAvatarSize(fontSize: number): number {
  return Math.max(14, Math.round(fontSize * 2))
}

function compactAvatarSize(fontSize: number): number {
  return Math.max(12, Math.round(fontSize * 1.3))
}

export function formatMessageTime(ts: Date): string {
  return Number.isNaN(ts.getTime()) ? 'Invalid Date' : timeFormatter.format(ts)
}

// ── Avatar (fallback circle with the image layered on top once decoded) ─────

export function Avatar({
  message,
  size,
  visible = true,
}: {
  message: NormalizedChatMessage
  size: number
  visible?: boolean
}) {
  const url = useStoreSelector(avatarRevisionStore, () => avatarUrlFor(message))
  useEffect(() => {
    if (visible) ensureAvatar(message)
  }, [message, visible])

  return (
    <div
      testId={`chat-avatar-${message.id}`}
      style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}
    >
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
          {initialsOf(message.author.displayName)}
        </Text>
      </div>
      {url ? (
        <RemoteImage
          url={url}
          avatarSize={size}
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

const badgeDataUrls = new Map<string, string>()

function badgeDataUrl(svg: string): string {
  const cached = badgeDataUrls.get(svg)
  if (cached) return cached
  const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  if (badgeDataUrls.size >= 64) deleteOldestEntry(badgeDataUrls)
  badgeDataUrls.set(svg, url)
  return url
}

function Badge({ imageUrl, text, size }: { imageUrl?: string; text: string; size: number }) {
  const theme = useTheme()
  const resolved = resolveBadgeImage(imageUrl)
  if (resolved?.startsWith('<svg')) {
    // Embedded Kick badge SVG: render full-colour through <img> (the <svg>
    // element is monochrome and would lose the brand colors).
    return (
      <img
        src={badgeDataUrl(resolved)}
        objectFit="contain"
        style={{ width: size, height: size, flexShrink: 0, pointerEvents: 'none' }}
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
        style={{ height: size, width: size, flexShrink: 0, pointerEvents: 'none' }}
      />
    )
  }
  return (
    <div
      style={{
        minHeight: size,
        pointerEvents: 'none',
        paddingLeft: Math.round(size * 0.35),
        paddingRight: Math.round(size * 0.35),
        paddingTop: 1,
        backgroundColor: theme.fillHover,
        borderRadius: 3,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <Text
        style={{
          fontSize: size - 4,
          color: theme.text,
          lineHeight: size - 2,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {text}
      </Text>
    </div>
  )
}

export function BadgeList({
  badges,
  size,
  platform,
}: {
  badges: NormalizedChatMessage['author']['badges']
  size: number
  platform?: Platform
}) {
  if (badges.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {badges.map((badge) => (
        <BadgeTooltip key={badge.id} badge={badge} platform={platform}>
          <Badge imageUrl={badge.imageUrl} text={badge.text} size={size} />
        </BadgeTooltip>
      ))}
    </div>
  )
}

// ── Reply preview ───────────────────────────────────────────────────────────

function ReplyPreview({ message, fontSize }: { message: NormalizedChatMessage; fontSize: number }) {
  const theme = useTheme()
  const reply = message.reply
  if (!reply) return null
  const text = truncateGraphemes(sanitizeDisplayText(reply.parentMessageText), 80)
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
      <Icon name="reply" size={Math.round(fontSize * 0.85)} color={theme.text2} />
      <Text
        style={{
          fontSize: Math.round(fontSize * 0.8),
          color: theme.text,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        {displayName(reply.parentAuthor.displayName)}
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
  const theme = useTheme()
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
        backgroundColor: visible ? (bg ?? theme.fill) : 'transparent',
        hover: { backgroundColor: theme.fillHover },
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
  message,
  channelSlug,
  onOpenUserCard,
  onSearch,
  menuRequest,
}: {
  rowHovered: boolean
  onReply: () => void
  onCopy: () => void
  copySuccess: boolean
  message: NormalizedChatMessage
  channelSlug?: string
  onOpenUserCard: () => void
  onSearch?: (query: string) => void
  menuRequest: number
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
      <MessageActionsMenu
        message={message}
        channelSlug={channelSlug}
        visible={visible}
        onReply={onReply}
        onOpenUserCard={onOpenUserCard}
        onSearch={onSearch}
        request={menuRequest}
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
  visible?: boolean
  fontSize?: number
  chatTheme?: 'modern' | 'compact'
  accounts?: Account[]
  selfPingEnabled?: boolean
  selfPingColor?: string
  highlighted?: boolean
  hiddenLabel?: string
  alias?: string
  moderationOutcome?: ResolvedModerationOutcome
  canModerate?: boolean
  moderationPending?: boolean
  onModerate?: (message: NormalizedChatMessage, action: ModerationDragAction) => void
  /** Moderation drag rail over the row's left edge; gets the row hover. */
  renderModerationRail?: (rowHovered: boolean) => import('react').ReactNode
  onOpenUserCard?: (target: UserCardTarget) => void
  onReply?: (message: NormalizedChatMessage) => void
  onSearch?: (query: string) => void
}

const ChatMessageContent = memo(function ChatMessageContent(props: ChatMessageProps) {
  const { message } = props
  const theme = useTheme()
  const font = useFont()
  const backend = useBackend()
  const [hovered, setHovered] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [ignoredRevealed, setIgnoredRevealed] = useState(false)
  const [menuRequest, setMenuRequest] = useState(0)
  const cosmetics = useAuthorCosmetics(
    message,
    props.visible !== false && (!props.hiddenLabel || ignoredRevealed),
  )

  const fontSize = props.fontSize ?? DEFAULT_FONT_SIZE
  const isSystem = message.type === 'system'
  const isAction = message.type === 'action'
  const isTombstone = props.moderationOutcome?.isTombstone === true
  const mentionMatcher = useMemo(() => createMentionMatcher(props.accounts ?? []), [props.accounts])
  const isSelfPing =
    props.highlighted ?? (props.selfPingEnabled === true && mentionMatcher(message))
  const moderationRail =
    props.canModerate &&
    props.onModerate &&
    (message.platform === 'twitch' || message.platform === 'kick') &&
    !isSystem &&
    !message.delivery &&
    message.id &&
    message.author.id &&
    (!props.moderationOutcome || isTombstone) ? (
      <MessageModerationRail
        disabled={props.moderationPending}
        platform={message.platform}
        rowHovered={hovered}
        onModerate={(action) => props.onModerate?.(message, action)}
      />
    ) : (
      props.renderModerationRail?.(hovered)
    )

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

  // Platform name colors are user-picked — lift them to 4.5:1 on our bg.
  const authorColor = message.author.color ? readableOn(message.author.color, theme.bg) : theme.text
  const authorName = displayName(props.alias ?? message.author.displayName)

  if (props.hiddenLabel && !ignoredRevealed)
    return (
      <div
        testId="ignored-message"
        onClick={() => setIgnoredRevealed(true)}
        style={{
          paddingTop: 5,
          paddingBottom: 5,
          paddingLeft: 14,
          paddingRight: 14,
          cursor: 'pointer',
          backgroundColor: theme.fill,
          borderBottomWidth: 1,
          borderColor: theme.divider,
        }}
      >
        <Text style={{ fontSize: Math.round(fontSize * 0.85), color: theme.text2 }}>
          {props.hiddenLabel}
        </Text>
      </div>
    )

  // ── System message ────────────────────────────────────────────────────────
  if (isSystem) {
    const t = message.text
    const action = t.includes(' added ') ? 'added' : t.includes(' removed ') ? 'removed' : 'renamed'
    const palette =
      action === 'added'
        ? {
            bg: 'rgba(74, 222, 128, 0.04)',
            iconBg: 'rgba(74, 222, 128, 0.15)',
            iconColor: '#4ade80',
            glyph: '+',
          }
        : action === 'removed'
          ? {
              bg: 'rgba(255, 80, 80, 0.05)',
              iconBg: 'rgba(255, 80, 80, 0.18)',
              iconColor: '#ff6060',
              glyph: '−',
            }
          : {
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
          backgroundColor: palette.bg,
          borderBottomWidth: 1,
          borderColor: theme.divider,
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
          <Text style={{ fontSize: timestampSize(fontSize), color: theme.text2, flexShrink: 0 }}>
            {formatMessageTime(message.timestamp)}
          </Text>
        ) : null}
      </div>
    )
  }

  const rowBackground = isSelfPing
    ? (props.selfPingColor ?? 'rgba(167, 139, 250, 0.15)')
    : message.delivery?.state === 'failed'
      ? 'rgba(239, 68, 68, 0.08)'
      : hovered
        ? theme.rowHover
        : undefined
  const rowOpacity =
    message.delivery?.state === 'pending' ? 0.52 : props.moderationOutcome ? 0.48 : 1
  const announcement = message.platform === 'twitch' ? message.metadata?.announcement : undefined

  // Platform stripe: one continuous hairline down the list (rows are flush),
  // so a run of same-platform messages reads as a single column.
  const platformStripe =
    props.showPlatformColorStripe !== false ? (
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          opacity: 0.55,
          backgroundColor:
            message.delivery?.state === 'failed' ? semantic.error : platformColor(message.platform),
        }}
      />
    ) : null

  // ── Compact (single wrapping line, Chatterino-like) ──────────────────────
  if (props.chatTheme === 'compact') {
    const tsSize = timestampSize(fontSize)
    const content = (
      <div
        onMouseDown={(event) => {
          if (event.button === 2) setMenuRequest((value) => value + 1)
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 12,
          paddingRight: 12,
          position: 'relative',
          gap: 2,
          opacity: rowOpacity,
          backgroundColor: rowBackground,
          borderBottomWidth: 1,
          borderColor: theme.divider,
        }}
      >
        {platformStripe}

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
            rowGap: 2,
          }}
        >
          {props.showTimestamp ? (
            <Text
              testId={`chat-timestamp-${message.id}`}
              style={{
                fontSize: tsSize,
                color: theme.text2,
                whiteSpace: 'nowrap',
                width: Math.ceil(tsSize * 4.6),
                textAlign: 'right',
                flexShrink: 0,
                marginRight: 6,
              }}
            >
              {formatMessageTime(message.timestamp)}
            </Text>
          ) : null}
          {props.showAvatar !== false ? (
            <div style={{ marginRight: 5, flexShrink: 0, display: 'flex' }}>
              <Avatar
                message={message}
                size={compactAvatarSize(fontSize)}
                visible={props.visible}
              />
            </div>
          ) : null}
          {props.showPlatformIcon ? (
            <div style={{ marginRight: 5, flexShrink: 0, display: 'flex' }}>
              <PlatformIcon platform={message.platform} size={platformIconSize(fontSize)} />
            </div>
          ) : null}
          {props.showBadges !== false && (message.author.badges?.length ?? 0) > 0 ? (
            <div style={{ marginRight: 5, flexShrink: 0, display: 'flex' }}>
              <BadgeList
                badges={message.author.badges ?? []}
                size={badgeSize(fontSize)}
                platform={message.platform}
              />
            </div>
          ) : null}
          {props.showBadges !== false && cosmetics?.badges.length ? (
            <CosmeticBadges badges={cosmetics.badges} size={badgeSize(fontSize)} />
          ) : null}
          <CosmeticAuthorName
            name={authorName}
            paint={cosmetics?.paint}
            fontSize={fontSize}
            color={authorColor}
            onClick={openUserCard}
          />
          <Text
            style={{
              color: theme.text,
              fontSize,
              fontFamily: font,
              lineHeight: Math.round(fontSize * 1.45),
            }}
          >
            {isAction ? ' ' : ': '}
          </Text>
          <MessageTokens
            message={message}
            fontSize={fontSize}
            deleted={isTombstone}
            isAction={isAction}
            actionColor={isAction ? authorColor : undefined}
          />
          {message.delivery?.state === 'failed' ? (
            <Text style={{ fontSize: Math.round(fontSize * 0.82), color: theme.dangerText }}>
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
              message={message}
              channelSlug={props.channelSlug}
              onOpenUserCard={openUserCard}
              onSearch={props.onSearch}
              menuRequest={menuRequest}
              rowHovered={hovered}
              onReply={() => props.onReply?.(message)}
              onCopy={copyMessage}
              copySuccess={copySuccess}
            />
          ) : null}
        </div>

        {/* Paint order = document order: the rail sits last so its fill and
            preview draw above the row content. */}
        {!isTombstone ? (
          <MessageTranslation message={message} channelId={props.channelSlug} fontSize={fontSize} />
        ) : null}
        {moderationRail}
      </div>
    )
    return announcement ? (
      <ChatAnnouncement id={message.id} color={announcement} fontSize={fontSize}>
        {content}
      </ChatAnnouncement>
    ) : (
      content
    )
  }

  // ── Modern (default) ──────────────────────────────────────────────────────
  const content = (
    <div
      onMouseDown={(event) => {
        if (event.button === 2) setMenuRequest((value) => value + 1)
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingTop: 7,
        paddingBottom: 7,
        paddingLeft: 14,
        paddingRight: 14,
        position: 'relative',
        opacity: rowOpacity,
        backgroundColor: rowBackground,
        borderBottomWidth: 1,
        borderColor: theme.divider,
      }}
    >
      {platformStripe}

      {props.showPlatformIcon ? (
        <div style={{ marginTop: 6, flexShrink: 0, opacity: 0.85, display: 'flex' }}>
          <PlatformIcon platform={message.platform} size={platformIconSize(fontSize)} />
        </div>
      ) : null}

      {props.showAvatar !== false ? (
        <div style={{ marginTop: 1, flexShrink: 0 }}>
          <Avatar message={message} size={modernAvatarSize(fontSize)} visible={props.visible} />
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
            <BadgeList
              badges={message.author.badges ?? []}
              size={badgeSize(fontSize)}
              platform={message.platform}
            />
          ) : null}
          {props.showBadges !== false && cosmetics?.badges.length ? (
            <CosmeticBadges badges={cosmetics.badges} size={badgeSize(fontSize)} />
          ) : null}
          <CosmeticAuthorName
            name={authorName}
            paint={cosmetics?.paint}
            fontSize={fontSize}
            color={authorColor}
            onClick={openUserCard}
          />
          {props.showTimestamp ? (
            <Text
              style={{
                fontSize: timestampSize(fontSize),
                color: theme.text2,
                marginLeft: 2,
              }}
            >
              {formatMessageTime(message.timestamp)}
            </Text>
          ) : null}
          {!isTombstone ? (
            <HoverActions
              message={message}
              channelSlug={props.channelSlug}
              onOpenUserCard={openUserCard}
              onSearch={props.onSearch}
              menuRequest={menuRequest}
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
          actionColor={isAction ? authorColor : undefined}
        />
        {!isTombstone ? (
          <MessageTranslation message={message} channelId={props.channelSlug} fontSize={fontSize} />
        ) : null}

        {message.delivery?.state === 'failed' ? (
          <Text
            style={{
              fontSize: Math.round(fontSize * 0.82),
              color: theme.dangerText,
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
      {moderationRail}
    </div>
  )
  return announcement ? (
    <ChatAnnouncement id={message.id} color={announcement} fontSize={fontSize}>
      {content}
    </ChatAnnouncement>
  ) : (
    content
  )
})

export const ChatMessage = memo(function ChatMessage(props: ChatMessageProps) {
  return (
    <ImageLoadingContext.Provider value={props.visible !== false}>
      <ChatMessageContent {...props} />
    </ImageLoadingContext.Provider>
  )
})

/** Names are untrusted too: no zalgo, no newlines, no row-wide 60-char nicks. */
function displayName(name: string): string {
  return truncateGraphemes(sanitizeDisplayText(name).trim(), MAX_NAME_GRAPHEMES)
}
