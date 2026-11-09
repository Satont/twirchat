/**
 * Twitch chat limits per account: 20 messages per 30 s, or 100 in channels where the account is
 * the broadcaster, a moderator or a VIP. Outside those channels Twitch also drops a message sent
 * within about a second of the previous one in the same channel. Messages over a limit are
 * dropped silently, so senders wait here instead.
 */
const WINDOW_MS = 30_000
const NORMAL_LIMIT = 20
const PRIVILEGED_LIMIT = 100
const NORMAL_SPACING_MS = 1_200

export interface SendClock {
  now(): number
  sleep(ms: number): Promise<void>
}

const systemClock: SendClock = { now: () => Date.now(), sleep: (ms) => Bun.sleep(ms) }

/** Broadcaster, moderator and VIP badges lift the per-channel spacing and raise the limit. */
export function hasPrivilegedChatRole(tags: ReadonlyMap<string, string>): boolean {
  if (tags.get('mod') === '1') return true
  return (tags.get('badges') ?? '')
    .split(',')
    .some((badge) => /^(broadcaster|moderator|vip)\//u.test(badge))
}

export class TwitchSendLimiter {
  private readonly sent: number[] = []
  private readonly lastByChannel = new Map<string, number>()
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly clock: SendClock = systemClock) {}

  /** Resolves when a message to `channel` can go out without Twitch dropping it. */
  acquire(channel: string, privileged: boolean): Promise<void> {
    const turn = this.tail.then(() =>
      this.wait(channel.replace(/^#/u, '').toLowerCase(), privileged),
    )
    this.tail = turn.catch(() => {})
    return turn
  }

  private delay(channel: string, privileged: boolean, now: number): number {
    while (this.sent.length > 0) {
      const oldest = this.sent[0]
      if (oldest === undefined || oldest > now - WINDOW_MS) break
      this.sent.shift()
    }
    const limit = privileged ? PRIVILEGED_LIMIT : NORMAL_LIMIT
    let delay = 0
    if (this.sent.length >= limit) {
      const blocking = this.sent[this.sent.length - limit]
      if (blocking !== undefined) delay = blocking + WINDOW_MS - now
    }
    const last = privileged ? undefined : this.lastByChannel.get(channel)
    if (last !== undefined) delay = Math.max(delay, last + NORMAL_SPACING_MS - now)
    return delay
  }

  private async wait(channel: string, privileged: boolean): Promise<void> {
    for (;;) {
      const delay = this.delay(channel, privileged, this.clock.now())
      if (delay <= 0) break
      // eslint-disable-next-line no-await-in-loop
      await this.clock.sleep(delay)
    }
    const now = this.clock.now()
    this.sent.push(now)
    if (this.sent.length > PRIVILEGED_LIMIT) this.sent.shift()
    for (const [key, at] of this.lastByChannel)
      if (at <= now - NORMAL_SPACING_MS) this.lastByChannel.delete(key)
    this.lastByChannel.set(channel, now)
  }
}

const limiters = new Map<string, TwitchSendLimiter>()

/** One limiter per account, shared by every connection that sends as that account. */
export function twitchSendLimiter(accountId: string): TwitchSendLimiter {
  let limiter = limiters.get(accountId)
  if (!limiter) {
    limiter = new TwitchSendLimiter()
    limiters.set(accountId, limiter)
  }
  return limiter
}

export function forgetTwitchSendLimiter(accountId: string): void {
  limiters.delete(accountId)
}
