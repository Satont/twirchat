import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Account, Platform, WatchedChannelsLayout } from '@twirchat/shared/types'

import { resolveChatAccount } from '../src/gpuix/chat-account'
import { tabSenderAccounts } from '../src/gpuix/state/pane-accounts'
import { BasePlatformAdapter } from '../src/platforms/base-adapter'
import {
  hasPrivilegedChatRole,
  TwitchSendLimiter,
  type SendClock,
} from '../src/platforms/twitch/send-limiter'
import {
  createTwitchSenderPool,
  type TwitchSenderClient,
} from '../src/platforms/twitch/sender-pool'
import { channelAccount, chatAccount, chatSender } from '../src/services/chat-accounts'
import { sevenTVService } from '../src/seventv'
import { AccountStore } from '../src/store/account-store'
import { getDb, initDb } from '../src/store/db'
import { WatchedChannelStore } from '../src/store/watched-channels-store'
import type { ChatAccountSender } from '../src/watched-channels/account-sender'
import { WatchedChannelManager } from '../src/watched-channels/manager'
import { literal, required } from './fixture-values'

let directory = ''
let path = ''
const oldSend = sevenTVService.sendToBackend
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'twirchat-chat-accounts-'))
  path = join(directory, 'db.sqlite')
  initDb(path)
  sevenTVService.sendToBackend = () => {}
})
afterEach(() => {
  sevenTVService.sendToBackend = oldSend
  getDb().close()
  rmSync(directory, { recursive: true, force: true })
})

function save(platform: Platform, id: string, select = true): Account {
  AccountStore.upsert({
    id: `${platform}:${id}`,
    platform,
    platformUserId: id,
    username: `user${id}`,
    displayName: `User ${id}`,
    accessToken: `token-${id}`,
  })
  if (select) AccountStore.setActive(platform, `${platform}:${id}`)
  return required(AccountStore.findById(`${platform}:${id}`))
}

test('a chat keeps its own saved account across restart and falls back when it is forgotten', () => {
  const main = save('twitch', 'main')
  const alt = save('twitch', 'alt', false)
  const channel = WatchedChannelStore.upsert('twitch', 'Pixelfox', 'pixelfox')
  expect(chatAccount(channel)?.id).toBe(main.id)

  WatchedChannelStore.setAccount(channel.id, alt.id)
  getDb().close()
  initDb(path)
  const reloaded = required(WatchedChannelStore.findById(channel.id))
  expect(reloaded.accountId).toBe(alt.id)
  expect(chatAccount(reloaded)?.id).toBe(alt.id)
  expect(channelAccount('twitch', 'PIXELFOX')?.id).toBe(alt.id)
  expect(channelAccount('twitch', 'someone-else')?.id).toBe(main.id)

  expect(WatchedChannelStore.releaseAccount(alt.id)).toEqual([channel.id])
  const released = required(WatchedChannelStore.findById(channel.id))
  expect(released.accountId).toBeUndefined()
  expect(chatAccount(released)?.id).toBe(main.id)
})

test('only a chosen account other than the default gets its own sending connection', () => {
  const main = save('twitch', 'main')
  const alt = save('twitch', 'alt', false)
  const kick = save('kick', 'kick')
  expect(chatSender({ platform: 'twitch' })).toBeNull()
  expect(chatSender({ platform: 'twitch', accountId: main.id })).toBeNull()
  expect(chatSender({ platform: 'twitch', accountId: alt.id })?.id).toBe(alt.id)
  expect(chatSender({ platform: 'twitch', accountId: kick.id })).toBeNull()
  expect(chatSender({ platform: 'twitch', accountId: 'twitch:gone' })).toBeNull()
  expect(chatSender({ platform: 'youtube', accountId: alt.id })).toBeNull()
  // Making the chosen account the default moves its sends back through the adapter.
  AccountStore.setActive('twitch', alt.id)
  expect(chatSender({ platform: 'twitch', accountId: alt.id })).toBeNull()
})

test('existing databases gain the chat account column without losing chats', () => {
  getDb().close()
  rmSync(path)
  const legacy = new Database(path)
  legacy.run(`CREATE TABLE watched_channels (
    id TEXT PRIMARY KEY, platform TEXT NOT NULL, channel_slug TEXT NOT NULL,
    display_name TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE (platform, channel_slug))`)
  legacy.run(
    "INSERT INTO watched_channels (id, platform, channel_slug, display_name) VALUES ('w', 'twitch', 'old', 'Old')",
  )
  legacy.close()
  initDb(path)
  expect(required(WatchedChannelStore.findById('w')).accountId).toBeUndefined()
  WatchedChannelStore.setAccount('w', 'twitch:x')
  expect(WatchedChannelStore.findById('w')?.accountId).toBe('twitch:x')
})

class ReadingAdapter extends BasePlatformAdapter {
  readonly platform = literal('twitch')
  connects = 0
  sent: string[] = []
  async connect() {
    this.connects++
  }
  async disconnect() {}
  async sendMessage(_channel: string, text: string) {
    this.sent.push(text)
  }
}

function fixtureSender() {
  const log: string[] = []
  const sender: ChatAccountSender = {
    prepare: async (account, channel) => {
      log.push(`prepare ${account.id} ${channel.channelSlug}`)
    },
    send: async (account, channel, _adapter, text) => {
      log.push(`send ${account.id} ${channel.channelSlug} ${text}`)
    },
    release: (accountId, channel) => {
      log.push(`release ${accountId} ${channel.channelSlug}`)
    },
  }
  return { sender, log }
}

test('choosing an account keeps the chat connected and sends with that account', async () => {
  save('twitch', 'main')
  const alt = save('twitch', 'alt', false)
  const adapters = new Map<string, ReadingAdapter>()
  const { sender, log } = fixtureSender()
  const manager = new WatchedChannelManager(
    (message) => message,
    (channel) => {
      const adapter = new ReadingAdapter()
      adapters.set(channel.channelSlug, adapter)
      return adapter
    },
    sender,
  )
  const first = await manager.addChannel('twitch', 'first')
  const second = await manager.addChannel('twitch', 'second')
  await manager.setActiveChannels([first.id, second.id])

  expect(manager.setChannelAccount(first.id, alt.id).accountId).toBe(alt.id)
  await Bun.sleep(0)
  expect(required(adapters.get('first')).connects).toBe(1)
  await manager.sendMessage(first.id, 'hello')
  await manager.sendMessage(second.id, 'plain')
  expect(required(adapters.get('first')).sent).toEqual([])
  expect(required(adapters.get('second')).sent).toEqual(['plain'])

  manager.setChannelAccount(first.id, null)
  await manager.sendMessage(first.id, 'back')
  expect(required(adapters.get('first')).sent).toEqual(['back'])
  expect(log).toEqual([
    'prepare twitch:alt first',
    'send twitch:alt first hello',
    'release twitch:alt first',
  ])
})

test('forgetting or stopping a chat releases its sending connection', async () => {
  save('twitch', 'main')
  const alt = save('twitch', 'alt', false)
  const { sender, log } = fixtureSender()
  const manager = new WatchedChannelManager(
    (message) => message,
    () => new ReadingAdapter(),
    sender,
  )
  const first = await manager.addChannel('twitch', 'first')
  const second = await manager.addChannel('twitch', 'second')
  WatchedChannelStore.setAccount(first.id, alt.id)
  WatchedChannelStore.setAccount(second.id, alt.id)
  await manager.setActiveChannels([first.id, second.id])
  await manager.setActiveChannels([second.id])
  AccountStore.delete(alt.id)
  manager.releaseAccount(alt.id)
  expect(manager.getAll().map((channel) => channel.accountId)).toEqual([undefined, undefined])
  expect(log).toEqual([
    'prepare twitch:alt first',
    'prepare twitch:alt second',
    'release twitch:alt first',
    'release twitch:alt second',
  ])
})

function fakeClock() {
  let now = 0
  const clock: SendClock = {
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
  }
  return { clock, now: () => now }
}

test('the send limiter follows Twitch spacing and window limits by role', async () => {
  const { clock, now } = fakeClock()
  const limiter = new TwitchSendLimiter(clock)
  await limiter.acquire('#Chan', false)
  await limiter.acquire('chan', false)
  expect(now()).toBe(1_200)
  await limiter.acquire('other', false)
  expect(now()).toBe(1_200)
  await limiter.acquire('chan', true)
  await limiter.acquire('chan', true)
  expect(now()).toBe(1_200)

  const window = fakeClock()
  const busy = new TwitchSendLimiter(window.clock)
  await Promise.all(Array.from({ length: 20 }, (_, index) => busy.acquire(`c${index}`, false)))
  expect(window.now()).toBe(0)
  await busy.acquire('c-last', false)
  expect(window.now()).toBe(30_000)
  await Promise.all(Array.from({ length: 79 }, () => busy.acquire('mod', true)))
  expect(window.now()).toBe(30_000)

  expect(hasPrivilegedChatRole(new Map([['badges', 'vip/1,subscriber/12']]))).toBe(true)
  expect(hasPrivilegedChatRole(new Map([['mod', '1']]))).toBe(true)
  expect(hasPrivilegedChatRole(new Map([['badges', 'subscriber/12']]))).toBe(false)
})

class FixtureClient implements TwitchSenderClient {
  connected = false
  closed = false
  joins: string[] = []
  parts: string[] = []
  said: string[] = []
  private connectHandler = () => {}
  private authHandler = () => {}
  userState: (channel: string, tags: ReadonlyMap<string, string>) => void = () => {}
  rejected: (channel: string, reason: string) => void = () => {}
  constructor(
    readonly token: string,
    private readonly reply: (client: FixtureClient, channel: string) => void,
  ) {}
  connect() {
    queueMicrotask(() => (this.token === 'bad' ? this.authHandler() : this.connectHandler()))
  }
  quit() {
    this.closed = true
  }
  async join(channel: string) {
    this.joins.push(channel)
  }
  part(channel: string) {
    this.parts.push(channel)
  }
  async say(channel: string, text: string) {
    this.said.push(`${channel}:${text}`)
    queueMicrotask(() => this.reply(this, channel))
  }
  onConnect(handler: () => void) {
    this.connectHandler = handler
  }
  onDisconnect() {}
  onAuthenticationFailure(handler: () => void) {
    this.authHandler = handler
  }
  onUserState(handler: (channel: string, tags: ReadonlyMap<string, string>) => void) {
    this.userState = handler
  }
  onRejected(handler: (channel: string, reason: string) => void) {
    this.rejected = handler
  }
}

test('a sending connection joins once, confirms through USERSTATE and reports NOTICE rejections', async () => {
  const clients: FixtureClient[] = []
  const acquired: string[] = []
  let token = 'bad'
  const pool = createTwitchSenderPool({
    token: async () => token,
    refreshToken: async () => {
      token = 'fresh'
      return token
    },
    createClient: (value) => {
      const client = new FixtureClient(value, (fixture, channel) => {
        const sent = fixture.said.at(-1)
        if (sent?.endsWith('silent')) return
        if (sent?.endsWith('held')) fixture.rejected(`#${channel}`, 'msg_rejected')
        else if (sent?.endsWith('dupe')) fixture.rejected(channel, 'msg_duplicate')
        else
          fixture.userState(
            `#${channel}`,
            new Map([
              ['badges', 'moderator/1'],
              ['id', 'sent-message'],
            ]),
          )
      })
      clients.push(client)
      return client
    },
    acquire: async (_account, channel, privileged) => {
      acquired.push(`${channel}:${privileged}`)
    },
    outcomeTimeoutMs: 50,
  })
  const alt = { id: 'twitch:alt', username: 'useralt' }

  pool.retain(alt.id, 'pixelfox')
  await pool.prepare(alt, '#Pixelfox')
  await pool.send(alt, 'pixelfox', 'hello')
  await pool.send(alt, 'pixelfox', 'again')
  await expect(pool.send(alt, 'pixelfox', 'dupe')).rejects.toThrow(
    'Twitch did not send the message from @useralt: the same message was sent less than 30 seconds ago.',
  )
  await pool.send(alt, 'pixelfox', 'silent')
  expect(await pool.send(alt, 'pixelfox', 'held')).toEqual({
    channelId: 'pixelfox',
    held: true,
  })
  // The first token was refused, so the pool refreshed it once and reconnected.
  expect(clients.map((client) => client.token)).toEqual(['bad', 'fresh'])
  const client = required(clients[1])
  expect(client.joins).toEqual(['pixelfox'])
  expect(client.said).toEqual([
    'pixelfox:hello',
    'pixelfox:again',
    'pixelfox:dupe',
    'pixelfox:silent',
    'pixelfox:held',
  ])
  // The moderator role from the first USERSTATE lifts the spacing for later messages.
  expect(acquired).toEqual(['pixelfox:false', ...Array(4).fill('pixelfox:true')])

  pool.release(alt.id, 'pixelfox')
  await Bun.sleep(0)
  expect(client.parts).toEqual([])
  expect(client.closed).toBe(false)

  pool.retain(alt.id, 'other')
  pool.release(alt.id, 'pixelfox')
  await Bun.sleep(0)
  expect(client.parts).toEqual(['pixelfox'])
  expect(client.closed).toBe(false)

  await pool.send(alt, 'temporary', 'hello')
  await Bun.sleep(0)
  expect(client.parts).toEqual(['pixelfox', 'temporary'])
  expect(client.closed).toBe(false)

  pool.release(alt.id, 'other')
  await Bun.sleep(0)
  expect(client.closed).toBe(true)
})

test('the UI shows the same account the backend sends with', () => {
  const main = save('twitch', 'main')
  const alt = save('twitch', 'alt', false)
  const saved = [main, alt]
  expect(resolveChatAccount({ platform: 'twitch', accountId: alt.id }, saved, [main])?.id).toBe(
    alt.id,
  )
  expect(resolveChatAccount({ platform: 'twitch' }, saved, [main])?.id).toBe(main.id)
  expect(resolveChatAccount({ platform: 'kick', accountId: alt.id }, saved, [main])).toBeUndefined()
  expect(resolveChatAccount({ platform: 'twitch', accountId: 'gone' }, saved, [])).toBeUndefined()
  expect(
    resolveChatAccount({ platform: 'youtube', accountId: alt.id }, saved, [main]),
  ).toBeUndefined()
})

function paneLayout(channelId: string, accounts: Array<string | undefined>): WatchedChannelsLayout {
  return {
    version: 2,
    root: {
      type: 'split',
      id: 'split',
      direction: 'vertical',
      flex: 100,
      children: accounts.map((accountId, index) => ({
        type: 'panel',
        id: `pane-${index}`,
        flex: 100 / accounts.length,
        content: { type: 'watched', channelId, ...(accountId ? { accountId } : {}) },
      })),
    },
  }
}

test('panes of one chat send with their own accounts over a single reading connection', async () => {
  const main = save('twitch', 'main')
  const alt = save('twitch', 'alt', false)
  const bot = save('twitch', 'bot', false)
  const kick = save('kick', 'kick')
  const adapters: ReadingAdapter[] = []
  const { sender, log } = fixtureSender()
  const manager = new WatchedChannelManager(
    (message) => message,
    () => {
      const adapter = new ReadingAdapter()
      adapters.push(adapter)
      return adapter
    },
    sender,
  )
  const chat = await manager.addChannel('twitch', 'shared')
  // The live panes chose alt, bot and the default account; the default needs no own connection.
  manager.setPaneAccounts({ [chat.id]: [alt.id, bot.id, main.id] })
  await manager.setActiveChannels([chat.id])

  expect(adapters).toHaveLength(1)
  expect(log.toSorted()).toEqual(['prepare twitch:alt shared', 'prepare twitch:bot shared'])
  await manager.sendMessage(chat.id, 'from alt', undefined, alt.id)
  await manager.sendMessage(chat.id, 'from main', undefined, main.id)
  await manager.sendMessage(chat.id, 'from the chat')
  expect(required(adapters[0]).sent).toEqual(['from main', 'from the chat'])
  expect(log.at(-1)).toBe('send twitch:alt shared from alt')
  await expect(manager.sendMessage(chat.id, 'wrong', undefined, kick.id)).rejects.toThrow()

  // Closing the bot's pane releases its connection; an unchanged list touches nothing.
  manager.setPaneAccounts({ [chat.id]: [alt.id, main.id] })
  expect(log.at(-1)).toBe('release twitch:bot shared')
  const settled = log.length
  manager.setPaneAccounts({ [chat.id]: [alt.id, main.id] })
  expect(log).toHaveLength(settled)
})

test('a pane account wins over the chat account, and the tab lists non-default ones', () => {
  const main = save('twitch', 'main')
  const alt = save('twitch', 'alt', false)
  const bot = save('twitch', 'bot', false)
  const saved = [main, alt, bot]
  const chat = { platform: literal('twitch'), accountId: alt.id }
  expect(resolveChatAccount(chat, saved, [main], bot.id)?.id).toBe(bot.id)
  expect(resolveChatAccount(chat, saved, [main], 'twitch:gone')?.id).toBe(alt.id)
  expect(resolveChatAccount({ platform: 'twitch' }, saved, [main], main.id)?.id).toBe(main.id)
  expect(resolveChatAccount({ platform: 'youtube' }, saved, [], bot.id)).toBeUndefined()

  const channel = { ...WatchedChannelStore.upsert('twitch', 'shared', 'Shared'), accountId: alt.id }
  const layout = paneLayout(channel.id, [undefined, bot.id, main.id])
  expect(tabSenderAccounts(layout, [channel], saved, [main]).map((account) => account.id)).toEqual([
    alt.id,
    bot.id,
  ])
  expect(tabSenderAccounts(paneLayout(channel.id, [main.id]), [channel], saved, [main])).toEqual([])
})
