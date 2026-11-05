import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'

import { sanitizeDisplayText } from '../../views/shared/utils/display-text'
import type { PluginWatchedChannel } from '../../watched-channels/plugin-channel-types'
import type {
  PluginChannelMessage,
  PluginChannelSnapshot,
} from '../../watched-channels/plugin-channels'
import { useBackend } from '../backend/context'
import { parsePluginCommand } from '../commands'
import { useComposerFocusRegistration } from '../state/composer-focus'
import { useTextInputFocusTracking } from '../state/focus'
import { useTheme } from '../theme-context'
import { ActionButton, FormError } from './ui/Form'
import { Text } from './ui/Text'

const statusLabels: Record<PluginChannelSnapshot['status']['status'], string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection failed',
}

interface PluginChatPaneProps {
  channel: PluginWatchedChannel
  paneId: string
  headerLeading?: ReactNode
  onChangeChannel: () => void
  onSplitRight: () => void
  onClosePanel: () => void
}

const PluginChatRow = memo(function PluginChatRow({ message }: { message: PluginChannelMessage }) {
  const theme = useTheme()
  const text = message.kind === 'message' ? `${message.author.name}: ${message.text}` : message.text
  return (
    <div
      testId={`plugin-chat-message-${message.id.toWellFormed()}`}
      style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3 }}
    >
      <Text style={{ fontSize: 13, color: message.kind === 'system' ? theme.text2 : theme.text }}>
        {sanitizeDisplayText(text)}
      </Text>
    </div>
  )
})

const PluginChatMessages = memo(function PluginChatMessages({
  messages,
}: {
  messages: readonly PluginChannelMessage[] | undefined
}) {
  const theme = useTheme()
  return (
    <virtual-list
      testId="plugin-chat-messages"
      alignment="bottom"
      followTail
      estimatedItemHeight={22}
      style={{ flexGrow: 1, minHeight: 0, scrollbarColor: theme.scrollbar, scrollbarWidth: 5 }}
    >
      {messages?.map((message) => (
        <PluginChatRow key={message.id} message={message} />
      ))}
    </virtual-list>
  )
})

export function PluginChatPane({
  channel,
  paneId,
  headerLeading,
  onChangeChannel,
  onSplitRight,
  onClosePanel,
}: PluginChatPaneProps) {
  const backend = useBackend()
  const theme = useTheme()
  const renderer = useGpuixRequired()
  const input = useRef<PublicInstance | null>(null)
  const sendingRef = useRef(false)
  const [snapshot, setSnapshot] = useState<PluginChannelSnapshot>()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [focused, setFocused] = useState(false)
  const focus = useTextInputFocusTracking(setFocused)
  const lifetime = useRef(false)
  useComposerFocusRegistration(`${paneId}:${channel.id}`, renderer, input, channel.id)
  useEffect(() => {
    lifetime.current = true
    const off = backend.api.observePluginChannel(channel.id, setSnapshot)
    return () => {
      lifetime.current = false
      off()
    }
  }, [backend, channel.id])

  const status = snapshot?.status
  const writable = status?.status === 'connected' && snapshot?.canSend
  const statusText = status?.error
    ? sanitizeDisplayText(status.error)
    : statusLabels[status?.status ?? 'connecting']
  const readOnly = status?.status === 'connected' && !snapshot?.canSend
  const command = parsePluginCommand(text.trim())
  const pluginCommand = command && backend.plugins?.hasCommand(command.name) ? command : null
  const canSend = Boolean(text.trim()) && (Boolean(writable) || pluginCommand !== null)

  async function submit() {
    if (sendingRef.current || !canSend) return
    sendingRef.current = true
    setSending(true)
    setSendError('')
    try {
      const output = text.trim()
      if (pluginCommand && backend.plugins) {
        await backend.plugins.runCommand(pluginCommand.name, {
          text: output,
          args: pluginCommand.args,
          channel: {
            platform: channel.platform,
            id: channel.channelSlug,
            name: channel.displayName,
            watchedChannelId: channel.id,
          },
        })
      } else {
        await backend.api.sendPluginChannelMessage({ id: channel.id, text: output })
      }
      if (lifetime.current) setText((current) => (current === text ? '' : current))
    } catch (cause) {
      if (lifetime.current) setSendError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      sendingRef.current = false
      if (lifetime.current) setSending(false)
    }
  }

  return (
    <div
      testId="plugin-chat"
      style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'center',
          padding: 6,
          borderBottomWidth: 1,
          borderColor: theme.border,
        }}
      >
        {headerLeading}
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          <Text style={{ color: theme.text, fontSize: 13, fontWeight: 600 }}>
            {channel.displayName}
          </Text>
          <Text
            testId="plugin-chat-status"
            style={{ color: status?.error ? theme.dangerText : theme.text2, fontSize: 11 }}
          >
            {`${channel.transportName} · ${statusText}${readOnly ? ' · Read-only' : ''}`}
          </Text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          <ActionButton onClick={onChangeChannel}>Channel</ActionButton>
          <ActionButton onClick={onSplitRight}>Split</ActionButton>
          <ActionButton onClick={onClosePanel}>Close</ActionButton>
        </div>
      </div>
      <PluginChatMessages messages={snapshot?.messages} />
      <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <FormError>{sanitizeDisplayText(sendError)}</FormError>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
          <input
            ref={input}
            testId="plugin-chat-input"
            aria-label="Plugin chat message or command"
            value={text}
            placeholder={writable ? 'Send a message' : 'Run a plugin command'}
            {...focus}
            onChange={(event) => setText(event.value ?? '')}
            onSubmit={() => void submit()}
            theme={{ caret: theme.link }}
            style={{
              flexGrow: 1,
              minWidth: 0,
              color: theme.text,
              fontSize: 13,
              padding: 6,
              borderRadius: 5,
              borderWidth: 1,
              borderColor: focused ? theme.link : theme.border,
              backgroundColor: theme.surface2,
            }}
          />
          <ActionButton
            testId="plugin-chat-send"
            primary
            disabled={!canSend || sending}
            onClick={() => void submit()}
          >
            {sending ? 'Sending…' : pluginCommand ? 'Run' : 'Send'}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
