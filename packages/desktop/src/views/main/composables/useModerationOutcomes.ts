import { ref } from 'vue'
import type {
  ModerationAction,
  ModerationOutcome,
  NormalizedChatMessage,
} from '@twirchat/shared/types'

export interface ResolvedModerationOutcome {
  action: ModerationAction
  isTombstone?: boolean
  label: string
}

export interface ModerationOutcomeStore {
  apply(outcome: ModerationOutcome): void
  outcomeFor(message: NormalizedChatMessage): ResolvedModerationOutcome | undefined
}

const DELETED_MESSAGE_RETENTION_MS = 300_000

type RetainedDeletion = {
  expiresAt: number
  resolved: ResolvedModerationOutcome
}

export function createModerationOutcomeStore(now: () => number = Date.now): ModerationOutcomeStore {
  const deletedMessages = new Map<string, RetainedDeletion>()
  const userSanctions = new Map<string, ResolvedModerationOutcome>()
  const revision = ref(0)

  function apply(outcome: ModerationOutcome): void {
    pruneExpiredDeletions()

    if (outcome.action === 'delete_message') {
      if (!outcome.messageId) return
      const key = messageKey(outcome.platform, outcome.messageId)
      const retained: RetainedDeletion = {
        expiresAt: now() + DELETED_MESSAGE_RETENTION_MS,
        resolved: { action: 'delete_message', isTombstone: true, label: '(message deleted)' },
      }
      deletedMessages.set(key, retained)
      setTimeout(() => {
        if (deletedMessages.get(key) === retained && pruneExpiredDeletions()) revision.value++
      }, DELETED_MESSAGE_RETENTION_MS)
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
    if (pruneExpiredDeletions()) revision.value++
    return (
      deletedMessages.get(messageKey(message.platform, message.id))?.resolved ??
      userSanctions.get(userKey(message.platform, message.channelId, message.author.id))
    )
  }

  function pruneExpiredDeletions(): boolean {
    const timestamp = now()
    let changed = false
    for (const [key, retained] of deletedMessages) {
      if (retained.expiresAt > timestamp) continue
      deletedMessages.delete(key)
      changed = true
    }
    return changed
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
