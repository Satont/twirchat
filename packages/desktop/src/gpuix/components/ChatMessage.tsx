/**
 * One chat message row — port of ChatMessage.vue with its three layouts
 * (modern / compact / system) plus hover actions,
 * moderation outcomes and the self-ping highlight.
 *
 * GPUIX deltas: no italics (action messages use opacity only), no
 * strikethrough (tombstones dim instead), hover actions are JS-state driven
 * because parent `hover` styles do not reach children.
 */

import { Tooltip, TooltipContent, TooltipTrigger, type EventPayload } from '@gpuix/react'
import type {
  Account,
  NormalizedChatMessage,
  Platform,
  SevenTvSystemAction,
  TimestampFormat,
  WatchedChannel,
} from '@twirchat/shared/types'
import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'

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
import { t, tPlural, useLanguage } from '../i18n'
import { icons } from '../icons'
import { claimMessageRowClick, isMessageRowDoubleClick } from '../message-row-click'
import type { ResolvedModerationOutcome } from '../state/app'
import { avatarRevisionStore, avatarUrlFor, ensureAvatar } from '../state/caches'
import { useStoreSelector } from '../state/create-store'
import { semantic, platformColor, readableOn } from '../theme'
import { useFont, useTheme } from '../theme-context'
import { formatMessageTime, timestampColumnWidth, timestampSize } from '../timestamp-format'
import { ChatAnnouncement } from './ChatAnnouncement'
import { CosmeticAuthorName, CosmeticBadges, useAuthorCosmetics } from './CosmeticAuthor'
import { MessageActionsMenu } from './MessageActionsMenu'
import { MessageModerationRail } from './MessageModerationRail'
import { MessageText, MessageTokens } from './MessageText'
import { MessageTranslation } from './MessageTranslation'
import { TwitchChatNotice } from './TwitchChatNotice'
import { Badge as BadgeComponent } from './ui/Badge'
import { BadgeTooltip } from './ui/BadgeTooltip'
import { Icon, PlatformIcon } from './ui/Icon'
import { ImageLoadingContext, RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'
import { hexMix } from './user-card/format'

const DEFAULT_FONT_SIZE = 14
const MAX_NAME_GRAPHEMES = 32

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

const MODERN_PADDING_X = 14
const MODERN_PADDING_Y = 7
const MODERN_GAP = 10

interface LeadingBox {
  left: number
  top: number
  size: number
}
interface ModernLeading {
  icon?: LeadingBox
  avatar?: LeadingBox
  contentLeft: number
  minHeight: number
}

/** Absolute placement of the modern row's icon and avatar, matching a gapped flex row. */
function modernLeading(fontSize: number, showIcon: boolean, showAvatar: boolean): ModernLeading {
  let left = MODERN_PADDING_X
  let minHeight = 0
  let icon: LeadingBox | undefined
  let avatar: LeadingBox | undefined
  if (showIcon) {
    icon = { left, top: MODERN_PADDING_Y + 6, size: platformIconSize(fontSize) }
    left += icon.size + MODERN_GAP
    minHeight = Math.max(minHeight, 6 + icon.size)
  }
  if (showAvatar) {
    avatar = { left, top: MODERN_PADDING_Y + 1, size: modernAvatarSize(fontSize) }
    left += avatar.size + MODERN_GAP
    minHeight = Math.max(minHeight, 1 + avatar.size)
  }
  return { icon, avatar, contentLeft: left, minHeight }
}

function compactAvatarSize(fontSize: number): number {
  return Math.max(12, Math.round(fontSize * 1.3))
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
          thumbnailSize={size}
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

function ReplyPreview({
  message,
  fontSize,
  onOpenThread,
}: {
  message: NormalizedChatMessage
  fontSize: number
  onOpenThread?: ChatMessageProps['onOpenThread']
}) {
  const theme = useTheme()
  useLanguage()
  const reply = message.reply
  if (!reply) return null
  const open = message.platform === 'twitch' && onOpenThread
  const text = truncateGraphemes(sanitizeDisplayText(reply.parentMessageText), 80)
  return (
    <div
      testId={open ? `chat-thread-open-${message.id}` : undefined}
      role={open ? 'button' : undefined}
      aria-label={open ? t('chat.thread.open') : undefined}
      tabIndex={open ? 0 : undefined}
      onClick={
        open
          ? (event) => {
              if (!claimMessageRowClick(event)) return
              open(message)
            }
          : undefined
      }
      onKeyDown={
        open
          ? (event) => {
              if (event.key === 'enter' || event.key === 'space') {
                event.preventDefault()
                open(message)
              }
            }
          : undefined
      }
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        overflow: 'hidden',
        ...(open
          ? {
              cursor: 'pointer',
              hover: { backgroundColor: theme.fillHover },
              focusVisible: { outlineWidth: 1, outlineColor: theme.link, outlineOffset: -2 },
            }
          : {}),
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

function ActionButton({
  visible,
  onHoverChange,
  onClick,
  testId,
  icon,
  color,
  bg,
  title,
}: {
  visible: boolean
  onHoverChange: (hovered: boolean) => void
  onClick: () => void
  testId: string
  icon: string
  color: string
  bg?: string
  title?: string
}) {
  const theme = useTheme()
  const button = (
    <div
      testId={testId}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onClick={(event) => {
        if (!claimMessageRowClick(event)) return
        onClick()
      }}
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
  return title ? (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="top"
        style={{ backgroundColor: theme.popover, color: theme.text, padding: 7, borderRadius: 5 }}
      >
        <Text style={{ fontSize: 12, color: theme.text }}>{title}</Text>
      </TooltipContent>
    </Tooltip>
  ) : (
    button
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
  menuPosition,
  onMenuButtonClick,
  moreTitle,
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
  menuPosition?: { x: number; y: number } | null
  onMenuButtonClick: () => void
  moreTitle?: string
}) {
  const theme = useTheme()
  const [replyHover, setReplyHover] = useState(false)
  const [copyHover, setCopyHover] = useState(false)
  const [containerHovered, setContainerHovered] = useState(false)
  const visible = rowHovered || containerHovered || replyHover || copyHover

  return (
    <div
      onMouseEnter={() => setContainerHovered(true)}
      onMouseLeave={() => setContainerHovered(false)}
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
        title={t('chatMessages.actions.reply')}
      />

      <ActionButton
        visible={visible}
        onHoverChange={setCopyHover}
        onClick={onCopy}
        testId="msg-copy"
        title={t('chatMessages.actions.copyMessage')}
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
        position={menuPosition}
        onMenuButtonClick={onMenuButtonClick}
        title={moreTitle}
        onHoverChange={setContainerHovered}
      />
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export interface ChatMessageProps {
  message: NormalizedChatMessage
  channelSlug?: string
  feedSource?: WatchedChannel
  showPlatformColorStripe?: boolean
  showPlatformIcon?: boolean
  showTimestamp?: boolean
  timestampFormat?: TimestampFormat
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
  /** A primary double-click on the row calls `onReply`. */
  replyOnDoubleClick?: boolean
  onOpenThread?: (message: NormalizedChatMessage) => void
  hideReplyPreview?: boolean
  onSearch?: (query: string) => void
}

/** Rare row labels subscribe to the UI language themselves, so ordinary rows hold no subscription. */
function FirstMessageLabel() {
  useLanguage()
  return t('chatMessages.firstMessage')
}

function CheerNotice({
  id,
  fontSize,
  bits,
  children,
}: {
  id: string
  fontSize: number
  bits: number
  children: ReactElement
}) {
  useLanguage()
  return (
    <TwitchChatNotice
      id={id}
      kind="cheer"
      fontSize={fontSize}
      summary={tPlural('chatMessages.bits', bits, { count: bits.toLocaleString() })}
    >
      {children}
    </TwitchChatNotice>
  )
}

/** History saved before 7TV rows carried their action is English text. */
function legacySystemAction(text: string): SevenTvSystemAction {
  if (text.includes(' added ')) return 'added'
  if (text.includes(' removed ')) return 'removed'
  return 'changed'
}

function wrapTwitchMessage(
  content: ReactElement,
  id: string,
  fontSize: number,
  announcement: string | undefined,
  bits: number | undefined,
): ReactElement {
  if (announcement)
    return (
      <ChatAnnouncement id={id} color={announcement} fontSize={fontSize}>
        {content}
      </ChatAnnouncement>
    )
  if (bits)
    return (
      <CheerNotice id={id} fontSize={fontSize} bits={bits}>
        {content}
      </CheerNotice>
    )
  return content
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
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const clearMenuPosition = useCallback(() => setMenuPosition(null), [])
  const cosmetics = useAuthorCosmetics(
    message,
    props.visible !== false && (!props.hiddenLabel || ignoredRevealed),
  )

  const fontSize = props.fontSize ?? DEFAULT_FONT_SIZE
  const source = props.feedSource
  const sourceLabel = source ? (
    <div
      testId={`chat-feed-source-${message.id}`}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        maxWidth: 124,
        minWidth: 0,
        marginRight: props.chatTheme === 'compact' ? 6 : 0,
        paddingLeft: 4,
        paddingRight: 5,
        borderRadius: 4,
        backgroundColor: theme.fill,
      }}
    >
      <PlatformIcon platform={source.platform} size={platformIconSize(fontSize)} />
      <Text
        style={{
          fontSize: timestampSize(fontSize),
          color: theme.text2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {sanitizeDisplayText(source.displayName)}
      </Text>
    </div>
  ) : null
  const isSystem = message.type === 'system'
  const isAction = message.type === 'action'
  const isTombstone = props.moderationOutcome?.isTombstone === true
  const mentionMatcher = useMemo(() => createMentionMatcher(props.accounts ?? []), [props.accounts])
  const isSelfPing =
    props.highlighted ?? (props.selfPingEnabled === true && mentionMatcher(message))
  // Sanctioned rows keep the rail: a left drag unbans, a right drag changes the sanction.
  const moderationRail =
    props.canModerate &&
    props.onModerate &&
    (message.platform === 'twitch' || message.platform === 'kick') &&
    !isSystem &&
    message.id &&
    message.author.id ? (
      <MessageModerationRail
        disabled={props.moderationPending}
        platform={message.platform}
        messageDeleted={isTombstone}
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
      color: message.author.color,
      currentAlias: props.alias,
      badges: message.author.badges,
    })
  }

  const onReply = props.onReply
  const replyOnRowDoubleClick =
    props.replyOnDoubleClick && onReply && !isTombstone
      ? (event: EventPayload) => {
          if (isMessageRowDoubleClick(event)) onReply(message)
        }
      : undefined

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
    const notice = message.metadata?.twitchNotice
    if (message.platform === 'twitch' && notice) {
      const row = (
        <TwitchChatNotice
          id={message.id}
          kind={notice.kind}
          fontSize={fontSize}
          summary={message.text}
          detail={notice.detail}
          time={
            props.showTimestamp
              ? formatMessageTime(message.timestamp, props.timestampFormat)
              : undefined
          }
        />
      )
      return sourceLabel ? (
        <div>
          <div style={{ paddingTop: 4, paddingLeft: 12 }}>{sourceLabel}</div>
          {row}
        </div>
      ) : (
        row
      )
    }

    const action = message.metadata?.sevenTvAction ?? legacySystemAction(message.text)
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
        {sourceLabel}
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
          <MessageText
            message={message}
            fontSize={Math.round(fontSize * 0.88)}
            isSystem
            channelSlug={props.channelSlug}
            onOpenUserCard={props.onOpenUserCard}
          />
        </div>
        {props.showTimestamp ? (
          <Text style={{ fontSize: timestampSize(fontSize), color: theme.text2, flexShrink: 0 }}>
            {formatMessageTime(message.timestamp, props.timestampFormat)}
          </Text>
        ) : null}
      </div>
    )
  }

  const FIRST_MESSAGE_BACKGROUND_OPACITY = 0.15

  const SELF_PING_BACKGROUND_FALLBACK = 'rgba(167, 139, 250, 0.15)'

  const isFirstMessage = message.metadata?.firstMessage === true

  let rowBackground: string | undefined

  if (isFirstMessage) {
    rowBackground = hexMix(semantic.firstMessageSofter, theme.bg, FIRST_MESSAGE_BACKGROUND_OPACITY)
  } else if (isSelfPing) {
    rowBackground = props.selfPingColor ?? SELF_PING_BACKGROUND_FALLBACK
  } else if (hovered) {
    rowBackground = theme.rowHover
  }

  const rowOpacity = props.moderationOutcome ? 0.48 : 1
  const announcement = message.platform === 'twitch' ? message.metadata?.announcement : undefined
  const bits = message.platform === 'twitch' && !isTombstone ? message.metadata?.bits : undefined

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
          backgroundColor: platformColor(message.platform),
        }}
      />
    ) : null

  // ── Compact (single wrapping line, Chatterino-like) ──────────────────────
  if (props.chatTheme === 'compact') {
    const tsSize = timestampSize(fontSize)
    const content = (
      <div
        onMouseDown={(event) => {
          if (event.button === 2) {
            setMenuRequest((value) => value + 1)
            setMenuPosition({ x: event.x ?? 0, y: event.y ?? 0 })
          }
        }}
        onClick={replyOnRowDoubleClick}
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

        {message.reply && !isTombstone && !props.hideReplyPreview ? (
          <ReplyPreview message={message} fontSize={fontSize} onOpenThread={props.onOpenThread} />
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
                width: timestampColumnWidth(fontSize, props.timestampFormat ?? 'HH:MM:SS'),
                textAlign: 'right',
                flexShrink: 0,
                marginRight: 6,
              }}
            >
              {formatMessageTime(message.timestamp, props.timestampFormat)}
            </Text>
          ) : null}
          {sourceLabel}
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
            <CosmeticBadges badges={cosmetics.badges} size={badgeSize(fontSize)} marginRight={5} />
          ) : null}
          <CosmeticAuthorName
            name={authorName}
            paint={cosmetics?.paint}
            fontSize={fontSize}
            color={authorColor}
            onClick={openUserCard}
          />
          {isFirstMessage ? (
            <BadgeComponent
              variant="warning"
              size="sm"
              style={{
                marginLeft: 4,
                fontSize: Math.round(fontSize * 0.7),
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}
            >
              <FirstMessageLabel />
            </BadgeComponent>
          ) : null}
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
            channelSlug={props.channelSlug}
            onOpenUserCard={props.onOpenUserCard}
            fontSize={fontSize}
            deleted={isTombstone}
            isAction={isAction}
            actionColor={isAction ? authorColor : undefined}
          />
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
              menuPosition={menuPosition}
              onMenuButtonClick={clearMenuPosition}
              rowHovered={hovered}
              onReply={() => props.onReply?.(message)}
              onCopy={copyMessage}
              copySuccess={copySuccess}
              moreTitle={t('chatMessages.actions.moreActions')}
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
    return wrapTwitchMessage(content, message.id, fontSize, announcement, bits)
  }

  // ── Modern (default) ──────────────────────────────────────────────────────
  // The row is a column and the leading icon/avatar are absolute: the native
  // renderer reuses message bodies only under column ancestry, so a hover redraw
  // does not lay out every visible message again.
  const leading = modernLeading(
    fontSize,
    props.showPlatformIcon === true,
    props.showAvatar !== false,
  )
  const content = (
    <div
      onMouseDown={(event) => {
        if (event.button === 2) {
          setMenuRequest((value) => value + 1)
          setMenuPosition({ x: event.x ?? 0, y: event.y ?? 0 })
        }
      }}
      onClick={replyOnRowDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        paddingTop: MODERN_PADDING_Y,
        paddingBottom: MODERN_PADDING_Y,
        paddingLeft: leading.contentLeft,
        paddingRight: MODERN_PADDING_X,
        position: 'relative',
        opacity: rowOpacity,
        backgroundColor: rowBackground,
        borderBottomWidth: 1,
        borderColor: theme.divider,
      }}
    >
      {platformStripe}

      {leading.icon ? (
        <div
          style={{
            position: 'absolute',
            left: leading.icon.left,
            top: leading.icon.top,
            opacity: 0.85,
            display: 'flex',
          }}
        >
          <PlatformIcon platform={message.platform} size={leading.icon.size} />
        </div>
      ) : null}

      {leading.avatar ? (
        <div style={{ position: 'absolute', left: leading.avatar.left, top: leading.avatar.top }}>
          <Avatar message={message} size={leading.avatar.size} visible={props.visible} />
        </div>
      ) : null}

      <div
        style={{
          minWidth: 0,
          minHeight: leading.minHeight,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {message.reply && !isTombstone && !props.hideReplyPreview ? (
          <ReplyPreview message={message} fontSize={fontSize} onOpenThread={props.onOpenThread} />
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
          {sourceLabel}
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
          {isFirstMessage ? (
            <BadgeComponent
              variant="warning"
              size="sm"
              style={{
                marginLeft: 4,
                fontSize: Math.round(fontSize * 0.7),
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}
            >
              <FirstMessageLabel />
            </BadgeComponent>
          ) : null}
          {props.showTimestamp ? (
            <Text
              style={{
                fontSize: timestampSize(fontSize),
                color: theme.text2,
                marginLeft: 2,
              }}
            >
              {formatMessageTime(message.timestamp, props.timestampFormat)}
            </Text>
          ) : null}
          {!isTombstone ? (
            <HoverActions
              message={message}
              channelSlug={props.channelSlug}
              onOpenUserCard={openUserCard}
              onSearch={props.onSearch}
              menuRequest={menuRequest}
              menuPosition={menuPosition}
              onMenuButtonClick={clearMenuPosition}
              rowHovered={hovered}
              onReply={() => props.onReply?.(message)}
              onCopy={copyMessage}
              copySuccess={copySuccess}
              moreTitle={t('chatMessages.actions.moreActions')}
            />
          ) : null}
        </div>

        <MessageText
          message={message}
          channelSlug={props.channelSlug}
          onOpenUserCard={props.onOpenUserCard}
          fontSize={fontSize}
          deleted={isTombstone}
          isAction={isAction}
          actionColor={isAction ? authorColor : undefined}
        />
        {!isTombstone ? (
          <MessageTranslation message={message} channelId={props.channelSlug} fontSize={fontSize} />
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
  return wrapTwitchMessage(content, message.id, fontSize, announcement, bits)
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
