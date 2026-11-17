import { chatMessageKey } from '@gpuix/chat-tools'
import { ChatMessage } from '@gpuix/components/ChatMessage'
import { platformColor } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { formatHistoryTimestamp } from '@views/main/utils/history-display'
import { memo } from 'react'

export const HistoryMessageRow = memo(function HistoryMessageRow({
  message,
  visible,
}: {
  message: NormalizedChatMessage
  visible: boolean
}) {
  const theme = useTheme()

  function getTypeColor(
    message: NormalizedChatMessage,
    theme: ReturnType<typeof useTheme>,
  ): string {
    if (message.type === 'action') return theme.link
    if (message.type === 'system') return theme.warningText
    return theme.text2
  }

  return (
    <div
      testId={`user-history-message-${chatMessageKey(message)}`}
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 10,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 12,
        paddingRight: 12,
        borderBottomWidth: 1,
        borderColor: theme.divider,
      }}
    >
      <div
        style={{
          width: 3,
          alignSelf: 'stretch',
          flexShrink: 0,
          borderRadius: 999,
          backgroundColor: platformColor(message.platform),
        }}
      />

      <div style={{ minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 4,
          }}
        >
          <div style={{ fontSize: 11, color: theme.text2 }}>
            {formatHistoryTimestamp(message.timestamp)}
          </div>
          <div
            style={{
              paddingTop: 1,
              paddingBottom: 1,
              paddingLeft: 6,
              paddingRight: 6,
              borderRadius: 999,
              backgroundColor: theme.fill,
            }}
          >
            <div style={{ fontSize: 11, color: theme.text2 }}>{message.channelId}</div>
          </div>
          <div
            style={{
              paddingTop: 1,
              paddingBottom: 1,
              paddingLeft: 6,
              paddingRight: 6,
              borderRadius: 999,
              backgroundColor: theme.fill,
            }}
          >
            <div style={{ fontSize: 11, color: getTypeColor(message, theme) }}>{message.type}</div>
          </div>
        </div>

        <ChatMessage
          message={message}
          channelSlug={message.channelId}
          chatTheme="compact"
          fontSize={13}
          showTimestamp={false}
          showAvatar={false}
          showPlatformColorStripe={false}
          visible={visible}
        />
      </div>
    </div>
  )
})
