export interface TwitchPollChoice {
  id: string
  title: string
  votes: number
  pointsVotes?: number
}
export interface TwitchPoll {
  id: string
  title: string
  status: string
  choices: TwitchPollChoice[]
  startedAt?: string
  endsAt?: string
  duration?: number
}
export interface TwitchPredictionOutcome {
  id: string
  title: string
  color?: string
  users?: number
  points?: number
}
export interface TwitchPrediction {
  id: string
  title: string
  status: string
  outcomes: TwitchPredictionOutcome[]
  startedAt?: string
  locksAt?: string
  winningOutcomeId?: string
}
export interface TwitchReward {
  id: string
  title: string
  cost: number
  prompt?: string
  isEnabled: boolean
  isPaused: boolean
  isInputRequired?: boolean
  manageable?: boolean
  imageUrl?: string
}
export interface TwitchPinnedMessage {
  id: string
  messageId: string
  text: string
  authorName?: string
  pinnedAt?: string
  expiresAt?: string
}
export interface TwitchActivitiesSnapshot {
  channelId: string
  channelSlug: string
  polls: TwitchPoll[]
  predictions: TwitchPrediction[]
  rewards: TwitchReward[]
  pinnedMessage: TwitchPinnedMessage | null
  pointsBalance?: number
  errors: Partial<
    Record<'polls' | 'predictions' | 'rewards' | 'pinnedMessage' | 'pointsBalance', string>
  >
}
export interface TwitchRedemption {
  id: string
  rewardId: string
  userId: string
  userName: string
  input: string
  status: string
  redeemedAt: string
}
export interface TwitchRedemptionsPage {
  redemptions: TwitchRedemption[]
  cursor?: string
}
export interface TwitchRewardQueueSummary {
  rewards: (TwitchReward & { pendingCount: number })[]
}
export type TwitchActivitySnapshotPart =
  | 'polls'
  | 'predictions'
  | 'rewards'
  | 'pinnedMessage'
  | 'pointsBalance'
export interface TwitchActivitySnapshotUpdate {
  channelSlug: string
  snapshot: TwitchActivitiesSnapshot
  sections?: TwitchActivitySnapshotPart[]
}
export interface TwitchActivityCapability {
  channelSlug: string
  mode: 'eventsub' | 'snapshot' | 'unavailable'
  snapshotSections: TwitchActivitySnapshotPart[]
  intervalMs?: number
  error?: string
}
export interface TwitchFollowedChannel {
  id: string
  login: string
  displayName: string
  isLive: boolean
  title?: string
  viewerCount?: number
  categoryName?: string
}
export interface TwitchFollowingPage {
  channels: TwitchFollowedChannel[]
  cursor?: string
  total?: number
}
export interface TwitchWebSessionStatus {
  configured: boolean
  userId?: string
  username?: string
}
export interface TwitchWebSession {
  token: string
  userId: string
  username: string
  clientId: string
}
export type TwitchActivityAction = { channelSlug: string } & (
  | {
      action: 'create_poll'
      title: string
      choices: string[]
      duration: number
      pointsPerVote?: number
    }
  | { action: 'end_poll' | 'archive_poll'; pollId: string }
  | {
      action: 'vote_poll'
      pollId: string
      choiceId: string
      votes?: number
      pointsPerVote?: number
    }
  | { action: 'create_prediction'; title: string; outcomes: string[]; duration: number }
  | { action: 'lock_prediction' | 'cancel_prediction'; predictionId: string }
  | { action: 'resolve_prediction'; predictionId: string; outcomeId: string }
  | { action: 'place_bet'; predictionId: string; outcomeId: string; points: number }
  | { action: 'pin_message'; messageId: string; duration?: number }
  | { action: 'update_pin'; messageId: string; duration?: number }
  | { action: 'unpin_message'; messageId: string }
  | {
      action: 'update_reward'
      rewardId: string
      patch: {
        title?: string
        cost?: number
        prompt?: string
        isEnabled?: boolean
        isPaused?: boolean
      }
    }
  | {
      action: 'update_redemptions'
      rewardId: string
      ids: string[]
      status: 'FULFILLED' | 'CANCELED'
    }
  | { action: 'redeem_reward'; rewardId: string; rewardTitle: string; cost: number; input?: string }
  | { action: 'follow' | 'unfollow' }
  | { action: 'add_editor' | 'remove_editor'; username: string }
  | { action: 'assign_lead_moderator' | 'unassign_lead_moderator'; userId: string }
  | { action: 'send_whisper'; username: string; text: string }
)
export interface TwitchActivityEvent {
  type: 'poll' | 'prediction' | 'reward' | 'redemption' | 'pin' | 'follow' | 'stream'
  channelId: string
  eventType: string
  data: Record<string, unknown>
}
export interface TwitchWhisper {
  id: string
  fromUserId: string
  fromLogin: string
  fromDisplayName: string
  toUserId: string
  text: string
  at: string
}
export interface TwitchEventSubStatus {
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  message?: string
}
export interface TwitchEventSubscription {
  id: string
  type: string
  condition: Record<string, string>
}
