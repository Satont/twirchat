import type { ModerationOutcome, NormalizedChatMessage, NormalizedEvent } from './types'

export type YouTubeChatCredentials = { accessToken: string } | { apiKey: string }
export type YouTubeChatStatus = 'connecting' | 'connected' | 'disconnected' | 'error'
export interface YouTubeChatBatch {
  messages: NormalizedChatMessage[]
  events: NormalizedEvent[]
  moderation: ModerationOutcome[]
  ended?: boolean
}
export type YouTubeChatRelayEvent =
  | {
      type: 'ready'
      subscriptionId: string
      channelId: string
      videoId: string
      liveChatId: string
    }
  | { type: 'batch'; subscriptionId: string; batch: YouTubeChatBatch; nextPageToken?: string }
  | {
      type: 'status'
      subscriptionId: string
      status: YouTubeChatStatus
      error?: string
      terminal?: boolean
    }
