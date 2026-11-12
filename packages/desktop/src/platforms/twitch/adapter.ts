import type { RoomState } from '@twirchat/shared/channel-tools'
import { logger } from '@twirchat/shared/logger'
/**
 * Twitch Platform Adapter — powered by Twurple (@twurple/chat + @twurple/auth)
 *
 * Connects to Twitch Chat using the official Twurple ChatClient.
 *
 * - Anonymous mode: no auth, read-only
 * - Authenticated: reads the account's stored token on every (re)connect and
 *   refreshes it through the desktop OAuth client when it expires
 */
import type { Badge, ChatSendReceipt, NormalizedEvent } from '@twirchat/shared/types'
import { ChatClient, RoomState as TwitchRoomState, UserNotice } from '@twurple/chat'
import type { ChatMessage, ChatRaidInfo, ChatSubGiftInfo, ChatSubInfo } from '@twurple/chat'
import { LogLevel } from '@twurple/chat'

import { createTwitchChatAuthProvider } from '../../auth/twitch-access-token'
import { t, tPlural } from '../../gpuix/i18n'
import { getBackendUrl } from '../../runtime-config'
import { runInBackground } from '../../services/background-task'
import { buildTwitchSystemMessage } from '../../services/twitch-system-message'
import { AccountStore } from '../../store/account-store'
import { BasePlatformAdapter } from '../base-adapter'
import { resolveTwitchAvatarUrl } from './avatar-cache'
import { parseTwitchBadgeCatalog } from './badge-data'
import { normalizeTwitchChatMessage, twitchAuthorAppearance } from './normalize-message'
import { twitchIrcChannelName } from './send-outcomes'
import { createDefaultTwitchSenderPool, type TwitchSenderPool } from './sender-pool'

const reconnectDelayMs = 5000
const tokenRetryDelayMs = 30_000

const log = logger('twitch')

type RoomMode = keyof Omit<RoomState, 'platform' | 'channelId'>
type BooleanRoomMode = 'subscribersOnly' | 'emoteOnly' | 'uniqueChat'
const booleanRoomModes: ReadonlyArray<[tag: string, mode: BooleanRoomMode]> = [
  ['subs-only', 'subscribersOnly'],
  ['emote-only', 'emoteOnly'],
  ['r9k', 'uniqueChat'],
]

function booleanRoomModeText(mode: BooleanRoomMode, enabled: boolean): string {
  if (mode === 'subscribersOnly')
    return t(
      enabled
        ? 'misc.twitchAdapter.subscribersOnlyEnabled'
        : 'misc.twitchAdapter.subscribersOnlyDisabled',
    )
  if (mode === 'emoteOnly')
    return t(
      enabled ? 'misc.twitchAdapter.emoteOnlyEnabled' : 'misc.twitchAdapter.emoteOnlyDisabled',
    )
  return t(
    enabled ? 'misc.twitchAdapter.uniqueChatEnabled' : 'misc.twitchAdapter.uniqueChatDisabled',
  )
}

function roomDuration(tag: string | undefined): number | undefined {
  if (!tag) return undefined
  const value = Number(tag)
  return Number.isSafeInteger(value) ? value : undefined
}

type TwitchIrcNotice = Pick<
  Parameters<typeof buildTwitchSystemMessage>[0],
  'text' | 'notice' | 'author'
>

export { twitchAuthorAppearance, twitchMessageMetadata } from './normalize-message'

// ============================================================
// TwitchAdapter
// ============================================================

export class TwitchAdapter extends BasePlatformAdapter {
  readonly platform = 'twitch'

  private chatClient: ChatClient | null = null
  private badgeRefreshInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private channelName = ''
  private shouldReconnect = true
  private isConnected = false
  private roomState: RoomState | undefined

  getRoomState(): RoomState | undefined {
    return this.roomState
  }

  private updateRoomMode<K extends RoomMode>(
    channel: string,
    mode: K,
    value: RoomState[K],
    summary: string,
    announce = true,
  ): void {
    if (this.roomState?.[mode] === value) return
    const channelId = channel.replace(/^#/, '').toLowerCase()
    this.roomState = { ...this.roomState, platform: 'twitch', channelId, [mode]: value }
    this.emit('room_state', this.roomState)
    if (announce) this.emitModerationNotice({ channelId, text: summary })
  }

  private emitModerationNotice(
    input: Omit<Parameters<typeof buildTwitchSystemMessage>[0], 'notice'>,
  ): void {
    this.emit('notice', buildTwitchSystemMessage({ ...input, notice: { kind: 'moderation' } }))
  }

  /** "setId/version" → badge appearance and metadata from backend /api/twitch/badges */
  private badgeCache = new Map<string, Badge>()

  private anonymous = true
  private accountId: string | null = null
  private login: string | null = null
  private writerRetained = false

  private identityRevision = 0

  constructor(private readonly senders: TwitchSenderPool = createDefaultTwitchSenderPool()) {
    super()
  }

  async connect(channelName: string): Promise<void> {
    const revision = ++this.identityRevision
    this.releaseWriter()
    this.channelName = twitchIrcChannelName(channelName)
    this.badgeCache = new Map()
    this.roomState = undefined
    this.shouldReconnect = true
    this.isConnected = false
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    this.anonymous = true
    this.accountId = null
    this.login = null

    const account = AccountStore.findByPlatform('twitch')
    if (account && AccountStore.getTokens(account.id)?.accessToken) {
      this.anonymous = false
      this.accountId = account.id
      this.login = account.username
    }

    if (this.anonymous) {
      log.info('[Twitch] Connecting anonymously', { channel: this.channelName })
    } else {
      log.info('[Twitch] Connecting with an account', { channel: this.channelName })
    }

    this.emit('status', {
      channelLogin: this.channelName,
      mode: this.anonymous ? 'anonymous' : 'authenticated',
      platform: 'twitch',
      status: 'connecting',
    })

    // Initial badge fetch + schedule refresh every 5 minutes
    await this.fetchBadges()
    if (revision !== this.identityRevision) return
    this.badgeRefreshInterval = setInterval(
      () => runInBackground(this.fetchBadges(), 'adapter background operation failed'),
      5 * 60 * 1000,
    )

    await this.connectChatClient()
  }

  async disconnect(): Promise<void> {
    this.identityRevision++
    this.releaseWriter()
    this.accountId = null
    this.anonymous = true
    this.shouldReconnect = false
    this.clearTimers()

    if (this.chatClient) {
      this.chatClient.quit()
      this.chatClient = null
    }

    this.isConnected = false

    this.emit('status', {
      channelLogin: this.channelName,
      mode: this.anonymous ? 'anonymous' : 'authenticated',
      platform: 'twitch',
      status: 'disconnected',
    })
  }

  async sendMessage(
    channelId: string,
    text: string,
    replyTo?: string,
  ): Promise<void | ChatSendReceipt> {
    const { accountId, login, identityRevision } = this
    if (this.anonymous || !accountId || !login)
      throw new Error(t('misc.twitchAdapter.anonymousSend'))
    if (!this.chatClient) throw new Error(t('misc.twitchAdapter.clientNotInitialized'))
    if (!this.isConnected) throw new Error(t('misc.twitchAdapter.notConnected'))

    const channel = twitchIrcChannelName(channelId)
    if (channel === this.channelName) this.retainWriter(accountId)
    return this.senders.send({ id: accountId, username: login }, channel, text, replyTo, () => {
      if (identityRevision !== this.identityRevision)
        throw new Error(t('misc.twitchAdapter.accountChangedBeforeSend'))
      if (!this.isConnected) throw new Error(t('misc.twitchAdapter.notConnected'))
    })
  }

  /** Opens the sending connection and joins this chat before the first message. */
  prepareSend(): void {
    const { accountId } = this
    if (this.anonymous || !accountId || !this.login) return
    this.retainWriter(accountId)
    runInBackground(
      this.senders.warm({ id: accountId }, this.channelName),
      'Could not prepare the Twitch chat connection',
    )
  }

  private retainWriter(accountId: string): void {
    if (this.writerRetained) return
    this.senders.retain(accountId, this.channelName)
    this.writerRetained = true
  }

  private releaseWriter(): void {
    if (this.writerRetained && this.accountId)
      this.senders.release(this.accountId, this.channelName)
    this.writerRetained = false
  }

  // ============================================================
  // Private
  // ============================================================

  private async connectChatClient(): Promise<void> {
    const revision = this.identityRevision
    try {
      if (this.chatClient) {
        try {
          this.chatClient.quit()
        } catch {
          // ignore errors from already-closed client
        }
        if (revision !== this.identityRevision) return
        this.chatClient = null
      }

      this.chatClient = new ChatClient({
        authProvider:
          !this.anonymous && this.accountId
            ? createTwitchChatAuthProvider(this.accountId)
            : undefined,
        channels: [this.channelName],
        readOnly: true,
        logger: {
          custom: (level, message) => {
            if (level === LogLevel.ERROR) {
              log.error('[Twurple] Chat error', { detail: message })
            } else if (level === LogLevel.WARNING) {
              log.warn('[Twurple] Chat warning', { detail: message })
            }
            // INFO and DEBUG suppressed — avoids raw IRC message spam
          },
        },
      })

      this.setupEventHandlers()

      this.chatClient.connect()
    } catch (error) {
      if (revision !== this.identityRevision) return
      log.error('[Twitch] Failed to connect', { error: String(error) })
      this.handleDisconnect()
    }
  }

  private setupEventHandlers(): void {
    if (!this.chatClient) {
      return
    }

    const client = this.chatClient
    const revision = this.identityRevision
    const current = () => this.chatClient === client && this.identityRevision === revision

    // Connection successful
    client.onConnect(() => {
      if (!current()) return
      log.info('[Twitch] Connected to chat')
    })

    // Joined channel
    client.onJoin((channel, user) => {
      if (!current()) return
      if (channel.replace('#', '').toLowerCase() !== this.channelName) {
        return
      }

      // Anonymous sessions connect as justinfan* and can't be matched by login,
      // so the first join in our own channel is ours.
      const isSelf = this.anonymous || user.toLowerCase() === (this.login ?? '').toLowerCase()
      if (!isSelf || this.isConnected) {
        return
      }

      log.info('[Twitch] Joined channel', { channel })
      this.isConnected = true
      this.emit('status', {
        channelLogin: this.channelName,
        mode: this.anonymous ? 'anonymous' : 'authenticated',
        platform: 'twitch',
        status: 'connected',
      })
    })

    // Disconnected
    client.onDisconnect((manually, reason) => {
      if (!current()) return
      log.warn('[Twitch] Disconnected', { manually, detail: reason })
      this.isConnected = false

      // Intentional quit (teardown in connectChatClient / disconnect()) — treating it as a
      // real disconnect stacks reconnect timers and loops "disconnected" status emissions.
      if (manually) {
        return
      }

      this.handleDisconnect()
    })

    // Twurple retries rejected logins itself and refreshes through the auth provider.
    client.onAuthenticationFailure((text, retryCount) => {
      if (!current()) return
      log.error('[Twitch] Authentication failure', { retryCount, detail: text })
    })

    // No usable token (e.g. the refresh failed): Twurple quits instead of retrying.
    client.onTokenFetchFailure((error) => {
      if (!current()) return
      log.error('[Twitch] Could not get a chat token', { detail: String(error) })
      this.handleDisconnect(tokenRetryDelayMs)
    })

    // Messages (also handles bits/cheers — msg.bits > 0 means a cheer)
    client.onMessage((channel, user, text, msg) => {
      if (!current()) return
      runInBackground(this.handleChatMessage(msg), 'adapter background operation failed')
      if (msg.bits > 0) {
        this.handleCheerEvent(msg)
      }
    })

    // Actions (/me)
    client.onAction((channel, user, text, msg) => {
      if (!current()) return
      runInBackground(this.handleChatMessage(msg, text), 'adapter background operation failed')
    })
    client.onAnnouncement((channel, user, info, msg) => {
      if (!current()) return
      this.emit('message', {
        channelId: twitchIrcChannelName(channel),
        text: msg.text ?? '',
        id: msg.tags.get('id') ?? `twitch:announcement:${crypto.randomUUID()}`,
        timestamp: msg.date,
        author: {
          ...twitchAuthorAppearance(msg.tags, this.badgeCache),
          id: msg.tags.get('user-id') ?? '',
          username: user,
          displayName: msg.tags.get('display-name') ?? user,
        },
        emotes: [],
        metadata: { announcement: info.color.toLowerCase() },
        platform: 'twitch',
        type: 'message',
      })
    })

    // Subscriptions
    client.onSub((channel, user, subInfo, msg) => {
      if (!current()) return
      this.handleSubEvent(msg, 'sub', subInfo)
    })

    // Resubscriptions
    client.onResub((channel, user, subInfo, msg) => {
      if (!current()) return
      this.handleSubEvent(msg, 'resub', subInfo)
    })

    // Sub gifts
    client.onSubGift((channel, user, subInfo, msg) => {
      if (!current()) return
      this.handleSubGiftEvent(msg, user, subInfo)
    })
    client.onCommunitySub((channel, user, info, msg) => {
      if (!current()) return
      const displayName = info.gifterDisplayName || info.gifter || t('misc.twitchAdapter.anonymous')
      this.emitUserNotice(msg, {
        author: { displayName, username: info.gifter, id: info.gifterUserId ?? '' },
        text:
          Number.isSafeInteger(info.count) && info.count > 0
            ? tPlural('misc.twitchAdapter.communityGift', info.count, { name: displayName })
            : t('misc.twitchAdapter.communityGiftUnknown', { name: displayName }),
        notice: { kind: 'community_gift' },
      })
    })
    client.onRewardGift((channel, user, info, msg) => {
      if (!current() || info.triggerType !== 'CHEER') return
      const displayName = info.gifterDisplayName || user || t('misc.twitchAdapter.anonymous')
      this.emitUserNotice(msg, {
        author: { displayName, username: user, id: info.gifterId ?? '' },
        text:
          Number.isSafeInteger(info.count) && info.count > 0
            ? tPlural('misc.twitchAdapter.rewardGift', info.count, { name: displayName })
            : t('misc.twitchAdapter.rewardGiftUnknown', { name: displayName }),
        notice: { kind: 'reward_gift' },
      })
    })
    client.irc.onTypedMessage(UserNotice, (msg) => {
      if (!current()) return
      this.handleMilestoneNotice(msg)
    })

    // Raids
    client.onRaid((channel, user, raidInfo, msg) => {
      if (!current()) return
      this.handleRaidEvent(msg, raidInfo)
    })

    client.onBan((channel, user, msg) => {
      if (!current()) return
      const channelId = channel.replace(/^#/, '').toLowerCase()
      this.emit('moderation', {
        platform: 'twitch',
        channelId,
        action: 'ban',
        targetUserId: msg.tags.get('target-user-id'),
      })
      const at = msg.tags.get('tmi-sent-ts')
      this.emitModerationNotice({
        channelId,
        id: at ? `ban:${channelId}:${user}:${at}` : undefined,
        text: t('misc.twitchAdapter.banned', { user }),
        timestamp: msg.date,
      })
    })

    client.onTimeout((channel, user, duration, msg) => {
      if (!current()) return
      const channelId = channel.replace(/^#/, '').toLowerCase()
      this.emit('moderation', {
        platform: 'twitch',
        channelId,
        action: 'timeout',
        targetUserId: msg.tags.get('target-user-id'),
        durationSeconds: duration,
      })
      const at = msg.tags.get('tmi-sent-ts')
      this.emitModerationNotice({
        channelId,
        id: at ? `timeout:${channelId}:${user}:${at}` : undefined,
        text:
          Number.isSafeInteger(duration) && duration > 0
            ? t('misc.twitchAdapter.timedOut', { user, seconds: duration })
            : t('misc.twitchAdapter.timedOutNoDuration', { user }),
        timestamp: msg.date,
      })
    })
    client.onMessageRemove((channel, messageId, msg) => {
      if (!current()) return
      const channelId = channel.replace(/^#/, '').toLowerCase()
      this.emit('moderation', {
        platform: 'twitch',
        channelId,
        action: 'delete_message',
        messageId,
      })
      const user = msg.tags.get('login')
      this.emitModerationNotice({
        channelId,
        id: messageId ? `delete:${channelId}:${messageId}` : undefined,
        text: user
          ? t('misc.twitchAdapter.messageDeletedFrom', { user })
          : t('misc.twitchAdapter.messageDeleted'),
        timestamp: msg.date,
      })
    })
    client.onChatClear((channel, msg) => {
      if (!current()) return
      const channelId = channel.replace(/^#/, '').toLowerCase()
      this.emit('chat_clear', { platform: 'twitch', channelId })
      const at = msg.tags.get('tmi-sent-ts')
      this.emitModerationNotice({
        channelId,
        id: at ? `clear:${channelId}:${at}` : undefined,
        text: t('misc.twitchAdapter.chatCleared'),
        timestamp: msg.date,
      })
    })
    client.irc.onTypedMessage(TwitchRoomState, ({ channel, tags }) => {
      if (!current()) return
      // Twitch sends a full snapshot on join, followed by per-mode updates.
      const announce = !(tags.has('subs-only') && tags.has('slow'))
      const slow = roomDuration(tags.get('slow'))
      if (slow !== undefined && slow >= 0)
        this.updateRoomMode(
          channel,
          'slowSeconds',
          slow,
          slow
            ? t('misc.twitchAdapter.slowModeEnabled', { seconds: slow })
            : t('misc.twitchAdapter.slowModeDisabled'),
          announce,
        )
      const followers = roomDuration(tags.get('followers-only'))
      if (followers !== undefined && followers >= -1) {
        const duration = followers < 0 ? null : followers
        const summary =
          duration === null
            ? t('misc.twitchAdapter.followersOnlyDisabled')
            : duration
              ? t('misc.twitchAdapter.followersOnlyEnabledMinutes', { minutes: duration })
              : t('misc.twitchAdapter.followersOnlyEnabled')
        this.updateRoomMode(channel, 'followersOnlyMinutes', duration, summary, announce)
      }
      for (const [tag, mode] of booleanRoomModes) {
        const value = tags.get(tag)
        if (value === '0' || value === '1')
          this.updateRoomMode(
            channel,
            mode,
            value === '1',
            booleanRoomModeText(mode, value === '1'),
            announce,
          )
      }
    })
    client.onSubsOnly((channel, enabled) =>
      current()
        ? this.updateRoomMode(
            channel,
            'subscribersOnly',
            enabled,
            booleanRoomModeText('subscribersOnly', enabled),
          )
        : undefined,
    )
    client.onEmoteOnly((channel, enabled) =>
      current()
        ? this.updateRoomMode(
            channel,
            'emoteOnly',
            enabled,
            booleanRoomModeText('emoteOnly', enabled),
          )
        : undefined,
    )
    client.onUniqueChat((channel, enabled) =>
      current()
        ? this.updateRoomMode(
            channel,
            'uniqueChat',
            enabled,
            booleanRoomModeText('uniqueChat', enabled),
          )
        : undefined,
    )
  }

  private handleDisconnect(delayMs = reconnectDelayMs): void {
    this.isConnected = false

    this.emit('status', {
      channelLogin: this.channelName,
      mode: this.anonymous ? 'anonymous' : 'authenticated',
      platform: 'twitch',
      status: 'disconnected',
    })

    if (this.shouldReconnect) {
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout)
      }
      log.info(`[Twitch] Reconnecting in ${delayMs / 1000}s...`)
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null
        // Twurple may have reconnected on its own while the timer was pending —
        // don't tear down a healthy client just to rebuild it.
        if (this.isConnected) {
          return
        }
        runInBackground(this.connectChatClient(), 'adapter background operation failed')
      }, delayMs)
    }
  }

  private async handleChatMessage(msg: ChatMessage, actionText?: string): Promise<void> {
    // Messages only arrive after a successful join — recover the status if the
    // matching onJoin was missed (e.g. join fired before handlers attached).
    if (!this.isConnected) {
      this.isConnected = true
      this.emit('status', {
        channelLogin: this.channelName,
        mode: this.anonymous ? 'anonymous' : 'authenticated',
        platform: 'twitch',
        status: 'connected',
      })
    }

    const avatarUrl = await resolveTwitchAvatarUrl({ authorId: msg.tags.get('user-id') })
    const normalized = normalizeTwitchChatMessage(msg, this.badgeCache, {
      avatarUrl,
      text: actionText,
      isAction: actionText !== undefined,
    })

    this.emit('message', normalized)
  }

  private emitUserNotice(msg: UserNotice, input: TwitchIrcNotice): void {
    this.emit(
      'notice',
      buildTwitchSystemMessage({
        ...input,
        channelId: msg.channel,
        id: msg.tags.get('id'),
        timestamp: msg.date,
        text: msg.tags.get('system-msg')?.trim() || input.text,
      }),
    )
  }

  private handleMilestoneNotice(msg: UserNotice): void {
    const { tags } = msg
    const noticeId = tags.get('msg-id')
    const shared = noticeId === 'sharedchatnotice'
    const modiversary = (shared ? tags.get('source-msg-id') : noticeId) === 'modiversary'
    const watchStreak =
      noticeId === 'viewermilestone' && tags.get('msg-param-category') === 'watch-streak'
    if (!modiversary && !watchStreak) return

    const username = tags.get('login')
    const name = tags.get('display-name') || username || t('misc.twitchAdapter.someone')
    const count = Number(tags.get(modiversary ? 'msg-param-months' : 'msg-param-value'))
    const hasCount = Number.isSafeInteger(count) && count > 0
    let text: string
    if (modiversary) {
      text = hasCount
        ? t('misc.twitchAdapter.modiversary', {
            name,
            months: tPlural('misc.twitchAdapter.months', count),
          })
        : t('misc.twitchAdapter.modiversaryUnknown', { name })
    } else {
      text = hasCount
        ? tPlural('misc.twitchAdapter.watchStreak', count, { name })
        : t('misc.twitchAdapter.watchStreakUnknown', { name })
    }

    const sourceChannelId = shared ? tags.get('source-room-id') : undefined
    this.emit(
      'notice',
      buildTwitchSystemMessage({
        channelId: msg.channel,
        id: msg.id,
        timestamp: msg.date,
        author: { id: tags.get('user-id') ?? '', username, displayName: name },
        text,
        notice: {
          kind: modiversary ? 'modiversary' : 'watch_streak',
          detail: msg.text || undefined,
        },
        sharedChat: sourceChannelId
          ? { sourceChannelId, sourceMessageId: tags.get('source-id') }
          : undefined,
      }),
    )
  }

  private handleSubEvent(msg: UserNotice, type: 'sub' | 'resub', subInfo: ChatSubInfo): void {
    const { tags } = msg
    const userId = tags.get('user-id') ?? ''
    const username = tags.get('login')
    const displayName = tags.get('display-name') || username || t('misc.twitchAdapter.unknownName')
    const channelId = msg.channelId ?? ''

    const event: NormalizedEvent = {
      data: {
        channelId,
        months: subInfo.months,
        subPlan: tags.get('msg-param-sub-plan'),
        systemMsg: tags.get('system-msg')?.replace(/\\s/g, ' '),
      },
      id: `twitch:${type}:${userId}:${Date.now()}`,
      platform: 'twitch',
      timestamp: new Date(),
      type,
      user: {
        displayName,
        id: userId,
      },
    }

    this.emit('event', event)
    const hasMonths = Number.isSafeInteger(subInfo.months) && subInfo.months > 0
    const months = tPlural('misc.twitchAdapter.months', subInfo.months)
    const subscription = subInfo.isPrime ? t('misc.twitchAdapter.withPrime') : ''
    const duration = hasMonths ? t('misc.twitchAdapter.forMonths', { months }) : ''
    this.emitUserNotice(msg, {
      author: { id: userId, username, displayName },
      text:
        type === 'resub'
          ? t('misc.twitchAdapter.resubscribed', { name: displayName, subscription, duration })
          : t('misc.twitchAdapter.subscribed', { name: displayName, subscription }),
      notice: { kind: type, detail: subInfo.message || undefined },
    })
  }

  private handleSubGiftEvent(msg: UserNotice, recipient: string, subInfo: ChatSubGiftInfo): void {
    const { tags } = msg
    const userId = tags.get('user-id') ?? ''
    const displayName = tags.get('display-name') ?? t('misc.twitchAdapter.unknownName')
    const channelId = msg.channelId ?? ''

    const event: NormalizedEvent = {
      data: {
        channelId,
        months: subInfo.months,
        recipientDisplayName: recipient,
        recipientId: tags.get('msg-param-recipient-id'),
        subPlan: tags.get('msg-param-sub-plan'),
        systemMsg: tags.get('system-msg')?.replace(/\\s/g, ' '),
      },
      id: `twitch:subgift:${userId}:${Date.now()}`,
      platform: 'twitch',
      timestamp: new Date(),
      type: 'gift_sub',
      user: {
        displayName,
        id: userId,
      },
    }

    this.emit('event', event)
    const gifterName =
      subInfo.gifterDisplayName || subInfo.gifter || t('misc.twitchAdapter.anonymous')
    const recipientName = subInfo.displayName || recipient
    this.emitUserNotice(msg, {
      author: { id: subInfo.gifterUserId ?? '', username: subInfo.gifter, displayName: gifterName },
      text: recipientName
        ? t('misc.twitchAdapter.giftSubTo', { gifter: gifterName, recipient: recipientName })
        : t('misc.twitchAdapter.giftSub', { gifter: gifterName }),
      notice: { kind: 'gift_sub' },
    })
  }

  private handleRaidEvent(msg: UserNotice, raidInfo: ChatRaidInfo): void {
    const { tags } = msg
    const userId = tags.get('user-id') ?? ''
    const displayName = tags.get('display-name') ?? t('misc.twitchAdapter.unknownName')
    const channelId = msg.channelId ?? ''

    const event: NormalizedEvent = {
      data: {
        channelId,
        systemMsg: tags.get('system-msg')?.replace(/\\s/g, ' '),
        viewerCount: raidInfo.viewerCount,
      },
      id: `twitch:raid:${userId}:${Date.now()}`,
      platform: 'twitch',
      timestamp: new Date(),
      type: 'raid',
      user: {
        displayName,
        id: userId,
      },
    }

    this.emit('event', event)
    const username = tags.get('msg-param-login') || tags.get('login')
    const raiderName =
      raidInfo.displayName ||
      tags.get('display-name') ||
      username ||
      t('misc.twitchAdapter.someone')
    this.emitUserNotice(msg, {
      author: { id: userId, username, displayName: raiderName },
      text:
        Number.isSafeInteger(raidInfo.viewerCount) && raidInfo.viewerCount > 0
          ? tPlural('misc.twitchAdapter.raidedWith', raidInfo.viewerCount, { name: raiderName })
          : t('misc.twitchAdapter.raided', { name: raiderName }),
      notice: { kind: 'raid' },
    })
  }

  private handleCheerEvent(msg: ChatMessage): void {
    const { tags } = msg
    const userId = tags.get('user-id') ?? ''
    const displayName = tags.get('display-name') ?? msg.userInfo.userName
    const bits = parseInt(tags.get('bits') ?? '0', 10)

    const event: NormalizedEvent = {
      data: {
        bits,
        channelId: msg.channelId ?? '',
        message: msg.text,
      },
      id: `twitch:bits:${userId}:${Date.now()}`,
      platform: 'twitch',
      timestamp: new Date(),
      type: 'bits',
      user: {
        displayName,
        id: userId,
      },
    }

    this.emit('event', event)
  }

  private async fetchBadges(): Promise<void> {
    const revision = this.identityRevision
    const channelName = this.channelName
    const url = new URL(`${getBackendUrl()}/api/twitch/badges`)
    if (channelName) {
      url.searchParams.set('broadcasterLogin', channelName)
    }

    try {
      const res = await fetch(url.toString())
      if (!res.ok) {
        log.warn(`[Twitch] Badge fetch failed: ${res.status}`)
        return
      }
      const badges = parseTwitchBadgeCatalog(await res.json())
      if (revision !== this.identityRevision || channelName !== this.channelName) return
      this.badgeCache = badges
      log.info(`[Twitch] Badge cache updated: ${this.badgeCache.size} entries`)
    } catch (error) {
      log.warn('[Twitch] Badge fetch error', { error: String(error) })
    }
  }

  private clearTimers(): void {
    if (this.badgeRefreshInterval) {
      clearInterval(this.badgeRefreshInterval)
      this.badgeRefreshInterval = null
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
  }
}
