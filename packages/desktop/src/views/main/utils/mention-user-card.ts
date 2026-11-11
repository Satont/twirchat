import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'

import type { MentionUser, MentionUserRequest } from '../../../services/mention-user'
import type { UserCardTarget } from './chatCommands'

interface MentionTargetRequest {
  message: NormalizedChatMessage
  username: string
  channelSlug?: string
  accounts: readonly Account[]
  messages: Iterable<NormalizedChatMessage>
  resolveUser: (request: MentionUserRequest) => Promise<MentionUser | null>
}

function normalizeUsername(username: string): string {
  return username.replace(/^@/, '').toLowerCase()
}

function mentionedAuthor(
  author:
    | Pick<
        NormalizedChatMessage['author'],
        'id' | 'username' | 'displayName' | 'avatarUrl' | 'color'
      >
    | undefined,
  username: string,
): MentionUser | undefined {
  return author?.id && author.username && normalizeUsername(author.username) === username
    ? {
        platformUserId: author.id,
        username: author.username,
        displayName: author.displayName,
        avatarUrl: author.avatarUrl,
        color: author.color,
      }
    : undefined
}

export async function resolveMentionTarget({
  message,
  username,
  channelSlug,
  accounts,
  messages,
  resolveUser,
}: MentionTargetRequest): Promise<UserCardTarget> {
  const query = normalizeUsername(username)
  let user =
    mentionedAuthor(message.author, query) ?? mentionedAuthor(message.reply?.parentAuthor, query)
  if (!user) {
    const account = accounts.find(
      (entry) => entry.platform === message.platform && normalizeUsername(entry.username) === query,
    )
    if (account)
      user = {
        platformUserId: account.platformUserId,
        username: account.username,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
      }
  }
  if (!user) {
    for (const known of messages) {
      if (known.platform !== message.platform) continue
      user =
        mentionedAuthor(known.author, query) ?? mentionedAuthor(known.reply?.parentAuthor, query)
      if (user) break
    }
  }
  user ??= (await resolveUser({ platform: message.platform, username })) ?? undefined
  if (!user) throw new Error(`Could not find @${username} on ${message.platform}.`)
  return {
    ...user,
    platform: message.platform,
    channelId: message.channelId,
    channelSlug,
  }
}
