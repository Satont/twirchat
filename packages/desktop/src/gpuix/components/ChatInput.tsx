/**
 * Message composer — port of ChatInput.vue.
 *
 * Native <textarea> (auto-growing, Enter submits). Autocomplete keyboard
 * navigation intercepts keys via onKeyDown; while the popup is open the
 * textarea's onSubmit is removed, otherwise GPUI's Enter→submit action would
 * consume the key before the popup sees it.
 */

import { useMemo, useState } from 'react'

import { trackTextInputFocus } from '../state/focus'
import type {
  Account,
  AppSettings,
  NormalizedChatMessage,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'

import { platformColor, withAlpha } from '../theme'
import { useTheme } from '../theme-context'
import { aliasesStore } from '../state/app'
import { useStore } from '../state/create-store'
import { useAutocomplete, parseToken, replaceToken } from '../hooks/use-autocomplete'
import { AutocompletePopup } from './AutocompletePopup'
import { Icon, PlatformIcon } from './ui/Icon'
import { Text } from './ui/Text'
import { resolveUserCardCommand, type UserCardTarget } from '../../views/main/utils/chatCommands'
import {
  createChatMessageTargets,
  ownChatSendTargets,
} from '../../views/main/utils/chat-send-targets'
import { EmotePicker } from './EmotePicker'

export interface ChatInputProps {
  accounts: Account[]
  settings: AppSettings
  statuses: Partial<Record<import('@twirchat/shared/types').Platform, PlatformStatusInfo>>
  watchedChannel?: WatchedChannel | null
  watchedChannelStatus?: PlatformStatusInfo | null
  replyTarget?: NormalizedChatMessage | null
  messages?: NormalizedChatMessage[]
  onSend: (
    targets: { platform: string; channelLogin: string; text: string; replyToMessageId?: string }[],
  ) => void
  onSendWatched: (payload: { text: string; channelId: string; replyToMessageId?: string }) => void
  onOpenUserCard: (target: UserCardTarget) => void
  onCancelReply: () => void
}

function connectionStatusText(status: string | undefined, channel: string, error?: string): string {
  switch (status) {
    case 'connecting':
      return `Connecting to ${channel}…`
    case 'disconnected':
      return `${channel} disconnected`
    case 'error':
      return error || `Could not connect to ${channel}`
    default:
      return ''
  }
}

export function ChatInput(props: ChatInputProps) {
  const theme = useTheme()
  const aliases = useStore(aliasesStore)
  const [text, setText] = useState('')
  const [commandError, setCommandError] = useState('')
  const [emotePickerOpen, setEmotePickerOpen] = useState(false)

  const aliasMap = useMemo(() => {
    const map = new Map<import('@twirchat/shared/types').Platform, Map<string, string>>()
    for (const alias of aliases) {
      let inner = map.get(alias.platform)
      if (!inner) {
        inner = new Map()
        map.set(alias.platform, inner)
      }
      inner.set(alias.platformUserId, alias.alias)
    }
    return map
  }, [aliases])

  const autocomplete = useAutocomplete({
    text,
    setText: (next) => {
      setText(next)
      setCommandError('')
    },
    messages: props.messages ?? [],
    watchedChannel: props.watchedChannel,
    statuses: props.statuses,
    aliasMap,
  })

  // ── Target chips (home tab: one per own platform) ────────────────────────

  const connectedPlatforms = useMemo(() => {
    if (props.watchedChannel) return []
    return ownChatSendTargets(props.accounts).map((target) => {
      const exactStatus = Object.values(props.statuses).find(
        (info) =>
          info?.platform === target.platform &&
          info.channelLogin?.toLowerCase() === target.channelLogin.toLowerCase(),
      )
      return {
        platform: target.platform,
        channelLogin: target.channelLogin,
        status: exactStatus?.status ?? 'connected',
        mode: exactStatus?.mode ?? 'authenticated',
        error: exactStatus?.error,
      }
    })
  }, [props.accounts, props.statuses, props.watchedChannel])

  const homeConnectionStatuses = connectedPlatforms.filter((p) => p.status !== 'connected')
  const sendablePlatforms = connectedPlatforms.filter((p) => p.mode === 'authenticated')
  const hasAnything = props.watchedChannel ? true : connectedPlatforms.length > 0
  const isDisabled = props.watchedChannel
    ? props.watchedChannelStatus?.mode !== 'authenticated'
    : sendablePlatforms.length === 0

  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({})
  const isEnabled = (platform: string): boolean => {
    const info = connectedPlatforms.find((p) => p.platform === platform)
    if (!info || info.mode !== 'authenticated') return false
    return enabledMap[platform] !== false
  }
  const toggle = (platform: string) => {
    const info = connectedPlatforms.find((p) => p.platform === platform)
    if (!info || info.mode !== 'authenticated') return
    setEnabledMap((current) => ({ ...current, [platform]: !isEnabled(platform) }))
  }

  const canSend = (() => {
    if (!text.trim()) return false
    if (props.watchedChannel) return !isDisabled
    return (
      createChatMessageTargets(sendablePlatforms, text, isEnabled, props.replyTarget).length > 0
    )
  })()

  function send() {
    const trimmed = text.trim()
    if (!trimmed) return

    const userCardCommand = resolveUserCardCommand(trimmed, props.messages ?? [], aliasMap)
    if (userCardCommand) {
      if (!userCardCommand.ok) {
        setCommandError(
          userCardCommand.error === 'missing-query'
            ? 'Usage: /user @nickname'
            : userCardCommand.error === 'ambiguous'
              ? 'Multiple users match that nickname.'
              : 'No user found for that nickname.',
        )
        return
      }
      props.onOpenUserCard(userCardCommand.target)
      setCommandError('')
      setText('')
      return
    }

    if (props.watchedChannel) {
      props.onSendWatched({
        text: trimmed,
        channelId: props.watchedChannel.id,
        replyToMessageId: props.replyTarget?.id,
      })
    } else {
      const targets = createChatMessageTargets(
        sendablePlatforms,
        trimmed,
        isEnabled,
        props.replyTarget,
      )
      if (targets.length === 0) return
      props.onSend(targets)
    }
    setCommandError('')
    setText('')
  }

  function placeholderText(): string {
    if (props.watchedChannel) {
      if (props.watchedChannelStatus?.mode !== 'authenticated') return 'Log in to send messages…'
      return `Message ${props.watchedChannel.displayName}…`
    }
    if (!hasAnything) return 'Connect a channel to send messages…'
    if (isDisabled) return 'Log in to send messages…'
    return 'Send a message… (Enter ↵ to send, Shift+Enter for newline)'
  }

  const currentChannelInfo = props.watchedChannel
    ? { platform: props.watchedChannel.platform, channelId: props.watchedChannel.channelSlug }
    : ownChatSendTargets(props.accounts)[0]
      ? {
          platform: ownChatSendTargets(props.accounts)[0]!.platform,
          channelId: ownChatSendTargets(props.accounts)[0]!.channelLogin,
        }
      : null

  return (
    <div
      style={{
        flexShrink: 0,
        borderTopWidth: 1,
        borderColor: theme.border,
        paddingTop: 8,
        paddingBottom: 10,
        paddingLeft: 12,
        paddingRight: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        backgroundColor: theme.surface,
      }}
    >
      {/* Reply bar */}
      {props.replyTarget ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            borderRadius: 8,
            paddingTop: 5,
            paddingBottom: 5,
            paddingLeft: 10,
            paddingRight: 10,
            borderLeftWidth: 2,
            borderColor: 'rgba(167, 139, 250, 0.5)',
          }}
        >
          <Text style={{ fontSize: 12, color: theme.text2, opacity: 0.7 }}>↩</Text>
          <Text
            style={{
              flexGrow: 1,
              fontSize: 12,
              color: theme.text2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {`Replying to ${props.replyTarget.author.displayName}: ${
              props.replyTarget.text.length > 80
                ? `${props.replyTarget.text.slice(0, 80)}…`
                : props.replyTarget.text
            }`}
          </Text>
          <div
            testId="cancel-reply"
            onClick={props.onCancelReply}
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              borderRadius: 4,
              flexShrink: 0,
              hover: { backgroundColor: 'rgba(255, 255, 255, 0.1)' },
            }}
          >
            <Icon name="close" size={16} color={theme.text2} />
          </div>
        </div>
      ) : null}

      {/* Connection state banners */}
      {props.watchedChannel &&
      props.watchedChannelStatus &&
      props.watchedChannelStatus.status !== 'connected' ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            color: undefined,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor:
                props.watchedChannelStatus.status === 'connecting'
                  ? '#fbbf24'
                  : props.watchedChannelStatus.status === 'error'
                    ? '#fca5a5'
                    : theme.text2,
            }}
          />
          <Text
            style={{
              fontSize: 12,
              color:
                props.watchedChannelStatus.status === 'connecting'
                  ? '#fbbf24'
                  : props.watchedChannelStatus.status === 'error'
                    ? '#fca5a5'
                    : theme.text2,
            }}
          >
            {connectionStatusText(
              props.watchedChannelStatus.status,
              props.watchedChannel.displayName,
              props.watchedChannelStatus.error,
            )}
          </Text>
        </div>
      ) : null}

      {!props.watchedChannel && homeConnectionStatuses.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          {homeConnectionStatuses.map((p) => (
            <div
              key={p.platform}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: p.status === 'connecting' ? '#fbbf24' : '#fca5a5',
                }}
              />
              <Text
                style={{
                  fontSize: 12,
                  color: p.status === 'connecting' ? '#fbbf24' : '#fca5a5',
                }}
              >
                {connectionStatusText(p.status, p.channelLogin, p.error)}
              </Text>
            </div>
          ))}
        </div>
      ) : null}

      {/* Target chips */}
      {props.settings.showChannelLabel && props.watchedChannel ? (
        <div style={{ display: 'flex', flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <TargetChip
            platform={props.watchedChannel.platform}
            label={props.watchedChannel.displayName}
            active={props.watchedChannelStatus?.mode === 'authenticated'}
            anonymous={props.watchedChannelStatus?.mode !== 'authenticated'}
          />
        </div>
      ) : null}

      {props.settings.showChannelLabel && !props.watchedChannel && connectedPlatforms.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {connectedPlatforms.map((p) => (
            <TargetChip
              key={p.platform}
              platform={p.platform}
              label={p.channelLogin}
              active={isEnabled(p.platform)}
              anonymous={p.mode !== 'authenticated'}
              onClick={() => toggle(p.platform)}
            />
          ))}
        </div>
      ) : null}

      {/* Autocomplete + input row */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {autocomplete.isOpen ? (
          <AutocompletePopup
            suggestions={autocomplete.suggestions}
            selectedIndex={autocomplete.selectedIndex}
            mode={autocomplete.mode}
            onSelect={autocomplete.selectSuggestion}
          />
        ) : null}

        {commandError ? (
          <Text style={{ fontSize: 12, color: '#fca5a5', paddingLeft: 2, paddingBottom: 2 }}>
            {commandError}
          </Text>
        ) : null}

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
          }}
        >
          <div
            style={{
              flexGrow: 1,
              minWidth: 0,
              backgroundColor: theme.surface2,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 10,
              paddingLeft: 12,
              paddingRight: 12,
              paddingTop: 8,
              paddingBottom: 8,
            }}
          >
            <textarea
              testId="chat-input"
              value={text}
              placeholder={placeholderText()}
              minRows={1}
              maxRows={5}
              autoFocus
              onChange={(event) => {
                setText(event.value ?? '')
                setCommandError('')
              }}
              onFocus={() => trackTextInputFocus(true)}
              onBlur={() => trackTextInputFocus(false)}
              onSubmit={autocomplete.isOpen ? undefined : send}
              onKeyDown={(event) => {
                if (!autocomplete.isOpen) return
                if (event.key === 'up') {
                  autocomplete.moveUp()
                } else if (event.key === 'down') {
                  autocomplete.moveDown()
                } else if (event.key === 'enter' || event.key === 'tab') {
                  autocomplete.selectSuggestion(autocomplete.selectedIndex)
                } else if (event.key === 'escape') {
                  autocomplete.close()
                }
              }}
              theme={{ caret: '#a78bfa' }}
              style={{
                width: '100%',
                fontSize: 13,
                color: theme.text,
                lineHeight: 20,
                opacity: isDisabled ? 0.4 : 1,
              }}
            />
          </div>

          <div
            testId="emote-button"
            onClick={() => {
              if (!isDisabled) setEmotePickerOpen((open) => !open)
            }}
            style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isDisabled ? 'default' : 'pointer',
              opacity: isDisabled ? 0.3 : 1,
              backgroundColor: emotePickerOpen ? 'rgba(167, 139, 250, 0.15)' : undefined,
              hover: { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
            }}
          >
            <Icon name="smile" size={16} color={emotePickerOpen ? '#a78bfa' : theme.text2} />
          </div>

          <div
            testId="send-button"
            onClick={() => {
              if (canSend) send()
            }}
            style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: '#7c3aed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: canSend ? 'pointer' : 'default',
              opacity: canSend ? 1 : 0.35,
              hover: { backgroundColor: canSend ? '#6d28d9' : '#7c3aed' },
            }}
          >
            <Icon name="send" size={16} color="#ffffff" />
          </div>
        </div>

        {/* Emote picker overlay */}
        {emotePickerOpen && currentChannelInfo ? (
          <EmotePicker
            platform={currentChannelInfo.platform}
            channelId={currentChannelInfo.channelId}
            useSessionCache={props.settings.emoteSessionCache}
            onSelect={(alias) => {
              // GPUIX's native textarea does not expose the caret position,
              // so emotes append at the end (the Vue build inserted at caret).
              setText((current) => {
                const token = parseToken(current)
                if (token.mode === 'emote') {
                  return replaceToken(current, {
                    type: 'emote',
                    label: alias,
                    imageUrl: '',
                    animated: false,
                  })
                }
                return `${current}${current.endsWith(' ') || current === '' ? '' : ' '}${alias} `
              })
              setEmotePickerOpen(false)
            }}
            onClose={() => setEmotePickerOpen(false)}
          />
        ) : null}
      </div>
    </div>
  )
}

function TargetChip({
  platform,
  label,
  active,
  anonymous,
  onClick,
}: {
  platform: string
  label: string
  active: boolean
  anonymous: boolean
  onClick?: () => void
}) {
  const color = platformColor(platform)
  const [hovered, setHovered] = useState(false)
  const effectiveHover = hovered && !anonymous && !active

  return (
    <div
      onClick={anonymous ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingTop: 3,
        paddingBottom: 3,
        paddingLeft: 7,
        paddingRight: 9,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: active
          ? withAlpha(color, 0.45)
          : effectiveHover
            ? withAlpha(color, 0.55)
            : 'rgba(255, 255, 255, 0.1)',
        backgroundColor: active
          ? withAlpha(color, 0.15)
          : effectiveHover
            ? withAlpha(color, 0.2)
            : 'rgba(255, 255, 255, 0.04)',
        cursor: anonymous ? 'default' : 'pointer',
        opacity: anonymous ? 0.35 : !active && !hovered ? 0.4 : 1,
        userSelect: 'none',
      }}
    >
      <PlatformIcon
        platform={platform}
        size={13}
        color={active || effectiveHover ? color : '#8b8b99'}
      />
      <Text
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: active || effectiveHover ? color : '#8b8b99',
          maxWidth: 80,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Text>
      {anonymous ? <Icon name="lock" size={10} color="#8b8b99" /> : null}
    </div>
  )
}
