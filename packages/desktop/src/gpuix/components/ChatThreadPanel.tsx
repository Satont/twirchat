import type { AppSettings, NormalizedChatMessage } from '@twirchat/shared/types'
import { useCallback, useDeferredValue, useMemo, useState } from 'react'

import type { StreamerModeStatus } from '../../services/streamer-mode'
import type { UserCardTarget } from '../../views/main/utils/chatCommands'
import { selectTwitchThread } from '../chat-thread'
import { chatMessageKey } from '../chat-tools'
import { useT } from '../i18n'
import { isMessageHiddenForStreamer } from '../message-privacy'
import type { compileMessageRules } from '../message-rules'
import type { ModerationView } from '../state/app'
import { useOverlayClose } from '../state/overlays'
import { useTheme } from '../theme-context'
import { ChatMessage } from './ChatMessage'
import { ActionButton } from './ui/Form'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'

interface ChatThreadPanelProps {
  selected: NormalizedChatMessage
  messages: readonly NormalizedChatMessage[]
  channelSlug?: string
  settings: AppSettings | null
  ruleEngine: ReturnType<typeof compileMessageRules>
  moderationView: ModerationView
  streamerMode: StreamerModeStatus
  clearedKeys: ReadonlySet<string>
  aliases: ReadonlyMap<string, string>
  onClose: () => void
  onReply?: (message: NormalizedChatMessage) => void
  onMentionAuthor?: (message: NormalizedChatMessage) => void
  onOpenUserCard: (target: UserCardTarget) => void
}

export function ChatThreadPanel({
  selected,
  messages,
  channelSlug,
  settings,
  ruleEngine,
  moderationView,
  streamerMode,
  clearedKeys,
  aliases,
  onClose,
  onReply,
  onMentionAuthor,
  onOpenUserCard,
}: ChatThreadPanelProps) {
  const theme = useTheme()
  const { t } = useT()
  useOverlayClose(true, onClose)

  const deferredMessages = useDeferredValue(messages)
  const [snapshot, setSnapshot] = useState(() => ({
    source: deferredMessages,
    thread: selectTwitchThread(selected, deferredMessages),
  }))
  const { thread } = snapshot
  if (snapshot.source !== deferredMessages) {
    setSnapshot({
      source: deferredMessages,
      thread: selectTwitchThread(selected, deferredMessages, thread),
    })
  }
  const rootPreview = thread.root.kind === 'preview'
  const original =
    thread.root.kind === 'unavailable' || (rootPreview && streamerMode.effectiveEnabled)
      ? undefined
      : thread.root.message

  const visibleMessage = useCallback(
    (message: NormalizedChatMessage | undefined) => {
      if (
        !message ||
        clearedKeys.has(chatMessageKey(message)) ||
        isMessageHiddenForStreamer(message, streamerMode)
      ) {
        return undefined
      }
      const classification = ruleEngine.classify(message)
      if (classification.hidden) return undefined
      return {
        message: classification.message,
        moderationOutcome: moderationView.outcomeFor(message),
      }
    },
    [clearedKeys, moderationView, ruleEngine, streamerMode],
  )

  const originalRow = visibleMessage(original)
  const root = rootPreview && originalRow?.moderationOutcome?.isTombstone ? undefined : originalRow
  const selectedRow = visibleMessage(selected)
  const replyTarget =
    root && !rootPreview && !root.moderationOutcome?.isTombstone
      ? root.message
      : selectedRow && !selectedRow.moderationOutcome?.isTombstone
        ? selectedRow.message
        : undefined

  const renderMessage = useCallback(
    (row: NonNullable<ReturnType<typeof visibleMessage>>, preview = false) => (
      <ChatMessage
        message={row.message}
        moderationOutcome={row.moderationOutcome}
        alias={aliases.get(`twitch:${row.message.author.id}`)}
        channelSlug={channelSlug}
        showTimestamp={!preview && settings?.showTimestamp}
        timestampFormat={settings?.timestampFormat}
        showAvatar={!preview && settings?.showAvatars}
        showBadges={settings?.showBadges}
        showPlatformColorStripe={false}
        fontSize={settings?.fontSize}
        chatTheme={settings?.chatTheme}
        hideReplyPreview
        onReply={preview ? undefined : onReply}
        onMentionAuthor={preview ? undefined : onMentionAuthor}
        replyOnDoubleClick={settings?.replyOnDoubleClick}
        onOpenUserCard={onOpenUserCard}
      />
    ),
    [aliases, channelSlug, onMentionAuthor, onOpenUserCard, onReply, settings],
  )
  const replyRows = useMemo(
    () =>
      thread.replies.flatMap((reply) => {
        const row = visibleMessage(reply)
        if (!row) return []
        return (
          <div key={reply.id} testId={`chat-thread-reply-${reply.id}`} style={{ paddingLeft: 12 }}>
            <div style={{ borderLeftWidth: 1, borderColor: theme.divider }}>
              {renderMessage(row)}
            </div>
          </div>
        )
      }),
    [renderMessage, theme.divider, thread.replies, visibleMessage],
  )

  return (
    <div
      testId="chat-thread-panel"
      role="region"
      aria-label={t('chat.thread.title')}
      style={{
        position: 'absolute',
        right: 4,
        bottom: 0,
        width: '98%',
        maxWidth: 480,
        height: '68%',
        maxHeight: 340,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: theme.bg,
        borderWidth: 1,
        borderColor: theme.dialogBorder,
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          flexShrink: 0,
          paddingLeft: 12,
          paddingRight: 6,
          paddingTop: 3,
          paddingBottom: 3,
          borderBottomWidth: 1,
          borderColor: theme.divider,
          backgroundColor: theme.surface2,
        }}
      >
        <Text style={{ flexGrow: 1, fontSize: 13, fontWeight: 600, color: theme.text }}>
          {t('chat.thread.title')}
        </Text>
        <div
          testId="chat-thread-close"
          role="button"
          aria-label={t('common.close')}
          tabIndex={0}
          onClick={onClose}
          onKeyDown={(event) => {
            if (event.key === 'enter' || event.key === 'space') {
              event.preventDefault()
              onClose()
            }
          }}
          style={{
            width: 26,
            height: 26,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
            cursor: 'pointer',
            hover: { backgroundColor: theme.fillHover },
            focusVisible: { outlineWidth: 1, outlineColor: theme.link, outlineOffset: -2 },
          }}
        >
          <Icon name="close" size={14} color={theme.text2} />
        </div>
      </div>
      <virtual-list
        testId="chat-thread-messages"
        estimatedItemHeight={48}
        style={{ flexGrow: 1, minHeight: 0, scrollbarColor: theme.scrollbar, scrollbarWidth: 5 }}
      >
        <div key={thread.root.id} testId="chat-thread-root">
          {root ? (
            renderMessage(root, rootPreview)
          ) : (
            <Text style={{ padding: 12, fontSize: 12, color: theme.text2 }}>
              {t('chat.thread.originalUnavailable')}
            </Text>
          )}
        </div>
        {replyRows}
      </virtual-list>
      {onReply && replyTarget ? (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'flex-end',
            padding: 6,
            borderTopWidth: 1,
            borderColor: theme.divider,
          }}
        >
          <ActionButton testId="chat-thread-reply" onClick={() => onReply(replyTarget)}>
            {t('chatMessages.actions.reply')}
          </ActionButton>
        </div>
      ) : null}
    </div>
  )
}
