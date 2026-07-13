/**
 * Moderation API exports
 *
 * Unified interface for both Twitch and Kick chat moderation actions.
 * Handles ban, timeout, message deletion, and moderator status checks.
 */

export * from './types.ts'
export * as Twitch from './twitch.ts'
export * as Kick from './kick.ts'

// Re-export error class for easy catching
export { ModerationException } from './types.ts'

/**
 * Moderation service facade (optional: can be extended with caching layer)
 */
export interface ModerationService {
  twitchBan: typeof import('./twitch.ts').banUser
  twitchDeleteMessage: typeof import('./twitch.ts').deleteMessage
  twitchIsModerator: typeof import('./twitch.ts').isModerator
  kickBan: typeof import('./kick.ts').banUser
  kickDeleteMessage: typeof import('./kick.ts').deleteMessage
}
