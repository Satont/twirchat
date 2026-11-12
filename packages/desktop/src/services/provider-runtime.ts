import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
import type { Account, Badge, NormalizedChatMessage, Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { twitchAccessTokenIfAvailable } from '../auth/twitch-access-token'
import { backendFetch } from '../runtime-config'
import { sevenTVService } from '../seventv'
import { AccountStore } from '../store/account-store'
import { getDb } from '../store/db'
import { runInBackground } from './background-task'
import { deleteOldestEntry } from './bounded-cache'
import { getUserCosmetics, updateSevenTvPresence } from './cosmetics'
import { validateEmotePreferences } from './emote-preferences'
import {
  getProviderEmotes,
  invalidateProviderEmotes,
  getProviderErrors,
  getChannelProviderBadges,
  getPersonalEmoteSet,
  type ProviderEmoteOptions,
} from './emote-providers'
import { getNativeTwitchEmotes, resolveTwitchChannel } from './native-emotes'
import {
  DEFAULT_EMOTE_PREFERENCES,
  createProviderEmoteEnricher,
  mergeProviderEmotes,
  type EmotePreferences,
} from './provider-emotes'

export interface ProviderActiveChannel {
  platform: Platform
  channelId: string
  channelSlug?: string
}
export interface ChannelProviderBadges {
  moderator?: Badge
  vip?: Badge
  users: Record<string, Badge[]>
}
export interface ProviderRuntimeDependencies {
  readPreferences(): string | null
  accounts(): Account[]
  resolve(platform: Platform, channel: string): Promise<{ platformUserId: string; login: string }>
  native(platform: Platform, channel: string, force?: boolean): Promise<EmoteCatalogEntry[]>
  sevenTv(platform: Platform, channel: string): EmoteCatalogEntry[] | undefined
  catalog(
    platform: Platform,
    channel: string,
    options: ProviderEmoteOptions,
  ): Promise<EmoteCatalogEntry[]>
  badges(channel: string): Promise<ChannelProviderBadges>
  sevenTvUser(platform: Platform, userId: string): Promise<string | undefined>
  presence(userId: string, platform: Platform, channelId: string): Promise<void>
  personalSet?(setId: string): Promise<EmoteCatalogEntry[]>
  invalidate?(): Promise<void>
  errors?(): { url: string; error: string }[]
  replaceSevenTv?(platform: Platform, channel: string, emotes: EmoteCatalogEntry[]): void
  publish?(platform: Platform, channelId: string, catalog: EmoteCatalogEntry[]): void
  publishAuthor?(platform: Platform, authorId: string, catalog: EmoteCatalogEntry[]): void
  now?(): number
}
interface ChannelEntry {
  platform: Platform
  slug: string
  numericId?: string
  aliases: Set<string>
  catalog: EmoteCatalogEntry[]
  ownPersonal: EmoteCatalogEntry[]
  badges?: ChannelProviderBadges
  enrich: (message: NormalizedChatMessage) => NormalizedChatMessage
  expires: number
  pending?: Promise<EmoteCatalogEntry[]>
}
interface AuthorEntry {
  platform: Platform
  userId: string
  setId?: string
  catalog: EmoteCatalogEntry[]
  expires: number
  pending?: Promise<void>
}
const normalize = (channel: string) => channel.trim().replace(/^#/, '').toLowerCase()
const key = (platform: Platform, channel: string) => `${platform}:${normalize(channel)}`

/** Backend-owned catalogs and presence. Message dispatch only reads compiled memory. */
export class ProviderRuntime {
  private preferences: EmotePreferences = structuredClone(DEFAULT_EMOTE_PREFERENCES)
  private rawPreferences: string | null | undefined
  private entries = new Set<ChannelEntry>()
  private aliases = new Map<string, ChannelEntry>()
  private joined = new Map<string, { platform: Platform; channelId: string }>()
  private active: ProviderActiveChannel | null = null
  private activeRequests = 0
  private queue: ((acquired: boolean) => void)[] = []
  private timer?: ReturnType<typeof setInterval>
  private stopped = false
  private presenceRunning = false
  private presenceNext = 0
  private revision = 0
  private catalogRevision = 0
  private lifecycle = 0
  private emptyEnrich = createProviderEmoteEnricher([], this.preferences)
  private authors = new Map<string, AuthorEntry>()
  private accountIds = new Map<Platform, string>()
  private combinedEnrichers = new Map<
    string,
    { channel: EmoteCatalogEntry[]; personal: EmoteCatalogEntry[]; enrich: ChannelEntry['enrich'] }
  >()
  constructor(private readonly dependencies: ProviderRuntimeDependencies) {
    this.accountIds = new Map(
      dependencies.accounts().map((account) => [account.platform, account.platformUserId]),
    )
    this.refreshPreferences()
  }
  private now() {
    return this.dependencies.now?.() ?? Date.now()
  }
  refreshPreferences(): void {
    const raw = this.dependencies.readPreferences()
    if (raw === this.rawPreferences) return
    this.rawPreferences = raw
    try {
      this.preferences =
        raw === null
          ? structuredClone(DEFAULT_EMOTE_PREFERENCES)
          : validateEmotePreferences(JSON.parse(raw))
    } catch {
      this.preferences = structuredClone(DEFAULT_EMOTE_PREFERENCES)
    }
    this.revision++
    this.catalogRevision++
    this.emptyEnrich = createProviderEmoteEnricher([], this.preferences)
    this.combinedEnrichers.clear()
    this.presenceNext = 0
    for (const entry of this.entries) this.compile(entry)
    for (const joined of this.joined.values())
      runInBackground(
        this.warm(joined.platform, joined.channelId, undefined, true),
        'provider-runtime background operation failed',
      )
    for (const author of this.authors.values()) this.publishAuthor(author)
  }
  private compile(entry: ChannelEntry): void {
    entry.ownPersonal = entry.catalog.filter((emote) => emote.source === 'personal')
    entry.enrich = createProviderEmoteEnricher(
      entry.catalog.filter((emote) => emote.source !== 'personal'),
      this.preferences,
    )
    const catalog = mergeProviderEmotes([entry.catalog], this.preferences)
    for (const alias of entry.aliases) this.dependencies.publish?.(entry.platform, alias, catalog)
  }
  private acquire(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false)
    if (this.activeRequests < 3) {
      this.activeRequests++
      return Promise.resolve(true)
    }
    return new Promise((resolve) => this.queue.push(resolve))
  }
  private release(): void {
    const next = this.queue.shift()
    if (next && !this.stopped) next(true)
    else this.activeRequests--
  }
  private updateLiveCatalog(entry: ChannelEntry): void {
    const live = this.dependencies.sevenTv(entry.platform, entry.slug)
    if (live !== undefined)
      entry.catalog = [
        ...entry.catalog.filter((emote) => emote.source !== 'seventv'),
        ...live.map<EmoteCatalogEntry>((emote) => ({
          ...emote,
          source: 'seventv' satisfies NonNullable<EmoteCatalogEntry['provider']>,
          provider: 'seventv' satisfies NonNullable<EmoteCatalogEntry['provider']>,
        })),
      ]
  }
  private remember(entry: ChannelEntry, alias: string): void {
    const normalized = normalize(alias)
    if (!normalized) return
    entry.aliases.add(normalized)
    this.aliases.set(key(entry.platform, normalized), entry)
  }
  private entry(platform: Platform, channelId: string, channelSlug?: string): ChannelEntry {
    const existing =
      this.aliases.get(key(platform, channelId)) ??
      (channelSlug ? this.aliases.get(key(platform, channelSlug)) : undefined)
    if (existing) {
      this.remember(existing, channelId)
      if (channelSlug) this.remember(existing, channelSlug)
      return existing
    }
    const entry: ChannelEntry = {
      platform,
      slug: normalize(channelSlug ?? channelId),
      aliases: new Set(),
      catalog: [],
      ownPersonal: [],
      expires: 0,
      enrich: createProviderEmoteEnricher([], this.preferences),
    }
    this.entries.add(entry)
    this.remember(entry, channelId)
    if (channelSlug) this.remember(entry, channelSlug)
    while (this.entries.size > 128) {
      const oldest = [...this.entries].find(
        (candidate) => candidate !== entry && !candidate.pending,
      )
      if (!oldest) break
      this.entries.delete(oldest)
      for (const alias of oldest.aliases)
        if (this.aliases.get(key(oldest.platform, alias)) === oldest)
          this.aliases.delete(key(oldest.platform, alias))
    }
    return entry
  }
  async warm(
    platform: Platform,
    channelId: string,
    channelSlug?: string,
    force = false,
    forceRemote = false,
  ): Promise<EmoteCatalogEntry[]> {
    if (this.stopped) return []
    const entry = this.entry(platform, channelId, channelSlug)
    if (entry.pending) return entry.pending
    if (!force && entry.expires > this.now())
      return mergeProviderEmotes([entry.catalog], this.preferences)
    if (this.queue.length >= 128) return entry.catalog
    const requestedAt = this.catalogRevision
    const lifecycle = this.lifecycle
    const task = (async () => {
      if (!(await this.acquire())) return []
      try {
        if (this.stopped || lifecycle !== this.lifecycle) return []
        const account = this.dependencies
          .accounts()
          .find((candidate) => candidate.platform === platform)
        const own =
          account &&
          (normalize(account.username) === entry.slug || account.platformUserId === entry.slug)
        let resolved: { platformUserId: string; login: string } | undefined
        try {
          resolved = own
            ? { platformUserId: account.platformUserId, login: account.username }
            : platform === 'youtube'
              ? undefined
              : await this.dependencies.resolve(platform, entry.slug)
        } catch {
          /* Global catalogs and existing data remain useful if identity lookup fails. */
        }
        if (resolved) {
          entry.numericId = resolved.platformUserId
          entry.slug = normalize(resolved.login)
          this.remember(entry, resolved.platformUserId)
          this.remember(entry, resolved.login)
        }
        const prefs = this.preferences
        const [native, badges] = await Promise.all([
          prefs.enabled.twitch && platform === 'twitch'
            ? forceRemote
              ? this.dependencies.native(platform, entry.slug, true)
              : this.dependencies.native(platform, entry.slug).catch(() => [])
            : Promise.resolve([]),
          prefs.enabled.ffz && prefs.badges && platform === 'twitch'
            ? this.dependencies.badges(entry.slug).catch(() => undefined)
            : Promise.resolve(undefined),
        ])
        const sevenTV = forceRemote ? undefined : this.dependencies.sevenTv(platform, entry.slug)
        const catalog = await this.dependencies.catalog(platform, entry.slug, {
          nativeEmotes: native,
          sevenTV,
          twitchUserId: entry.numericId,
          personalUserId: account?.platformUserId,
          preferences: prefs,
        })
        if (this.stopped || lifecycle !== this.lifecycle) return []
        if (requestedAt !== this.catalogRevision)
          return mergeProviderEmotes([entry.catalog], this.preferences)
        entry.catalog = catalog
        entry.badges = badges
        entry.expires = this.now() + 300000
        if (forceRemote)
          this.dependencies.replaceSevenTv?.(
            platform,
            entry.slug,
            catalog.filter((emote) => emote.source === 'seventv'),
          )
        if (!forceRemote || this.dependencies.replaceSevenTv) this.updateLiveCatalog(entry)
        this.compile(entry)
        if (requestedAt !== this.catalogRevision) entry.expires = 0
        return mergeProviderEmotes([entry.catalog], this.preferences)
      } catch (error) {
        entry.expires = this.now() + 30000
        if (forceRemote) throw error
        return mergeProviderEmotes([entry.catalog], this.preferences)
      } finally {
        this.release()
      }
    })().finally(() => {
      entry.pending = undefined
      if (!this.stopped && lifecycle === this.lifecycle && requestedAt !== this.catalogRevision)
        runInBackground(
          this.warm(platform, channelId, channelSlug, true),
          'provider-runtime background operation failed',
        )
    })
    entry.pending = task
    return task
  }
  setJoined(source: string, platform: Platform, channel: string | null): void {
    if (!channel) {
      this.joined.delete(source)
      return
    }
    this.joined.set(source, { platform, channelId: channel })
    runInBackground(this.warm(platform, channel), 'provider-runtime background operation failed')
  }
  enrich(message: NormalizedChatMessage): NormalizedChatMessage {
    if (this.stopped) return message
    const entry = this.aliases.get(key(message.platform, message.channelId))
    if (!entry) {
      runInBackground(
        this.warm(message.platform, message.channelId),
        'provider-runtime background operation failed',
      )
      return this.emptyEnrich(message)
    }
    const personal =
      this.preferences.personal && this.preferences.enabled.seventv
        ? (this.authors.get(key(message.platform, message.author.id))?.catalog ??
          (this.accountIds.get(message.platform) === message.author.id
            ? entry.ownPersonal
            : undefined))
        : undefined
    let enrich = entry.enrich
    if (personal?.length) {
      const cacheKey = `${key(message.platform, entry.slug)}:${message.author.id}`
      let combined = this.combinedEnrichers.get(cacheKey)
      if (!combined || combined.channel !== entry.catalog || combined.personal !== personal) {
        combined = {
          channel: entry.catalog,
          personal,
          enrich: createProviderEmoteEnricher(
            [...personal, ...entry.catalog.filter((emote) => emote.source !== 'personal')],
            this.preferences,
          ),
        }
        this.combinedEnrichers.set(cacheKey, combined)
        if (this.combinedEnrichers.size > 64) deleteOldestEntry(this.combinedEnrichers)
      }
      enrich = combined.enrich
    }
    const enriched = enrich(message)
    const replacements = entry.badges
    if (!this.preferences.badges || !this.preferences.enabled.ffz || !replacements) return enriched
    let changed = false
    const badges = message.author.badges.map((badge) => {
      const replacement =
        badge.type === 'moderator'
          ? replacements.moderator
          : badge.type === 'vip'
            ? replacements.vip
            : undefined
      if (!replacement) return badge
      changed = true
      return replacement
    })
    for (const badge of replacements.users[message.author.id] ??
      replacements.users[message.author.username?.toLowerCase() ?? ''] ??
      [])
      if (!badges.some((existing) => existing.id === badge.id)) {
        badges.push(badge)
        changed = true
      }
    return changed ? { ...enriched, author: { ...message.author, badges } } : enriched
  }
  async reload(
    platform: Platform,
    channel: string,
    kind: 'channel' | 'subscriber' = 'channel',
  ): Promise<void> {
    if (this.stopped) throw new Error('Emote providers are stopped.')
    if (kind === 'subscriber' && !this.preferences.enabled.twitch)
      throw new Error('Enable Twitch emotes in Emote settings before reloading subscriber emotes.')
    if (kind === 'subscriber' && platform !== 'twitch')
      throw new Error('Subscriber emote catalogs are supported for Twitch accounts.')
    const entry = this.entry(platform, channel)
    await entry.pending
    await this.dependencies.invalidate?.()
    entry.expires = 0
    await this.warm(platform, channel, undefined, true, true)
    const failures = this.dependencies.errors?.() ?? []
    if (failures.length)
      throw new Error(
        `Some emote providers could not refresh: ${failures.map((item) => `${new URL(item.url).hostname}: ${item.error}`).join('; ')}`,
      )
  }
  refreshChannel(platform: Platform, channelId: string): void {
    const entry = this.aliases.get(key(platform, channelId))
    if (entry) {
      this.updateLiveCatalog(entry)
      this.compile(entry)
    } else
      runInBackground(
        this.warm(platform, channelId),
        'provider-runtime background operation failed',
      )
  }
  refreshAccounts(): void {
    this.accountIds = new Map(
      this.dependencies.accounts().map((account) => [account.platform, account.platformUserId]),
    )
    this.revision++
    this.catalogRevision++
    this.presenceNext = 0
    this.combinedEnrichers.clear()
    for (const entry of this.entries) {
      entry.catalog = entry.catalog.filter(
        (emote) => emote.source !== 'personal' && emote.source !== 'collectibles',
      )
      entry.expires = 0
      this.compile(entry)
    }
    for (const joined of this.joined.values())
      runInBackground(
        this.warm(joined.platform, joined.channelId, undefined, true),
        'provider-runtime background operation failed',
      )
    if (this.active)
      runInBackground(
        this.warm(this.active.platform, this.active.channelId, this.active.channelSlug, true),
        'provider-runtime background operation failed',
      )
  }
  private publishAuthor(author: AuthorEntry): void {
    this.dependencies.publishAuthor?.(
      author.platform,
      author.userId,
      this.preferences.personal && this.preferences.enabled.seventv ? author.catalog : [],
    )
  }
  async warmAuthorPersonal(platform: Platform, userId: string, setId?: string): Promise<void> {
    if (
      this.stopped ||
      platform === 'youtube' ||
      !userId ||
      !this.preferences.personal ||
      !this.preferences.enabled.seventv
    )
      return
    const authorKey = key(platform, userId)
    let author = this.authors.get(authorKey)
    if (author?.pending && author.setId === setId) return author.pending
    if (author && author.setId === setId && author.expires > this.now()) return
    if (this.queue.length >= 128) return
    if (!author || author.setId !== setId) {
      author = { platform, userId, setId, catalog: [], expires: 0 }
      this.authors.delete(authorKey)
      this.authors.set(authorKey, author)
      this.publishAuthor(author)
      while (this.authors.size > 256) deleteOldestEntry(this.authors)
    }
    const current = author
    const lifecycle = this.lifecycle
    const task = (async () => {
      if (!(await this.acquire())) return
      try {
        const catalog =
          setId && this.dependencies.personalSet ? await this.dependencies.personalSet(setId) : []
        if (this.stopped || lifecycle !== this.lifecycle || this.authors.get(authorKey) !== current)
          return
        current.catalog = catalog.map((emote) => ({
          ...emote,
          source: 'personal',
          provider: 'seventv',
        }))
        current.expires = this.now() + 300000
        this.publishAuthor(current)
      } catch {
        current.expires = this.now() + 30000
      } finally {
        this.release()
      }
    })().finally(() => {
      current.pending = undefined
    })
    current.pending = task
    return task
  }
  setActiveChannel(channel: ProviderActiveChannel | null): void {
    const unchanged =
      this.active?.platform === channel?.platform &&
      this.active?.channelId === channel?.channelId &&
      this.active?.channelSlug === channel?.channelSlug
    this.active = channel
    if (!unchanged) {
      this.revision++
      this.presenceNext = 0
    }
    this.refreshPreferences()
    if (channel)
      runInBackground(
        this.warm(channel.platform, channel.channelId, channel.channelSlug),
        'provider-runtime background operation failed',
      )
    runInBackground(this.pulsePresence(), 'provider-runtime background operation failed')
  }
  async pulsePresence(): Promise<void> {
    this.refreshPreferences()
    if (
      this.stopped ||
      this.presenceRunning ||
      !this.preferences.sendPresence ||
      !this.active ||
      this.active.platform === 'youtube' ||
      this.presenceNext > this.now()
    )
      return
    const active = this.active
    const account = this.dependencies
      .accounts()
      .find((candidate) => candidate.platform === active.platform)
    if (!account) return
    this.presenceRunning = true
    const requestedAt = this.revision
    this.presenceNext = this.now() + 60000
    try {
      await this.warm(active.platform, active.channelId, active.channelSlug)
      const entry = this.aliases.get(key(active.platform, active.channelId))
      if (!entry?.numericId || !/^\d+$/.test(entry.numericId)) return
      const userId = await this.dependencies.sevenTvUser(account.platform, account.platformUserId)
      this.refreshPreferences()
      const currentAccount = this.dependencies
        .accounts()
        .find((candidate) => candidate.platform === active.platform)
      if (
        !userId ||
        this.stopped ||
        requestedAt !== this.revision ||
        !this.preferences.sendPresence ||
        currentAccount?.id !== account.id ||
        currentAccount.platformUserId !== account.platformUserId
      )
        return
      await this.dependencies.presence(userId, active.platform, entry.numericId)
    } catch {
      if (requestedAt === this.revision) this.presenceNext = this.now() + 120000
    } finally {
      this.presenceRunning = false
    }
  }
  start(): void {
    if (this.timer) return
    this.stopped = false
    this.timer = setInterval(() => {
      this.refreshPreferences()
      const now = this.now()
      for (const joined of this.joined.values()) {
        const entry = this.aliases.get(key(joined.platform, joined.channelId))
        if (entry && (entry.pending || entry.expires > now)) continue
        runInBackground(
          this.warm(joined.platform, joined.channelId),
          'provider-runtime background operation failed',
        )
      }
      runInBackground(this.pulsePresence(), 'provider-runtime background operation failed')
    }, 1000)
    this.timer.unref?.()
  }
  stop(): void {
    this.stopped = true
    this.lifecycle++
    this.revision++
    this.active = null
    this.joined.clear()
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    for (const resume of this.queue.splice(0)) resume(false)
  }
}

export function createDesktopProviderRuntime(
  publish?: ProviderRuntimeDependencies['publish'],
  publishAuthor?: ProviderRuntimeDependencies['publishAuthor'],
): ProviderRuntime {
  return new ProviderRuntime({
    readPreferences: () =>
      getDb()
        .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
        .get('gpuix_ui_emote_preferences_v1')?.value ?? null,
    accounts: () => AccountStore.findAllActive(),
    resolve: async (platform, channel) => {
      if (platform === 'twitch') return resolveTwitchChannel(channel)
      if (platform === 'kick') {
        if (/^\d+$/.test(channel)) return { platformUserId: channel, login: channel }
        const response = await backendFetch(
          `/api/kick/chatroom?slug=${encodeURIComponent(channel)}`,
          { signal: AbortSignal.timeout(15000) },
        )
        if (!response.ok) throw new Error('Kick channel lookup failed.')
        const value = z
          .object({ broadcasterUserId: z.number().optional() })
          .parse(await response.json())
        if (!value.broadcasterUserId) throw new Error('Kick broadcaster ID unavailable.')
        return { platformUserId: String(value.broadcasterUserId), login: channel }
      }
      throw new Error('Presence is unavailable for YouTube.')
    },
    native: async (platform, channel, force) => {
      if (platform !== 'twitch') return []
      const account = AccountStore.findByPlatform(platform)
      const token = account ? await twitchAccessTokenIfAvailable(account.id) : undefined
      return getNativeTwitchEmotes(channel, token, force)
    },
    sevenTv: (platform, channel) =>
      sevenTVService.hasEmoteSet(platform, channel)
        ? sevenTVService.getEmotes(platform, channel).map((emote) => ({
            ...emote,
            source: 'seventv' satisfies NonNullable<EmoteCatalogEntry['provider']>,
            provider: 'seventv' satisfies NonNullable<EmoteCatalogEntry['provider']>,
          }))
        : undefined,
    catalog: getProviderEmotes,
    invalidate: invalidateProviderEmotes,
    errors: getProviderErrors,
    replaceSevenTv: (platform, channel, emotes) =>
      sevenTVService.handleEmoteSet(platform, channel, emotes),
    badges: getChannelProviderBadges,
    sevenTvUser: async (platform, userId) =>
      (
        await getUserCosmetics(platform, userId, undefined, {
          badges: false,
          paints: false,
          communityBadges: DEFAULT_EMOTE_PREFERENCES.communityBadges,
        })
      )?.sevenTvUserId,
    presence: updateSevenTvPresence,
    personalSet: getPersonalEmoteSet,
    publish,
    publishAuthor,
  })
}
