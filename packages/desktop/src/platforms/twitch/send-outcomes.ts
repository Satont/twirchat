import type { ChatClient } from '@twurple/chat'

type Outcome = { kind: 'sent' | 'held' | 'disconnected' } | { kind: 'rejected'; reason: string }

type Settle = (outcome: Outcome) => void

const REJECTIONS: Record<string, string> = {
  msg_ratelimit: 'you are sending messages too quickly',
  msg_duplicate: 'the same message was sent less than 30 seconds ago',
  msg_subsonly: 'the chat is in subscribers-only mode',
  msg_followersonly: 'the chat is in followers-only mode',
  msg_followersonly_followed: 'the chat is in followers-only mode',
  msg_followersonly_zero: 'the chat is in followers-only mode',
  msg_emoteonly: 'the chat is in emote-only mode',
  msg_slowmode: 'the chat is in slow mode, wait before sending again',
  msg_r9k: 'the chat is in unique-chat mode and the message is not unique',
  msg_timedout: 'the account is timed out in this chat',
  msg_banned: 'the account is banned in this chat',
  msg_verified_email: 'the chat requires a verified email',
  msg_channel_blocked: 'Twitch blocked the message',
  msg_rejected_mandatory: 'Twitch blocked the message',
  no_permission: 'the account lacks permission for this action',
}

export function twitchSendRejection(reason: string): string {
  return Object.hasOwn(REJECTIONS, reason) ? (REJECTIONS[reason] ?? reason) : reason
}

export function twitchIrcChannelName(channel: string): string {
  return channel.trim().replace(/^#/u, '').toLowerCase()
}

export function onTwitchSendRejected(
  client: ChatClient,
  handler: (channel: string, reason: string) => void,
): void {
  client.irc.onNotice((channel, _user, _text, message) => {
    // Twurple's onMessageFailed omits the notice for a held message.
    const reason = message.tags.get('msg-id')
    if (reason && (reason === 'msg_rejected' || Object.hasOwn(REJECTIONS, reason)))
      handler(channel, reason)
  })
}

/** Twitch IRC replies to sends in each channel without a client request ID. */
export class TwitchSendOutcomes {
  private readonly waiting = new Map<string, Set<Settle>>()

  constructor(private readonly timeoutMs = 2_500) {}

  async send(channel: string, write: () => Promise<void>): Promise<Outcome> {
    const name = twitchIrcChannelName(channel)
    const queue = this.waiting.get(name) ?? new Set<Settle>()
    const result = Promise.withResolvers<Outcome>()
    const remove = () => {
      if (queue.delete(settle) && queue.size === 0) this.waiting.delete(name)
    }
    const settle = (outcome: Outcome) => {
      remove()
      result.resolve(outcome)
    }
    queue.add(settle)
    this.waiting.set(name, queue)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await write()
      if (queue.has(settle)) timer = setTimeout(() => settle({ kind: 'sent' }), this.timeoutMs)
      return await result.promise
    } finally {
      clearTimeout(timer)
      remove()
    }
  }

  userState(channel: string, tags: ReadonlyMap<string, string>): void {
    // USERSTATE is also sent on JOIN. Only a send acknowledgment has a message ID.
    if (tags.get('id')) this.settle(channel, { kind: 'sent' })
  }

  rejected(channel: string, reason: string): void {
    this.settle(
      channel,
      reason === 'msg_rejected' ? { kind: 'held' } : { kind: 'rejected', reason },
    )
  }

  clear(channel?: string): void {
    if (channel !== undefined) {
      for (const settle of this.waiting.get(twitchIrcChannelName(channel)) ?? [])
        settle({ kind: 'disconnected' })
      return
    }
    for (const queue of this.waiting.values())
      for (const settle of queue) settle({ kind: 'disconnected' })
  }

  private settle(channel: string, outcome: Outcome): void {
    this.waiting.get(twitchIrcChannelName(channel))?.values().next().value?.(outcome)
  }
}
