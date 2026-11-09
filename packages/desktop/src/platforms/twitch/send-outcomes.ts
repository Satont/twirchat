import type { ChatClient } from '@twurple/chat'

import { t, type MessageKey } from '../../gpuix/i18n'

type Outcome = { kind: 'sent' | 'held' | 'disconnected' } | { kind: 'rejected'; reason: string }

type Settle = (outcome: Outcome) => void

const AUTO_MOD_HOLD_NOTICES = new Set(['msg_automod_held', 'msg_rejected'])

const REJECTIONS: Record<string, MessageKey> = {
  msg_ratelimit: 'misc.twitchSender.reject.ratelimit',
  msg_duplicate: 'misc.twitchSender.reject.duplicate',
  msg_subsonly: 'misc.twitchSender.reject.subsonly',
  msg_followersonly: 'misc.twitchSender.reject.followersonly',
  msg_followersonly_followed: 'misc.twitchSender.reject.followersonly',
  msg_followersonly_zero: 'misc.twitchSender.reject.followersonly',
  msg_emoteonly: 'misc.twitchSender.reject.emoteonly',
  msg_slowmode: 'misc.twitchSender.reject.slowmode',
  msg_r9k: 'misc.twitchSender.reject.r9k',
  msg_timedout: 'misc.twitchSender.reject.timedout',
  msg_banned: 'misc.twitchSender.reject.banned',
  msg_verified_email: 'misc.twitchSender.reject.verifiedEmail',
  msg_channel_blocked: 'misc.twitchSender.blocked',
  msg_rejected_mandatory: 'misc.twitchSender.blocked',
  no_permission: 'misc.twitchSender.reject.noPermission',
}

export function twitchSendRejection(reason: string): string {
  const key = Object.hasOwn(REJECTIONS, reason) ? REJECTIONS[reason] : undefined
  return key ? t(key) : reason
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
    if (reason && (AUTO_MOD_HOLD_NOTICES.has(reason) || Object.hasOwn(REJECTIONS, reason)))
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
      AUTO_MOD_HOLD_NOTICES.has(reason) ? { kind: 'held' } : { kind: 'rejected', reason },
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
