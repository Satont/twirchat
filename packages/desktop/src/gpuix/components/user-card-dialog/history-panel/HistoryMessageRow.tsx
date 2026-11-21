import { chatMessageKey } from '@gpuix/chat-tools'
import { ChatMessage } from '@gpuix/components/ChatMessage'
import { Text } from '@gpuix/components/ui/Text'
import { platformColor, type Theme } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { formatHistoryTimestamp } from '@views/main/utils/history-display'
import { memo, type ReactNode } from 'react'

import type { HistoryMessageRowProps } from './types'

function typeColor(message: NormalizedChatMessage, theme: Theme): string {
  if (message.type === 'action') return theme.link
  if (message.type === 'system') return theme.warningText
  return theme.text2
}

function HistoryMetaPill({ color, children }: { color: string; children: ReactNode }) {
  const theme = useTheme()
  return (
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
      <Text style={{ fontSize: 11, color }}>{children}</Text>
    </div>
  )
}

export const HistoryMessageRow = memo(function HistoryMessageRow({
  message,
  usernameDisplayMode,
  visible,
}: HistoryMessageRowProps) {
  const theme = useTheme()

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
          <Text style={{ fontSize: 11, color: theme.text2 }}>
            {formatHistoryTimestamp(message.timestamp)}
          </Text>
          <HistoryMetaPill color={theme.text2}>{message.channelId}</HistoryMetaPill>
          <HistoryMetaPill color={typeColor(message, theme)}>{message.type}</HistoryMetaPill>
        </div>

        <ChatMessage
          message={message}
          channelSlug={message.channelId}
          chatTheme="compact"
          fontSize={13}
          showTimestamp={false}
          showAvatar={false}
          showPlatformColorStripe={false}
          usernameDisplayMode={usernameDisplayMode}
          visible={visible}
        />
      </div>
    </div>
  )
})
