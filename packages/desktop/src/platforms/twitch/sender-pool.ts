import { logger } from '@twirchat/shared/logger'
import type { Account, ChatSendReceipt } from '@twirchat/shared/types'
import { StaticAuthProvider } from '@twurple/auth'
import { ChatClient, LogLevel, UserState } from '@twurple/chat'

import { refreshTwitchToken } from '../../auth/twitch'
import { t } from '../../gpuix/i18n'
import { runInBackground } from '../../services/background-task'
import { AccountStore } from '../../store/account-store'
import { hasPrivilegedChatRole, twitchSendLimiter } from './send-limiter'
import {
  onTwitchSendRejected,
  twitchIrcChannelName,
  TwitchSendOutcomes,
  twitchSendRejection,
} from './send-outcomes'

const log = logger('twitch-senders')

/** The part of a Twitch chat connection a sender needs; tests substitute a fixture. */
export interface TwitchSenderClient {
  connect(): void
  quit(): void
  join(channel: string): Promise<void>
  part(channel: string): void
  say(channel: string, text: string, replyTo?: string): Promise<void>
  onConnect(handler: () => void): void
  onDisconnect(handler: () => void): void
  onAuthenticationFailure(handler: () => void): void
  /** USERSTATE: Twitch's reply to a JOIN and to every accepted message. */
  onUserState(handler: (channel: string, tags: ReadonlyMap<string, string>) => void): void
  /** A NOTICE rejecting or holding a message, by its `msg-id`. */
  onRejected(handler: (channel: string, reason: string) => void): void
}

export interface TwitchSenderDependencies {
  token(accountId: string): Promise<string>
  refreshToken(accountId: string): Promise<string>
  createClient(token: string): TwitchSenderClient
  acquire(accountId: string, channel: string, privileged: boolean): Promise<void>
  connectTimeoutMs?: number
  outcomeTimeoutMs?: number
}

interface ChannelState {
  joined: Promise<void>
  tags: ReadonlyMap<string, string>
}

interface Session {
  client: TwitchSenderClient
  channels: Map<string, ChannelState>
  outcomes: TwitchSendOutcomes
}

interface ChannelUse {
  owners: number
  temporarySends: number
}

interface SenderEntry {
  channels: Map<string, ChannelUse>
  opening?: Promise<Session>
}

class TwitchAuthenticationError extends Error {}

/**
 * One writer per sending account. Twitch only broadcasts PRIVMSG to the other
 * connections, so every chat reads on its own connection.
 */
export function createTwitchSenderPool(dependencies: TwitchSenderDependencies) {
  const entries = new Map<string, SenderEntry>()
  const connectTimeoutMs = dependencies.connectTimeoutMs ?? 10_000

  async function open(account: Pick<Account, 'id'>, refreshed: boolean): Promise<Session> {
    const token = refreshed
      ? await dependencies.refreshToken(account.id)
      : await dependencies.token(account.id)
    const client = dependencies.createClient(token)
    const session: Session = {
      client,
      channels: new Map(),
      outcomes: new TwitchSendOutcomes(dependencies.outcomeTimeoutMs),
    }
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(t('misc.twitchSender.connectionTimeout'))),
        connectTimeoutMs,
      )
      client.onConnect(() => {
        clearTimeout(timer)
        resolve()
      })
      client.onAuthenticationFailure(() => {
        clearTimeout(timer)
        reject(new TwitchAuthenticationError(t('misc.twitchSender.credentialsRejected')))
      })
    })
    client.onUserState((channel, tags) => {
      const name = twitchIrcChannelName(channel)
      const state = session.channels.get(name)
      if (state) state.tags = tags
      session.outcomes.userState(name, tags)
    })
    client.onRejected((channel, reason) => session.outcomes.rejected(channel, reason))
    client.onDisconnect(() => session.outcomes.clear())
    client.connect()
    try {
      await connected
    } catch (error) {
      client.quit()
      if (error instanceof TwitchAuthenticationError && !refreshed) return open(account, true)
      throw error
    }
    return session
  }

  function entryFor(accountId: string): SenderEntry {
    const existing = entries.get(accountId)
    if (existing) return existing
    const entry: SenderEntry = { channels: new Map() }
    entries.set(accountId, entry)
    return entry
  }

  function channelFor(entry: SenderEntry, name: string): ChannelUse {
    const existing = entry.channels.get(name)
    if (existing) return existing
    const channel: ChannelUse = { owners: 0, temporarySends: 0 }
    entry.channels.set(name, channel)
    return channel
  }

  function sessionFor(account: Pick<Account, 'id'>, entry: SenderEntry): Promise<Session> {
    if (entry.opening) return entry.opening
    const opening = open(account, false)
    entry.opening = opening
    opening.catch(() => {
      if (entry.opening === opening) entry.opening = undefined
    })
    return opening
  }

  async function join(current: Session, channel: string): Promise<ChannelState> {
    let state = current.channels.get(channel)
    if (!state) {
      const joined = current.client.join(channel)
      state = { joined, tags: new Map() }
      current.channels.set(channel, state)
      joined.catch(() => {
        if (current.channels.get(channel)?.joined === joined) current.channels.delete(channel)
      })
    }
    await state.joined
    return state
  }

  function close(current: Session): void {
    current.outcomes.clear()
    current.channels.clear()
    current.client.quit()
  }

  function invalidate(accountId: string): void {
    const entry = entries.get(accountId)
    if (!entry?.opening) return
    const opening = entry.opening
    entry.opening = undefined
    runInBackground(
      opening.then(close, () => {}),
      'Could not close a Twitch chat connection',
    )
  }

  function forget(accountId: string): void {
    invalidate(accountId)
    entries.delete(accountId)
  }

  function releaseChannel(
    accountId: string,
    entry: SenderEntry,
    name: string,
    use: ChannelUse,
  ): void {
    if (use.owners || use.temporarySends || entries.get(accountId) !== entry) return
    entry.channels.delete(name)
    if (entry.channels.size === 0) {
      forget(accountId)
      return
    }
    if (!entry.opening) return
    const leave = (current: Session) => {
      if (entry.channels.has(name)) return
      current.outcomes.clear(name)
      if (current.channels.delete(name)) current.client.part(name)
    }
    runInBackground(
      entry.opening.then(leave, () => {}),
      'Could not leave a Twitch chat',
    )
  }

  function retain(accountId: string, channel: string): void {
    channelFor(entryFor(accountId), twitchIrcChannelName(channel)).owners++
  }

  /** Connects the account and joins a retained channel; repeated calls reuse both. */
  async function warm(account: Pick<Account, 'id'>, channel: string): Promise<void> {
    const name = twitchIrcChannelName(channel)
    const entry = entries.get(account.id)
    const use = entry?.channels.get(name)
    if (!entry || !use?.owners) return
    const opening = sessionFor(account, entry)
    const current = await opening
    if (
      entries.get(account.id) === entry &&
      entry.channels.get(name) === use &&
      entry.opening === opening
    )
      await join(current, name)
  }

  return {
    /** Holds a writer channel for a chat without opening a connection yet. */
    retain,

    warm,

    /** Connects the account and joins the channel ahead of the first message. */
    async prepare(account: Pick<Account, 'id'>, channel: string): Promise<void> {
      retain(account.id, channel)
      await warm(account, channel)
    },

    async send(
      account: Pick<Account, 'id' | 'username'>,
      channel: string,
      text: string,
      replyTo?: string,
      beforeWrite?: () => void,
    ): Promise<void | ChatSendReceipt> {
      const name = twitchIrcChannelName(channel)
      const entry = entryFor(account.id)
      const use = channelFor(entry, name)
      const temporary = use.owners === 0
      if (temporary) use.temporarySends++
      try {
        const opening = sessionFor(account, entry)
        const assertChannelOpen = () => {
          if (
            entries.get(account.id) !== entry ||
            entry.channels.get(name) !== use ||
            entry.opening !== opening
          )
            throw new Error(t('misc.twitchSender.closedBeforeSending'))
        }
        const current = await opening
        assertChannelOpen()
        const state = await join(current, name)
        await dependencies.acquire(account.id, name, hasPrivilegedChatRole(state.tags))
        const outcome = await current.outcomes.send(name, () => {
          assertChannelOpen()
          beforeWrite?.()
          return current.client.say(name, text, replyTo)
        })
        if (outcome.kind === 'held') return { channelId: name, held: true }
        if (outcome.kind === 'disconnected')
          throw new Error(t('misc.twitchSender.disconnectedBeforeDelivery'))
        if (outcome.kind === 'rejected')
          throw new Error(
            t('misc.twitchSender.notSent', {
              name: account.username,
              reason: twitchSendRejection(outcome.reason),
            }),
          )
      } finally {
        if (temporary) {
          use.temporarySends--
          releaseChannel(account.id, entry, name, use)
        }
      }
    },

    /** Leaves the channel; the connection closes once no chat sends with the account. */
    release(accountId: string, channel: string): void {
      const name = twitchIrcChannelName(channel)
      const entry = entries.get(accountId)
      const use = entry?.channels.get(name)
      if (!entry || !use?.owners) return
      use.owners--
      releaseChannel(accountId, entry, name, use)
    },

    invalidate,
    forget,

    dispose(): void {
      for (const accountId of entries.keys()) forget(accountId)
    },
  }
}

export type TwitchSenderPool = ReturnType<typeof createTwitchSenderPool>

async function storedToken(accountId: string): Promise<string> {
  const tokens = AccountStore.getTokens(accountId)
  if (!tokens?.accessToken) throw new Error(t('misc.twitchSender.signInAgain'))
  if (tokens.expiresAt && tokens.expiresAt < Math.floor(Date.now() / 1000) + 300)
    return refreshTwitchToken(accountId)
  return tokens.accessToken
}

function twurpleSender(token: string): TwitchSenderClient {
  const client = new ChatClient({
    authProvider: new StaticAuthProvider('twirchat-desktop', token, ['chat:read', 'chat:edit']),
    channels: [],
    // Limits are enforced per account by the send limiter, with the account's role per channel.
    isAlwaysMod: true,
    logger: {
      custom: (level, message) => {
        if (level === LogLevel.ERROR) log.error(`[Twurple] ${message}`)
        else if (level === LogLevel.WARNING) log.warn(`[Twurple] ${message}`)
      },
    },
  })
  return {
    connect: () => client.connect(),
    quit: () => client.quit(),
    join: (channel) => client.join(channel),
    part: (channel) => client.part(channel),
    say: (channel, text, replyTo) => client.say(channel, text, replyTo ? { replyTo } : {}),
    onConnect: (handler) => {
      client.onAuthenticationSuccess(handler)
    },
    onDisconnect: (handler) => {
      client.onDisconnect(handler)
    },
    onAuthenticationFailure: (handler) => {
      client.onAuthenticationFailure(() => handler())
      client.onTokenFetchFailure(() => handler())
    },
    onUserState: (handler) => {
      client.irc.onTypedMessage(UserState, (message) =>
        handler(message.channel, new Map(message.tags)),
      )
    },
    onRejected: (handler) => onTwitchSendRejected(client, handler),
  }
}

export function createDefaultTwitchSenderPool(): TwitchSenderPool {
  return createTwitchSenderPool({
    token: storedToken,
    refreshToken: refreshTwitchToken,
    createClient: twurpleSender,
    acquire: (accountId, channel, privileged) =>
      twitchSendLimiter(accountId).acquire(channel, privileged),
  })
}
