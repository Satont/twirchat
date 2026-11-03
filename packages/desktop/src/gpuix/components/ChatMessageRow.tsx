import { memo } from 'react'

import { accent } from '../theme'
import { ChatMessage, type ChatMessageProps } from './ChatMessage'

interface ChatMessageRowProps extends ChatMessageProps {
  gray: boolean
  revealed: boolean
  onPauseDoubleClick?: () => void
}

export const ChatMessageRow = memo(function ChatMessageRow({
  gray,
  revealed,
  onPauseDoubleClick,
  ...messageProps
}: ChatMessageRowProps) {
  return (
    <div
      onMouseDown={
        onPauseDoubleClick
          ? (event) => {
              if (event.button === 0) onPauseDoubleClick()
            }
          : undefined
      }
      testId={revealed ? 'revealed-search-message' : undefined}
      style={{
        width: '100%',
        opacity: gray ? 0.55 : 1,
        ...(revealed ? { borderLeftWidth: 2, borderColor: accent.primary } : {}),
      }}
    >
      <ChatMessage {...messageProps} />
    </div>
  )
})
