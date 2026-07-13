import { ref } from 'vue'
import type {
  ModerationAction,
  ModerationOutcome,
  NormalizedChatMessage,
} from '@twirchat/shared/types'

export interface ResolvedModerationOutcome {
  action: ModerationAction
  label: string
}

export interface ModerationOutcomeStore {
  apply(outcome: ModerationOutcome): void
  outcomeFor(message: NormalizedChatMessage): ResolvedModerationOutcome | undefined
}

export function createModerationOutcomeStore(): ModerationOutcomeStore {
  const deletedMessages = new Map<string, ResolvedModerationOutcome>()
  const userSanctions = new Map<string, ResolvedModerationOutcome>()
  const revision = ref(0)

  function apply(outcome: ModerationOutcome): void {
    if (outcome.action === 'delete_message') {
      if (!outcome.messageId) return
      deletedMessages.set(messageKey(outcome.platform, outcome.messageId), {
        action: 'delete_message',
        label: '(message deleted)',
      })
      revision.value++
      return
    }

    if (!outcome.targetUserId) return
    const sanction = sanctionFor(outcome)
    if (!sanction) return
    userSanctions.set(userKey(outcome.platform, outcome.channelId, outcome.targetUserId), sanction)
    revision.value++
  }

  function outcomeFor(message: NormalizedChatMessage): ResolvedModerationOutcome | undefined {
    // Make render calls react to a live outcome without mutating the message.
    void revision.value
    return (
      deletedMessages.get(messageKey(message.platform, message.id)) ??
      userSanctions.get(userKey(message.platform, message.channelId, message.author.id))
    )
  }

  return { apply, outcomeFor }
}

function sanctionFor(outcome: ModerationOutcome): ResolvedModerationOutcome | undefined {
  if (outcome.action === 'ban') return { action: 'ban', label: '(banned)' }
  if (outcome.action !== 'timeout' || !isPositiveWholeNumber(outcome.durationSeconds))
    return undefined
  return { action: 'timeout', label: `(timed out for ${formatDuration(outcome.durationSeconds)})` }
}

function messageKey(platform: NormalizedChatMessage['platform'], messageID: string): string {
  return `${platform}:${messageID}`
}

function userKey(
  platform: NormalizedChatMessage['platform'],
  channelID: string,
  userID: string,
): string {
  return `${platform}:${normalize(channelID)}:${userID}`
}

function normalize(value: string): string {
  return value.trim().replace(/^#/, '').toLowerCase()
}

function isPositiveWholeNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
}

function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

const moderationOutcomes = createModerationOutcomeStore()

export function useModerationOutcomes(): ModerationOutcomeStore {
  return moderationOutcomes
}
