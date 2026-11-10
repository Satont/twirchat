import { memo } from 'react'

import { PaneAccountContext } from '../pane-account-context'
import { ChatMessage, type ChatMessageProps } from './ChatMessage'

interface ChatMessageRowProps extends ChatMessageProps {
  gray: boolean
  revealedColor?: string
  onPauseDoubleClick?: () => void
  sourceAccountId?: string
}

export const ChatMessageRow = memo(function ChatMessageRow({
  gray,
  revealedColor,
  onPauseDoubleClick,
  sourceAccountId,
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
      {sourceAccountId ? (
        <PaneAccountContext.Provider value={sourceAccountId}>
          <ChatMessage {...messageProps} />
        </PaneAccountContext.Provider>
      ) : (
        <ChatMessage {...messageProps} />
      )}
    </div>
  )
})
