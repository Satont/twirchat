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

class TwitchAuthenticationError extends Error {}

/**
 * One authenticated chat connection per saved account that sends somewhere other than the
 * reading connection. A chat keeps reading with its own connection, so choosing another
 * account never reconnects it; that account's messages come back over the reading connection
 * with their real badges, colour and emotes.
 */
export function createTwitchSenderPool(dependencies: TwitchSenderDependencies) {
  const sessions = new Map<string, Promise<Session>>()
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

  function sessionFor(account: Pick<Account, 'id'>): Promise<Session> {
    const existing = sessions.get(account.id)
    if (existing) return existing
    const opening = open(account, false)
    sessions.set(account.id, opening)
    opening.catch(() => {
      if (sessions.get(account.id) === opening) sessions.delete(account.id)
    })
    return opening
  }

  function join(current: Session, channel: string): Promise<void> {
    const existing = current.channels.get(channel)
    if (existing) return existing.joined
    const joined = current.client.join(channel)
    current.channels.set(channel, { joined, tags: new Map() })
    joined.catch(() => {
      if (current.channels.get(channel)?.joined === joined) current.channels.delete(channel)
    })
    return joined
  }

  function close(current: Session): void {
    current.outcomes.clear()
    current.channels.clear()
    current.client.quit()
  }

  function forget(accountId: string): void {
    const pending = sessions.get(accountId)
    if (!pending) return
    sessions.delete(accountId)
    runInBackground(pending.then(close), 'Could not close a Twitch chat connection')
  }

  return {
    /** Connects the account and joins the channel ahead of the first message. */
    async prepare(account: Pick<Account, 'id'>, channel: string): Promise<void> {
      await join(await sessionFor(account), twitchIrcChannelName(channel))
    },

    async send(
      account: Pick<Account, 'id' | 'username'>,
      channel: string,
      text: string,
      replyTo?: string,
    ): Promise<void | ChatSendReceipt> {
      const name = twitchIrcChannelName(channel)
      const current = await sessionFor(account)
      await join(current, name)
      const state = current.channels.get(name)
      if (!state) throw new Error(t('misc.twitchSender.closedBeforeSending'))
      await dependencies.acquire(account.id, name, hasPrivilegedChatRole(state.tags))
      if (current.channels.get(name) !== state)
        throw new Error(t('misc.twitchSender.closedBeforeSending'))
      const outcome = await current.outcomes.send(name, () =>
        current.client.say(name, text, replyTo),
      )
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
    },

    /** Leaves the channel; the connection closes once no chat sends with the account. */
    release(accountId: string, channel: string): void {
      const pending = sessions.get(accountId)
      if (!pending) return
      const name = twitchIrcChannelName(channel)
      const leave = async () => {
        const current = await pending
        current.outcomes.clear(name)
        if (current.channels.delete(name)) current.client.part(name)
        if (current.channels.size === 0 && sessions.get(accountId) === pending) {
          sessions.delete(accountId)
          close(current)
        }
      }
      runInBackground(leave(), 'Could not leave a Twitch chat')
    },

    forget,

    dispose(): void {
      for (const accountId of sessions.keys()) forget(accountId)
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
      client.onConnect(handler)
    },
    onDisconnect: (handler) => {
      client.onDisconnect(handler)
    },
    onAuthenticationFailure: (handler) => {
      client.onAuthenticationFailure(() => handler())
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
