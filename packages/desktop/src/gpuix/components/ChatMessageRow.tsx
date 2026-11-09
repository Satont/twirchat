import { memo } from 'react'

import { ChatMessage, type ChatMessageProps } from './ChatMessage'

interface ChatMessageRowProps extends ChatMessageProps {
  gray: boolean
  revealedColor?: string
  onPauseDoubleClick?: () => void
}

export const ChatMessageRow = memo(function ChatMessageRow({
  gray,
  revealedColor,
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
      testId={revealedColor ? 'revealed-search-message' : undefined}
      style={{
        width: '100%',
        opacity: gray ? 0.55 : 1,
        ...(revealedColor ? { borderLeftWidth: 2, borderColor: revealedColor } : {}),
      }}
    >
      <ChatMessage {...messageProps} />
    </div>
  )
})
