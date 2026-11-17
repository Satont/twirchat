import type { PublicInstance } from '@gpuix/react'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import type { HistoryUserTarget } from '@views/main/utils/history-display'
import type { ReactNode } from 'react'

export interface UserChatHistoryProps extends HistoryUserTarget {
  username?: string
  onViewport?: (viewport: PublicInstance | null) => void
}

export interface HistoryStateProps {
  minHeight: number
  error?: boolean
  children: ReactNode
}

export interface HistoryRetryButtonProps {
  onClick: () => void
}

export interface HistoryLoadOlderButtonProps {
  canLoad: boolean
  loading: boolean
  onClick: () => void
}

export interface HistoryMessageRowProps {
  message: NormalizedChatMessage
  visible: boolean
}
