export interface TwitchHistoryRequest {
  channel: string
  limit: number
  before?: number
  beforeId?: string
  beforeIdInclusive?: boolean
  after?: number
  username?: string
  userId?: string
  archive?: boolean
  offset?: number
  text?: string
}

export interface TwitchHistorySource {
  id: string
  kind: 'recent' | 'archive'
  status: 'ok' | 'unavailable' | 'error'
  messages: number
  capabilities: Array<'recent' | 'user' | 'time'>
  error?: string
}

export interface TwitchHistoryResponse {
  messages: string[]
  sources: TwitchHistorySource[]
  partial: boolean
  truncated: boolean
}
