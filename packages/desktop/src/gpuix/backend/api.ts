import {
  PLATFORM_COMMAND_NAMES,
  type PlatformCommandResult,
  type RoomState,
} from '@twirchat/shared/channel-tools'
import type {
  ConnectDonationProvider,
  DonationConnections,
  DonationOAuthAvailability,
  DonationProvider,
  DonationSharing,
  ShareableDonationProvider,
} from '@twirchat/shared/donations'
import { logger } from '@twirchat/shared/logger'
import type {
  ChannelStatusRequest,
  ChannelsStatusResponse,
  EmoteCatalogEntry,
  SearchCategoriesResponse,
  StreamStatusResponse,
  UpdateStreamRequest,
  UpdateStreamResponse,
  UserCardMetadataRequest,
  UserCardMetadataResponse,
} from '@twirchat/shared/protocol'
import type {
  TwitchActivitiesSnapshot,
  TwitchActivityAction,
  TwitchRedemptionsPage,
  TwitchFollowingPage,
  TwitchWebSessionStatus,
} from '@twirchat/shared/twitch-activities'
/** UI request boundary; stores, credentials and platform adapters stay backend-owned. */
import type {
  TwitchActivitySnapshotPart,
  TwitchActivityCapability,
  TwitchRewardQueueSummary,
} from '@twirchat/shared/twitch-activities'
import type {
  Account,
  ChatSendReceipt,
  AppSettings,
  LayoutNode,
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
  SplitDirection,
  WatchedChannel,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'
import type {
  ModerationSettings,
  UserProfileRequest,
  UserProfileSnapshot,
} from '@twirchat/shared/user-profile'
import { z } from 'zod'

import {
  connectTwitchDevice,
  finishDesktopSignIn,
  getKickAuthUrl,
  getVkPlayAuthUrl,
  getYouTubeAuthUrl,
  prepareKickAuth,
  requestTwitchDeviceCode,
} from '../../auth'
import { getDonationAlertsDesktopClientId } from '../../auth/client-config'
import { getDonationOAuthAvailability } from '../../auth/donations'
import {
  currentTwitchAccessToken,
  twitchAccessTokenIfAvailable,
} from '../../auth/twitch-access-token'
import { validateTwitchUserToken } from '../../auth/twitch-user-token'
import type { BackendConnection } from '../../backend-connection'
import { APP_VERSION } from '../../build-info'
import type { ChatAggregator } from '../../chat/aggregator'
import type { DonationService } from '../../donations/service'
import { KickAdapter } from '../../platforms/kick/adapter'
import { forgetTwitchSendLimiter } from '../../platforms/twitch/send-limiter'
import type { PluginTransportInfo } from '../../plugins/api'
import { backendFetch } from '../../runtime-config'
import type { AccountSessions } from '../../services/account-sessions'
import type { ChannelActions, PlayerSettings } from '../../services/channel-actions'
import { channelAccount, platformAccount } from '../../services/chat-accounts'
import { ChatToolsError, createChatToolsService } from '../../services/chat-tools'
import {
  getUserCosmetics,
  getPaintNameImage,
  type UserCosmetics,
  type UserCosmeticPreferences,
  type CosmeticPaint,
} from '../../services/cosmetics'
import { getProviderErrors } from '../../services/emote-providers'
import {
  createFossabotCommandsClient,
  type FossabotCommandTarget,
} from '../../services/fossabot-commands'
import {
  readClipboardUploadFile,
  type ClipboardImageUpload,
  type ClipboardUploadImage,
  type ImageUploaderSettings,
  type ImageUploadResult,
} from '../../services/image-uploader'
import {
  createJeetbotCommandsClient,
  type JeetbotCommand,
  type JeetbotCommandsOptions,
  type JeetbotCommandTarget,
} from '../../services/jeetbot-commands'
import {
  resolveMentionUser,
  type MentionUser,
  type MentionUserRequest,
} from '../../services/mention-user'
import { createModerationService } from '../../services/moderation/service'
import { createNightbotCommandsClient } from '../../services/nightbot-commands'
import { createPotatCommandsClient } from '../../services/potat-commands'
import { createDesktopProviderRuntime, type ProviderRuntime } from '../../services/provider-runtime'
import type { PrefixedBotCommand, PublicBotCommand } from '../../services/public-bot-commands'
import { createSnapshotRequests } from '../../services/snapshot-requests'
import type {
  StreamerMode,
  StreamerModeService,
  StreamerModeSettings,
  StreamerModeStatus,
} from '../../services/streamer-mode'
import {
  createSupibotCommandsClient,
  type SupibotCommandTarget,
} from '../../services/supibot-commands'
import { systemIntegration } from '../../services/system-integration'
import {
  createTwirCommandsClient,
  type TwirCommand,
  type TwirCommandsOptions,
  type TwirCommandTarget,
} from '../../services/twir-commands'
import {
  createTwitchActivitiesService,
  type TwitchActivitiesCredentials,
} from '../../services/twitch-activities'
import type { TwitchActivityRefreshClient } from '../../services/twitch-activity-refresh'
import { TwitchChattersError } from '../../services/twitch-chatters'
import type { TwitchEventSubAccounts } from '../../services/twitch-eventsub-accounts'
import { loadTwitchUserCardDetails } from '../../services/twitch-user-card'
import { enrichTwitchUserProfile } from '../../services/twitch-user-profile'
import type { TwitchUserCredentials } from '../../services/twitch-users'
import { getTwitchViewerList, type TwitchViewerRole } from '../../services/twitch-viewer-list'
import { updateTwitchStream } from '../../services/update-stream'
import { sevenTVService } from '../../seventv'
import type { UserChatHistoryCursor, UserChatHistoryPage } from '../../shared/rpc'
import { AccountStore, ChannelStore, MessageStore, SettingsStore } from '../../store'
import { TwitchWebSessionStore } from '../../store/twitch-web-session-store'
import { UserAliasStore } from '../../store/user-alias-store'
import { WatchedChannelsLayoutStore } from '../../store/watched-channels-layout-store'
import { mergeChatMessageSnapshot } from '../../views/main/utils/chat-message-buffer'
import type { WatchedChannelManager } from '../../watched-channels/manager'
import {
  isPluginPlatform,
  type DesktopWatchedChannel,
  type WatchedPlatform,
} from '../../watched-channels/plugin-channel-types'
import type { PluginChannels } from '../../watched-channels/plugin-channels'
import { t } from '../i18n'
import {
  platformCommandResultSchema,
  streamStatusResponseSchema,
  updateStreamResponseSchema,
  searchCategoriesResponseSchema,
  channelsStatusResponseSchema,
  userProfileSnapshotSchema,
  userCardMetadataResponseSchema,
  kickChatroomSchema,
  kickChattersSchema,
} from './api-schemas'
import {
  getChatHistory as readChatHistory,
  getChatLoggingSettings as readChatLoggingSettings,
  saveChatLoggingSettings as writeChatLoggingSettings,
  exportChatHistory as writeChatHistoryExport,
  getChatLoggingStatus as readChatLoggingStatus,
  flushChatLogs as flushRecordedChatLogs,
  type ChatHistoryQuery,
  type ChatLoggingSettings,
} from './chat-history'
import type { DesktopEvents } from './events'
import * as imageUploader from './image-uploader'
import { createLayoutApi } from './layout-api'
import { obsRemoteApi } from './obs-remote'
import { readCachedReleaseNotes, writeCachedReleaseNotes } from './release-notes-cache'
import { createStreamerModeApi } from './streamer-mode-api'
import * as translation from './translation'
import type {
  TranslationSettings,
  TranslationSettingsView,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
  TranslationLanguage,
} from './translation'
import type { TwitchHistoryRuntime } from './twitch-history'
import { createUpdater, type Updater } from './updater'
import {
  getUserNotes,
  setUserNotes,
  getModerationSettings,
  saveModerationSettings,
} from './user-preferences'

const log = logger('gpuix-backend')
const platformCommands = new Set<string>(PLATFORM_COMMAND_NAMES)

const githubReleaseSchema = z.object({
  tag_name: z.string().min(1).optional(),
  body: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
})

export interface UserAlias {
  platform: Platform
  platformUserId: string
  alias: string
  createdAt: number
  updatedAt: number
}

type UpdateStreamInput = Omit<UpdateStreamRequest, 'platform' | 'userAccessToken'> & {
  platform: 'twitch' | 'kick'
}

export type ModerationPlatform = 'twitch' | 'kick'
export type ModerationAction = 'delete_message' | 'timeout' | 'ban'
export type ChatterRole = TwitchViewerRole | 'ogs'

export interface ChatterUser {
  userId?: string
  username: string
  displayName: string
  avatarUrl?: string
}

export interface ChatterGroup {
  role: ChatterRole
  users: ChatterUser[]
}

export interface ChattersTarget {
  platform: 'twitch' | 'kick'
  channelSlug: string
  accountId?: string
}

interface ChannelChattersBase {
  platform: 'twitch' | 'kick'
  channelSlug: string
  total: number
  groups: ChatterGroup[]
}

export type ChannelChatters = ChannelChattersBase &
  (
    | { channelId: string; source?: 'community'; error?: never }
    | { channelId?: never; source?: never; error: string }
  )

interface AuthRequest {
  platform: Platform
  windowScope: string
}

export interface DesktopApi {
  obsRemote: typeof obsRemoteApi
  donationAlertsOAuthAvailable: boolean
  getDonationConnections(): Promise<DonationConnections>
  getDonationOAuthAvailability(): Promise<DonationOAuthAvailability | null>
  connectDonationProvider(params: ConnectDonationProvider): Promise<void>
  disconnectDonationProvider(params: { provider: DonationProvider }): Promise<void>
  getDonationSharing(): Promise<DonationSharing>
  setDonationSharing(params: {
    provider: ShareableDonationProvider
    enabled: boolean
  }): Promise<DonationSharing>
  getStreamerMode(): Promise<StreamerModeStatus>
  setStreamerMode(params: { mode: StreamerMode | 'toggle' }): Promise<StreamerModeStatus>
  getStreamerModeSettings(): Promise<StreamerModeSettings>
  setStreamerModeSettings(params: { settings: StreamerModeSettings }): Promise<StreamerModeStatus>
  reconnectChat(params: { watchedChannelId?: string; platform?: Platform }): Promise<void>
  reloadChatEmotes(params: {
    platform: Platform
    channelSlug: string
    kind?: 'channel' | 'subscriber'
  }): Promise<void>
  openChannelPlayer(params: {
    platform: Platform
    channelSlug: string
    mode: 'browser' | 'custom' | 'streamlink'
  }): Promise<void>
  getPlayerSettings(): Promise<PlayerSettings>
  savePlayerSettings(params: { settings: PlayerSettings }): Promise<void>
  setProviderActiveChannel(
    params: { platform: Platform; channelId: string; channelSlug?: string } | null,
  ): Promise<void>
  getImageUploaderSettings(): Promise<ImageUploaderSettings>
  saveImageUploaderSettings(settings: ImageUploaderSettings): Promise<ImageUploaderSettings>
  connectTwirImageUploader(params: { signal: AbortSignal }): Promise<ImageUploaderSettings>
  disconnectTwirImageUploader(): Promise<ImageUploaderSettings>
  readClipboardUploadFile(path: string): Promise<ClipboardUploadImage | null>
  uploadClipboardImage(request: ClipboardImageUpload): Promise<ImageUploadResult>
  getTranslationSettings(): Promise<TranslationSettingsView>
  saveTranslationSettings(settings: TranslationSettings): Promise<TranslationSettingsView>
  setTranslationCredential(params: {
    provider: TranslationProvider
    key: string
  }): Promise<TranslationSettingsView>
  removeTranslationCredential(params: {
    provider: TranslationProvider
  }): Promise<TranslationSettingsView>
  translateText(request: TranslationRequest): Promise<TranslationResult>
  getTranslationLanguages(params?: {
    provider?: TranslationProvider
  }): Promise<TranslationLanguage[]>
  getChatHistory(query: ChatHistoryQuery): Promise<UserChatHistoryPage>
  getChatLoggingSettings(): Promise<ChatLoggingSettings>
  saveChatLoggingSettings(settings: ChatLoggingSettings): Promise<void>
  exportChatHistory(params: {
    query: ChatHistoryQuery
    path: string
  }): Promise<{ path: string; count: number; history?: UserChatHistoryPage['history'] }>
  getChatLoggingStatus(): Promise<{ error: string | null; queued: number }>
  flushChatLogs(): Promise<void>
  getTwitchActivities(params: {
    channelSlug: string
    sections?: TwitchActivitySnapshotPart[]
  }): Promise<TwitchActivitiesSnapshot>
  getTwitchActivityCapability(params: { channelSlug: string }): Promise<TwitchActivityCapability>
  getTwitchRewardQueueSummary(params: { channelSlug: string }): Promise<TwitchRewardQueueSummary>
  executeTwitchActivityAction(params: TwitchActivityAction): Promise<{ message?: string }>
  getTwitchRewardRedemptions(params: {
    channelSlug: string
    rewardId?: string
    status?: string
    cursor?: string
    order?: 'NEWEST' | 'OLDEST'
  }): Promise<TwitchRedemptionsPage>
  getTwitchFollowing(params?: { liveOnly?: boolean; cursor?: string }): Promise<TwitchFollowingPage>
  setTwitchWebSession(params: { token: string }): Promise<TwitchWebSessionStatus>
  getTwitchWebSessionStatus(): Promise<TwitchWebSessionStatus>
  clearTwitchWebSession(): Promise<void>
  watchTwitchActivities(params: { channelSlug: string; watch: boolean }): Promise<void>
  executePlatformCommand(params: {
    platform: Platform
    channelSlug: string
    text: string
    /** Saved account of the pane that acts; absent uses the chat's account. */
    accountId?: string
  }): Promise<PlatformCommandResult>
  getChannelRoomState(params: {
    platform: Platform
    channelSlug: string
    /** Saved account of the pane that acts; absent uses the chat's account. */
    accountId?: string
  }): Promise<RoomState>
  getAccounts(): Promise<Account[]>
  getSavedAccounts(): Promise<Account[]>
  setActiveAccount(params: { platform: Platform; accountId: string | null }): Promise<void>
  forgetAccount(params: { accountId: string }): Promise<void>
  getSettings(): Promise<AppSettings>
  saveSettings(params: AppSettings): Promise<void>
  getTwirCommands(
    target: TwirCommandTarget,
    options?: TwirCommandsOptions,
  ): Promise<readonly TwirCommand[]>
  getJeetbotCommands(
    target: JeetbotCommandTarget,
    options?: JeetbotCommandsOptions,
  ): Promise<readonly JeetbotCommand[]>
  getFossabotCommands: (target: FossabotCommandTarget) => Promise<readonly PublicBotCommand[]>
  getNightbotCommands: (channelLogin: string) => Promise<readonly PublicBotCommand[]>
  getPotatCommands: (channelLogin: string) => Promise<readonly PrefixedBotCommand[]>
  getSupibotCommands: (target: SupibotCommandTarget) => Promise<readonly PrefixedBotCommand[]>
  getUserAliases(): Promise<UserAlias[]>
  setUserAlias(params: { platform: Platform; platformUserId: string; alias: string }): Promise<void>
  removeUserAlias(params: { platform: Platform; platformUserId: string }): Promise<void>
  getChannels(): Promise<Partial<Record<Platform, string[]>>>
  authStart(params: AuthRequest): Promise<void>
  /** Prepares a sign-in like `authStart` and returns its link instead of opening a browser. */
  authLink(params: AuthRequest): Promise<{ url: string }>
  cancelTwitchAuth(params: { userCode: string; windowScope: string }): Promise<void>
  authLogout(params: { platform: Platform }): Promise<void>
  joinChannel(params: { platform: Platform; channelSlug: string }): Promise<void>
  leaveChannel(params: { platform: Platform; channelSlug: string }): Promise<void>
  sendMessage(params: {
    platform: Platform
    channelId: string
    text: string
    replyTo?: string
  }): Promise<void | ChatSendReceipt>
  /** Opens the platform's sending connection while the user writes, before `sendMessage`. */
  prepareSend(params: { platform: Platform }): Promise<void>
  resolveAvatar(params: {
    platform: ModerationPlatform
    authorId: string
    username?: string
  }): Promise<{ avatarUrl?: string }>
  getModerationCapabilities(params: {
    platform: ModerationPlatform
    channelSlug: string
    /** Saved account of the pane that acts; absent uses the chat's account. */
    accountId?: string
  }): Promise<{ canModerate: boolean }>
  moderateMessage(params: {
    platform: ModerationPlatform
    channelSlug: string
    /** Saved account of the pane that acts; absent uses the chat's account. */
    accountId?: string
    messageId: string
    targetUserId: string
    action: ModerationAction
    durationSeconds?: number
  }): Promise<{ success: boolean }>
  getStreamStatus(params: {
    platform: 'twitch' | 'kick'
    channelId: string
  }): Promise<StreamStatusResponse>
  updateStream(params: UpdateStreamInput): Promise<UpdateStreamResponse>
  searchCategories(params: {
    platform: 'twitch' | 'kick'
    query: string
  }): Promise<SearchCategoriesResponse>
  getChannelsStatus(params: { channels: ChannelStatusRequest[] }): Promise<ChannelsStatusResponse>
  getRecentMessages(params?: { limit?: number }): Promise<NormalizedChatMessage[]>
  getUserChatHistory(params: {
    platform: Platform
    platformUserId: string
    channelId?: string
    username?: string
    limit?: number
    cursor?: UserChatHistoryCursor
  }): Promise<UserChatHistoryPage>
  getUserCardMetadata(params: UserCardMetadataRequest): Promise<UserCardMetadataResponse>
  getUserProfile(params: UserProfileRequest): Promise<UserProfileSnapshot>
  getUserNotes(params: { platform: Platform; platformUserId: string }): Promise<string>
  setUserNotes(params: { platform: Platform; platformUserId: string; text: string }): Promise<void>
  getModerationSettings(): Promise<ModerationSettings>
  saveModerationSettings(settings: ModerationSettings): Promise<void>
  getStatuses(): Promise<PlatformStatusInfo[]>
  resolveMentionUser(params: MentionUserRequest): Promise<MentionUser | null>
  getChannelEmotes(params: { platform: Platform; channelId: string }): Promise<EmoteCatalogEntry[]>
  getEmoteProviderErrors(): Promise<Array<{ url: string; error: string }>>
  getUserCosmetics(params: {
    platform: Platform
    platformUserId: string
    username?: string
    preferences?: UserCosmeticPreferences
  }): Promise<UserCosmetics | null>
  getPaintNameImage(params: {
    name: string
    paint: CosmeticPaint
    fontSize?: number
    fontFamily?: string
  }): Promise<{ path: string; width: number; height: number }>
  /** Velopack updater; dev/unpackaged builds always report "no update". */
  getAppVersion(): Promise<string>
  checkForUpdate(): Promise<{ updateAvailable: boolean; version?: string; currentVersion: string }>
  downloadUpdate(): Promise<{ success: boolean; error?: string }>
  applyUpdate(): Promise<void>
  skipUpdate(params: { hash: string }): Promise<void>
  getWatchedChannels(): Promise<DesktopWatchedChannel[]>
  /**
   * Chats referenced by live layouts, with the accounts their panes chose (by chat ID) so those
   * accounts keep a sending connection only while a pane uses them.
   */
  setActiveWatchedChannels(params: {
    ids: string[]
    paneAccounts?: Record<string, string[]>
  }): Promise<void>
  addWatchedChannel(params: {
    platform: WatchedPlatform
    channelSlug: string
  }): Promise<DesktopWatchedChannel>
  removeWatchedChannel(params: { id: string }): Promise<void>
  /** Chooses the saved account a chat signs in and sends with; `null` uses the default account. */
  setWatchedChannelAccount(params: {
    id: string
    accountId: string | null
  }): Promise<WatchedChannel>
  getWatchedChannelMessages(params: { id: string }): Promise<NormalizedChatMessage[]>
  sendWatchedChannelMessage(params: {
    id: string
    text: string
    replyTo?: string
    /** The sending pane's account; absent sends with the chat's account. */
    accountId?: string
  }): Promise<void | ChatSendReceipt>
  /** Opens the watched chat's sending connection while the user writes. */
  prepareWatchedChannelSend(params: { id: string; accountId?: string }): Promise<void>
  /**
   * Chooses the saved account one pane sends with, independently of other panes showing the same
   * chat; `null` makes the pane follow the chat's account again.
   */
  setPanelAccount(params: {
    tabId: string
    panelId: string
    accountId: string | null
  }): Promise<void>
  getWatchedChannelStatuses(): Promise<Array<{ channelId: string; status: PlatformStatusInfo }>>
  getPluginTransports(): readonly PluginTransportInfo[]
  observePluginChannel: PluginChannels['observe']
  sendPluginChannelMessage(params: { id: string; text: string }): Promise<void>
  getChatters(params: { targets: ChattersTarget[] }): Promise<{ results: ChannelChatters[] }>
  openExternalUrl(params: { url: string }): Promise<void>
  /** GPUIX-only: generic UI preference stored in the settings KV table. */
  getUiState(params: { key: string }): Promise<string | null>
  setUiState(params: { key: string; value: string }): Promise<void>
  /** Get the last seen app version (for update changelog). */
  getLastSeenVersion(): Promise<string | null>
  /** Set the last seen app version. */
  setLastSeenVersion(params: { version: string }): Promise<void>
  /** Fetch release notes for a specific version from GitHub. */
  getReleaseNotes(params: { version: string }): Promise<{
    version: string
    releaseNotes: string
    publishedAt: string
    htmlUrl: string
  } | null>
  /** GPUIX-only: write to the system clipboard (GPUIX exposes no clipboard API). */
  copyText(params: { text: string }): Promise<void>
  readClipboard(): Promise<string>
  notify(params: {
    title: string
    body: string
    sound?: boolean
    soundPath?: string
    silent?: boolean
  }): Promise<void>
  getTabChannelIds(): Promise<string[] | null>
  setTabChannelIds(params: { ids: string[] }): Promise<void>
  getWatchedChannelsLayout(params: { tabId: string }): Promise<WatchedChannelsLayout | null>
  setWatchedChannelsLayout(params: { tabId: string; layout: WatchedChannelsLayout }): Promise<void>
  removeWatchedChannelsLayout(params: { tabId: string }): Promise<void>
  removePanel(params: { tabId: string; panelId: string }): Promise<void>
  assignChannelToPanel(params: {
    tabId: string
    panelId: string
    channelId: string | null
  }): Promise<void>
  splitPanel(params: {
    tabId: string
    panelId: string
    direction: SplitDirection
  }): Promise<{ original: LayoutNode; newPanel: LayoutNode }>
}

export interface DesktopApiContext {
  donations?: DonationService
  updater?: Updater
  twitchHistory?: TwitchHistoryRuntime
  streamerMode?: StreamerModeService
  channelActions?: ChannelActions
  accountSessions?: AccountSessions
  providerRuntime?: ProviderRuntime
  twitchActivityRefresh?: TwitchActivityRefreshClient
  twitchEventSub?: TwitchEventSubAccounts
  aggregator: ChatAggregator
  backendConn: BackendConnection
  watchedChannelManager: WatchedChannelManager
  pluginChannels?: PluginChannels
  onUiStateSaved?: (key: string, value: string) => void
  currentStatuses: Map<string, PlatformStatusInfo>
  events: DesktopEvents
  openBrowser: (url: string) => void
}

const activitySnapshots = createSnapshotRequests<TwitchActivitiesSnapshot>(2)

const twitchActivities = createTwitchActivitiesService()
const twitchChatTools = createChatToolsService()
const twitchModeration = createModerationService()

async function twitchUserCredentials(accessToken: string): Promise<TwitchUserCredentials> {
  const { clientId } = await validateTwitchUserToken(accessToken)
  return { accessToken, clientId }
}

async function twitchRequest<T>(action: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ChatToolsError) {
      if (error.status === 401)
        throw new Error(t('runtime.api.authExpired', { action }), { cause: error })
      throw new Error(`${action}: ${error.message}`, { cause: error })
    }
    throw error
  }
}

async function prepareTwitchActivitiesRequest(eventSubAccountId?: string) {
  const getAccount = () =>
    eventSubAccountId
      ? AccountStore.findById(eventSubAccountId)
      : AccountStore.findByPlatform('twitch')
  const account = getAccount()
  if (account?.platform !== 'twitch' || !AccountStore.getTokens(account.id)?.accessToken)
    throw new Error(t('runtime.api.connectTwitchFirst'))
  const accessToken = await currentTwitchAccessToken(account.id)
  const credentials: TwitchActivitiesCredentials = {
    ...(await twitchUserCredentials(accessToken)),
    platformUserId: account.platformUserId,
    scopes: account.scopes,
    webSession: eventSubAccountId ? undefined : await TwitchWebSessionStore.get(),
  }
  const checkIdentity = () => {
    if (getAccount()?.id !== account.id)
      throw new Error(t('runtime.api.activeTwitchAccountChanged'))
  }
  const run = async <T>(
    operation: (credentials: TwitchActivitiesCredentials) => Promise<T>,
  ): Promise<T> => {
    checkIdentity()
    const result = await twitchRequest(t('runtime.api.action.twitchActivityFailed'), () =>
      operation(credentials),
    )
    checkIdentity()
    return result
  }
  return { credentials, run }
}

async function twitchActivity<T>(
  operation: (credentials: TwitchActivitiesCredentials) => Promise<T>,
  eventSubAccountId?: string,
): Promise<T> {
  const request = await prepareTwitchActivitiesRequest(eventSubAccountId)
  return request.run(operation)
}

export function subscribeTwitchActivities(
  accountId: string,
  sessionId: string,
  channelSlug?: string,
) {
  return twitchActivity(
    (credentials) => twitchActivities.subscribe(credentials, sessionId, channelSlug),
    accountId,
  )
}

export function unsubscribeTwitchActivities(accountId: string, ids: string[]) {
  return twitchActivity((credentials) => twitchActivities.unsubscribe(credentials, ids), accountId)
}

export async function requestTwitchActivitiesSnapshot(params: {
  channelSlug: string
  sections?: TwitchActivitySnapshotPart[]
}): Promise<TwitchActivitiesSnapshot> {
  const { credentials, run } = await prepareTwitchActivitiesRequest()
  const key = `${credentials.platformUserId}:${params.channelSlug.toLowerCase()}:${credentials.webSession ? 'web' : 'oauth'}`
  return activitySnapshots.request(key, params.sections, () =>
    run((account) => twitchActivities.snapshot(account, params.channelSlug, params.sections)),
  )
}

// ── Avatar resolution (port of internal/avatar/resolver.go) ────────────────

const AVATAR_POSITIVE_TTL_MS = 30 * 60 * 1000
const AVATAR_NEGATIVE_TTL_MS = 2 * 60 * 1000
const AVATAR_MAX_ENTRIES = 2000

interface AvatarCacheEntry {
  avatarUrl: string
  expiresAt: number
  createdAt: number
}

const avatarCache = new Map<string, AvatarCacheEntry>()
const avatarInFlight = new Map<string, Promise<{ avatarUrl?: string }>>()

async function resolveAvatarRemote(params: {
  platform: ModerationPlatform
  authorId: string
  username?: string
}): Promise<{ avatarUrl?: string }> {
  const key = `${params.platform}:${params.authorId}:${params.username ?? ''}`
  const now = Date.now()
  const cached = avatarCache.get(key)
  if (cached && now < cached.expiresAt) {
    return { avatarUrl: cached.avatarUrl || undefined }
  }
  if (cached) avatarCache.delete(key)

  const inFlight = avatarInFlight.get(key)
  if (inFlight) return inFlight

  const promise = (async (): Promise<{ avatarUrl?: string }> => {
    let avatarUrl = ''
    if (params.platform === 'twitch') {
      const res = await backendFetch(
        `/api/twitch/user?userId=${encodeURIComponent(params.authorId)}`,
      )
      if (res.ok) {
        const data = z
          .object({ user: z.object({ profile_image_url: z.string().optional() }).optional() })
          .parse(await res.json())
        avatarUrl = data.user?.profile_image_url?.trim() ?? ''
      }
    } else {
      const slug = params.username?.trim()
      if (slug) {
        const res = await backendFetch(`/api/kick/chatroom?slug=${encodeURIComponent(slug)}`)
        if (res.ok) {
          const data = kickChatroomSchema.parse(await res.json())
          avatarUrl = data.avatarUrl?.trim() ?? ''
        }
      }
    }
    return { avatarUrl: avatarUrl || undefined }
  })()

  avatarInFlight.set(key, promise)
  try {
    const result = await promise
    if (avatarCache.size >= AVATAR_MAX_ENTRIES) {
      let oldestKey: string | null = null
      let oldest = Infinity
      for (const [k, entry] of avatarCache) {
        if (entry.createdAt < oldest) {
          oldest = entry.createdAt
          oldestKey = k
        }
      }
      if (oldestKey) avatarCache.delete(oldestKey)
    }
    avatarCache.set(key, {
      avatarUrl: result.avatarUrl ?? '',
      createdAt: now,
      expiresAt: now + (result.avatarUrl ? AVATAR_POSITIVE_TTL_MS : AVATAR_NEGATIVE_TTL_MS),
    })
    return result
  } finally {
    avatarInFlight.delete(key)
  }
}

// ── Moderation (port of internal/bridge/moderation_handlers.go) ────────────

/**
 * Turns a failed backend response into a user-facing error: the route's
 * `{ error }` body when present, with expired platform OAuth called out.
 */
async function backendFailure(action: string, res: Response): Promise<Error> {
  let detail = ''
  try {
    const body = z.object({ error: z.string().optional() }).parse(await res.json())
    if (body?.error) detail = String(body.error).replace(/^Error:\s*/, '')
  } catch {
    // Non-JSON body — fall back to the status code.
  }
  if (res.status === 401 || /\b401\b|Invalid OAuth token|Unauthorized/i.test(detail)) {
    return new Error(t('runtime.api.authExpired', { action }))
  }
  return new Error(
    detail ? `${action}: ${detail}` : t('runtime.api.httpStatus', { action, status: res.status }),
  )
}

async function moderationCredentials(
  platform: ModerationPlatform,
  channelSlug: string,
  accountId?: string,
) {
  if (platform !== 'twitch' && platform !== 'kick') {
    throw new Error(t('runtime.api.moderationUnsupportedPlatform', { platform }))
  }
  if (!channelSlug) throw new Error(t('runtime.api.moderationChannelRequired'))

  const account = accountId
    ? platformAccount(platform, accountId)
    : channelAccount(platform, channelSlug)
  if (!account) {
    throw new Error(t('runtime.api.moderationAuthenticate', { platform }))
  }
  const tokens = AccountStore.getTokens(account.id)
  if (!tokens?.accessToken) {
    throw new Error(t('runtime.api.moderationCredentialsUnavailable', { platform }))
  }
  return {
    channelSlug,
    accessToken:
      platform === 'twitch' ? await currentTwitchAccessToken(account.id) : tokens.accessToken,
    platformUserId: account.platformUserId,
    scopes: account.scopes,
  }
}

// ── Chatters (port of internal/platforms/{twitch,kick}/chatters.go) ────────

const KICK_ACTIVE_CHATTERS_URL = 'https://web.kick.com/api/v1/channels'

async function fetchTwitchChatters({
  accountId,
  channelSlug,
}: ChattersTarget): Promise<ChannelChatters> {
  const account = accountId
    ? platformAccount('twitch', accountId)
    : channelAccount('twitch', channelSlug)
  const { source, viewers } = await getTwitchViewerList({
    broadcasterLogin: channelSlug,
    accessToken: account ? await twitchAccessTokenIfAvailable(account.id) : undefined,
  }).catch((error: unknown) => {
    const message =
      error instanceof TwitchChattersError && error.status === 404
        ? t('runtime.api.chattersChannelNotFound')
        : t('runtime.api.chattersTwitchUnavailable')
    throw new Error(message, { cause: error })
  })

  const groups: Record<TwitchViewerRole, ChatterGroup> = {
    broadcaster: { role: 'broadcaster', users: [] },
    moderators: { role: 'moderators', users: [] },
    vips: { role: 'vips', users: [] },
    bots: { role: 'bots', users: [] },
    chatters: { role: 'chatters', users: [] },
  }
  for (const { role, ...viewer } of viewers) groups[role].users.push(viewer)

  return {
    platform: 'twitch',
    channelId: channelSlug,
    channelSlug,
    total: viewers.length,
    groups: Object.values(groups),
    ...(source === 'community' ? { source } : {}),
  }
}

async function fetchKickChatters(channelSlug: string): Promise<ChannelChatters> {
  // 1. Resolve the broadcaster id via the backend chatroom proxy.
  const roomRes = await backendFetch(`/api/kick/chatroom?slug=${encodeURIComponent(channelSlug)}`)
  if (!roomRes.ok) throw new Error(t('runtime.api.chattersKickUnavailable'))
  const room = kickChatroomSchema.parse(await roomRes.json())
  const broadcasterId = room.broadcasterUserId ?? 0
  if (broadcasterId <= 0) throw new Error(t('runtime.api.chattersKickUnavailable'))

  // 2. Hit Kick's web internal API directly (mirrors the Go service).
  const endpoint = `${KICK_ACTIVE_CHATTERS_URL}/${broadcasterId}/chat/active-chatters`
  const res = await fetch(endpoint, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Origin: 'https://kick.com',
      Referer: `https://kick.com/${channelSlug}`,
    },
  })
  if (!res.ok) throw new Error(t('runtime.api.chattersKickUnavailable'))
  const body = kickChattersSchema.parse(await res.json())
  const data = body.data
  if (!data) throw new Error(t('runtime.api.chattersKickUnavailable'))

  const roles: ChatterRole[] = ['moderators', 'vips', 'ogs', 'bots', 'chatters']
  const lists = [data.moderators, data.vips, data.ogs, data.bots, data.chatters]
  const seen = new Set<string>()
  let total = 0
  const groups: ChatterGroup[] = roles.map((role, index) => {
    const users: ChatterUser[] = []
    for (const chatter of lists[index] ?? []) {
      const username = (chatter.slug ?? chatter.username ?? '').trim()
      if (!username) continue
      const key = username.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      users.push({
        username,
        displayName: (chatter.username ?? username).trim() || username,
        avatarUrl: chatter.profilePicture,
      })
      total += 1
    }
    return { role, users }
  })

  return { platform: 'kick', channelId: String(broadcasterId), channelSlug, total, groups }
}

// ── API factory ─────────────────────────────────────────────────────────────

export function createDesktopApi(ctx: DesktopApiContext): DesktopApi {
  const { aggregator, watchedChannelManager, currentStatuses } = ctx
  const updater = ctx.updater ?? createUpdater(ctx.events)
  function donations(): DonationService {
    if (!ctx.donations) throw new Error('Donation integrations are unavailable.')
    return ctx.donations
  }

  let twitchAuth:
    | { controller: AbortController; windowScope: string; userCode?: string }
    | undefined

  async function createAuthUrl({ platform, windowScope }: AuthRequest): Promise<string> {
    if (platform === 'kick') {
      const { codeChallenge, state } = prepareKickAuth()
      return getKickAuthUrl(codeChallenge, state)
    }
    if (platform === 'vkplay') return getVkPlayAuthUrl()
    if (platform === 'youtube') return getYouTubeAuthUrl()

    twitchAuth?.controller.abort()
    const controller = new AbortController()
    const current: NonNullable<typeof twitchAuth> = { controller, windowScope }
    twitchAuth = current
    ctx.events.emit('twitch_device_code', null)

    const clear = () => {
      if (twitchAuth !== current) return
      twitchAuth = undefined
      ctx.events.emit('twitch_device_code', null)
    }

    try {
      const attempt = await requestTwitchDeviceCode(controller.signal)
      controller.signal.throwIfAborted()
      const { user_code: userCode, verification_uri: url } = attempt.code
      current.userCode = userCode
      ctx.events.emit('twitch_device_code', { userCode, url, windowScope })
      void connectTwitchDevice(attempt, controller.signal)
        .then((account) => {
          clear()
          return finishDesktopSignIn('twitch', account)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          ctx.events.emit('auth_error', {
            platform: 'twitch',
            error: error instanceof Error ? error.message : t('runtime.auth.twitchSignInFailed'),
          })
        })
        .finally(clear)
      return url
    } catch (error) {
      clear()
      throw error
    }
  }

  const getSevenTvTwitchPlatformUserId = (channelSlug: string): string | undefined => {
    const twitchAccount = AccountStore.findByPlatform('twitch')
    if (!twitchAccount) return undefined
    if (twitchAccount.username.toLowerCase() !== channelSlug.toLowerCase()) return undefined
    return twitchAccount.platformUserId
  }

  const subscribeSevenTv = (platform: Platform, channelSlug: string, adapter: unknown): void => {
    if (platform === 'vkplay') return
    let sevenTvChannelId = channelSlug
    let sevenTvPlatformUserId: string | undefined
    if (platform === 'kick') {
      const broadcasterUserId =
        adapter instanceof KickAdapter ? adapter.getBroadcasterUserId() : undefined
      if (broadcasterUserId) sevenTvChannelId = String(broadcasterUserId)
    } else if (platform === 'twitch') {
      sevenTvPlatformUserId = getSevenTvTwitchPlatformUserId(channelSlug)
    }
    sevenTVService
      .subscribeToChannel(
        platform,
        sevenTvChannelId,
        [channelSlug],
        sevenTvPlatformUserId,
        `own:${platform}`,
      )
      .catch((error) => {
        log.error('Failed to subscribe to 7TV', {
          platform,
          channelSlug: sevenTvChannelId,
          error: String(error),
        })
      })
  }

  return {
    obsRemote: obsRemoteApi,
    getTwirCommands: createTwirCommandsClient(),
    getJeetbotCommands: createJeetbotCommandsClient(),
    getFossabotCommands: createFossabotCommandsClient(),
    getNightbotCommands: createNightbotCommandsClient(),
    getPotatCommands: createPotatCommandsClient(),
    getSupibotCommands: createSupibotCommandsClient(),
    getTwitchActivities: async (params) => {
      const snapshot = await requestTwitchActivitiesSnapshot(params)
      ctx.twitchActivityRefresh?.observeSnapshot(snapshot)
      return snapshot
    },
    getTwitchRewardQueueSummary: (params) =>
      twitchActivity((credentials) =>
        twitchActivities.rewardQueueSummary(credentials, params.channelSlug),
      ),
    getTwitchActivityCapability: async ({ channelSlug }) => {
      if (!ctx.twitchActivityRefresh)
        throw new Error(t('runtime.api.twitchActivitiesNotInitialized'))
      return ctx.twitchActivityRefresh.capability(channelSlug)
    },
    executeTwitchActivityAction: (action) =>
      twitchActivity((credentials) => twitchActivities.execute(credentials, action)),
    getTwitchRewardRedemptions: (params) =>
      twitchActivity((credentials) => twitchActivities.redemptions(credentials, params)),
    getTwitchFollowing: (params = {}) =>
      twitchActivity((credentials) => twitchActivities.following(credentials, params)),
    getTwitchWebSessionStatus: () => TwitchWebSessionStore.status(),
    setTwitchWebSession: async ({ token }) => {
      const session = await twitchRequest(t('runtime.api.action.twitchActivityFailed'), () =>
        twitchActivities.validateWebSession(token),
      )
      const account = AccountStore.findByPlatform('twitch')
      if (account && account.platformUserId !== session.userId)
        throw new Error(t('runtime.api.twitchWebSessionMismatch'))
      await TwitchWebSessionStore.set(session)
      ctx.twitchActivityRefresh?.restart()
      return TwitchWebSessionStore.status()
    },
    clearTwitchWebSession: async () => {
      await TwitchWebSessionStore.clear()
      ctx.twitchActivityRefresh?.restart()
    },
    watchTwitchActivities: async ({ channelSlug, watch }) => {
      if (!ctx.twitchEventSub) throw new Error(t('runtime.api.twitchEventsNotInitialized'))
      ctx.twitchEventSub.watch(channelSlug, watch)
      await ctx.twitchActivityRefresh?.watch(channelSlug, watch)
    },
    ...createStreamerModeApi(ctx.streamerMode),
    reconnectChat: async (params) => {
      if (!ctx.channelActions) throw new Error(t('runtime.api.reconnectUnavailable'))
      return ctx.channelActions.reconnectChat(params)
    },
    reloadChatEmotes: async (params) => {
      if (!ctx.channelActions) throw new Error(t('runtime.api.emoteReloadUnavailable'))
      return ctx.channelActions.reloadChatEmotes(params)
    },
    openChannelPlayer: async (params) => {
      if (!ctx.channelActions) throw new Error(t('runtime.api.channelPlayersUnavailable'))
      return ctx.channelActions.openChannelPlayer(params)
    },
    getPlayerSettings: async () => {
      if (!ctx.channelActions) throw new Error(t('runtime.api.playerSettingsUnavailable'))
      return ctx.channelActions.getPlayerSettings()
    },
    savePlayerSettings: async ({ settings }) => {
      if (!ctx.channelActions) throw new Error(t('runtime.api.playerSettingsUnavailable'))
      return ctx.channelActions.savePlayerSettings(settings)
    },
    getAccounts: async () => AccountStore.findAllActive(),
    getSavedAccounts: async () => AccountStore.findAllSaved(),
    setActiveAccount: async ({ platform, accountId }) => {
      if (!ctx.accountSessions) throw new Error(t('runtime.api.accountSwitchingUnavailable'))
      await ctx.accountSessions.select(platform, accountId)
    },
    forgetAccount: async ({ accountId }) => {
      if (!ctx.accountSessions) throw new Error(t('runtime.api.accountSwitchingUnavailable'))
      await ctx.accountSessions.forget(accountId)
      watchedChannelManager.releaseAccount(accountId)
      ctx.twitchEventSub?.refresh()
      forgetTwitchSendLimiter(accountId)
    },
    setProviderActiveChannel: async (params) => {
      ctx.providerRuntime?.setActiveChannel(params)
    },
    getImageUploaderSettings: imageUploader.getImageUploaderSettings,
    donationAlertsOAuthAvailable: getDonationAlertsDesktopClientId() !== null,
    getDonationConnections: async () => donations().getConnections(),
    getDonationOAuthAvailability,
    connectDonationProvider: async (params) => {
      await Bun.sleep(0)
      donations().connect(params)
    },
    disconnectDonationProvider: async ({ provider }) => {
      await Bun.sleep(0)
      donations().disconnect(provider)
    },
    getDonationSharing: async () => donations().getSharing(),
    setDonationSharing: async ({ provider, enabled }) => {
      await Bun.sleep(0)
      donations().setSharing(provider, enabled)
      return donations().getSharing()
    },
    saveImageUploaderSettings: imageUploader.saveImageUploaderSettings,
    connectTwirImageUploader: imageUploader.connectTwirImageUploader,
    disconnectTwirImageUploader: imageUploader.disconnectTwirImageUploader,
    readClipboardUploadFile,
    uploadClipboardImage: imageUploader.uploadClipboardImage,
    getTranslationSettings: translation.getTranslationSettings,
    saveTranslationSettings: translation.saveTranslationSettings,
    setTranslationCredential: translation.setTranslationCredential,
    removeTranslationCredential: translation.removeTranslationCredential,
    translateText: translation.translateText,
    getTranslationLanguages: translation.getTranslationLanguages,
    getChatHistory: (query) => ctx.twitchHistory?.query(query) ?? readChatHistory(query),
    getChatLoggingSettings: () => readChatLoggingSettings(),
    saveChatLoggingSettings: (settings) => writeChatLoggingSettings(settings),
    exportChatHistory: (params) =>
      ctx.twitchHistory?.export(params) ?? writeChatHistoryExport(params),
    getChatLoggingStatus: () => readChatLoggingStatus(),
    flushChatLogs: () => flushRecordedChatLogs(),

    getSettings: async () => SettingsStore.get(),

    saveSettings: async (params) => {
      SettingsStore.set(params)
    },

    getUserAliases: async () => UserAliasStore.findAll(),

    setUserAlias: async ({ platform, platformUserId, alias }) => {
      if (!alias) {
        UserAliasStore.remove(platform, platformUserId)
      } else {
        UserAliasStore.upsert(platform, platformUserId, alias)
      }
    },

    removeUserAlias: async ({ platform, platformUserId }) => {
      UserAliasStore.remove(platform, platformUserId)
    },

    getChannels: async () => ChannelStore.findAll(),

    authStart: async (params) => {
      ctx.openBrowser(await createAuthUrl(params))
    },

    authLink: async (params) => ({ url: await createAuthUrl(params) }),

    cancelTwitchAuth: async ({ userCode, windowScope }) => {
      if (twitchAuth?.windowScope !== windowScope || twitchAuth.userCode !== userCode) return
      twitchAuth.controller.abort()
      twitchAuth = undefined
      ctx.events.emit('twitch_device_code', null)
    },

    authLogout: async ({ platform }) => {
      if (!ctx.accountSessions) throw new Error(t('runtime.api.accountSwitchingUnavailable'))
      await ctx.accountSessions.select(platform, null)
    },

    joinChannel: async ({ platform, channelSlug }) => {
      const adapter = aggregator.getAdapter(platform)
      if (!adapter) {
        log.warn('No adapter registered for platform', { platform })
        return
      }
      ChannelStore.save(platform, channelSlug)
      ctx.providerRuntime?.setJoined(`own:${platform}`, platform, channelSlug)
      adapter
        .connect(channelSlug)
        .then(() => subscribeSevenTv(platform, channelSlug, adapter))
        .catch((err) => {
          log.error('Failed to connect', { platform, channelSlug, error: String(err) })
        })
    },

    leaveChannel: async ({ platform, channelSlug }) => {
      const adapter = aggregator.getAdapter(platform)
      if (!adapter) return
      ChannelStore.remove(platform, channelSlug)
      ctx.providerRuntime?.setJoined(`own:${platform}`, platform, null)
      sevenTVService
        .unsubscribeFromChannel(platform, channelSlug, `own:${platform}`)
        .catch((err) => {
          log.error('Failed to unsubscribe from 7TV', { platform, channelSlug, error: String(err) })
        })
      adapter.disconnect().catch((err) => {
        log.error('Failed to disconnect', { platform, error: String(err) })
      })
    },

    sendMessage: async ({ platform, channelId, text, replyTo }) => {
      const command = text
        .trim()
        .match(/^\/([a-z]+)/i)?.[1]
        ?.toLowerCase()
      if (command && platformCommands.has(command)) {
        throw new Error(t('runtime.api.slashCommandHandler'))
      }
      const adapter = aggregator.getAdapter(platform)
      if (!adapter) throw new Error(t('runtime.api.noChatAdapter', { platform }))
      return adapter.sendMessage(channelId, text, replyTo).catch((err) => {
        log.error('Failed to send message', { platform, error: String(err) })
        throw err
      })
    },

    prepareSend: async ({ platform }) => {
      aggregator.getAdapter(platform)?.prepareSend?.()
    },

    resolveAvatar: async (params) => resolveAvatarRemote(params),

    executePlatformCommand: async ({ platform, channelSlug, text, accountId }) => {
      if (platform !== 'twitch' && platform !== 'kick')
        throw new Error(t('runtime.api.platformCommandsUnavailable', { platform }))
      const body = await moderationCredentials(platform, channelSlug, accountId)
      if (platform === 'twitch') {
        const credentials = await twitchUserCredentials(body.accessToken)
        return twitchRequest(t('runtime.api.action.platformCommandFailed'), () =>
          twitchChatTools.execute({ ...body, ...credentials, text }),
        )
      }
      const res = await backendFetch('/api/chat-tools/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, platform, text }),
      })
      if (!res.ok) throw await backendFailure(t('runtime.api.action.platformCommandFailed'), res)
      return platformCommandResultSchema.parse(await res.json())
    },

    getChannelRoomState: async ({ platform, channelSlug, accountId }) => {
      const own = aggregator.getAdapter(platform)?.getRoomState?.()
      const current =
        own?.channelId === channelSlug.toLowerCase()
          ? own
          : watchedChannelManager.getRoomState(platform, channelSlug)
      if (current) return current
      if (platform !== 'twitch')
        throw new Error(t('runtime.api.roomSettingsUnavailable', { platform }))
      const body = await moderationCredentials(platform, channelSlug, accountId)
      const credentials = await twitchUserCredentials(body.accessToken)
      return twitchRequest(t('runtime.api.action.loadChatSettings'), () =>
        twitchChatTools.getRoomState({ ...body, ...credentials }),
      )
    },

    getModerationCapabilities: async ({ platform, channelSlug, accountId }) => {
      const body = await moderationCredentials(platform, channelSlug, accountId)
      if (platform === 'twitch') {
        try {
          const credentials = await twitchUserCredentials(body.accessToken)
          return await twitchModeration.getCapabilities({ ...body, ...credentials })
        } catch {
          return { canModerate: false }
        }
      }
      const res = await backendFetch('/api/moderation/capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, platform }),
      })
      if (!res.ok)
        throw await backendFailure(t('runtime.api.action.checkModerationPermissions'), res)
      return z.object({ canModerate: z.boolean() }).parse(await res.json())
    },

    moderateMessage: async (params) => {
      const body = await moderationCredentials(
        params.platform,
        params.channelSlug,
        params.accountId,
      )
      if (params.platform === 'twitch') {
        const credentials = await twitchUserCredentials(body.accessToken)
        const result = await twitchModeration.execute({ ...body, ...credentials, ...params })
        if (!result.success)
          throw new Error(result.error?.message || t('runtime.api.moderationRejected'))
        return { success: true }
      }
      const res = await backendFetch('/api/moderation/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          platform: params.platform,
          messageId: params.messageId,
          targetUserId: params.targetUserId,
          action: params.action,
          durationSeconds: params.durationSeconds,
        }),
      })
      if (!res.ok) throw await backendFailure(t('runtime.api.action.moderationFailed'), res)
      const result = z
        .object({
          success: z.boolean(),
          error: z.object({ message: z.string().optional() }).optional(),
        })
        .parse(await res.json())
      if (!result.success) {
        throw new Error(result.error?.message || t('runtime.api.moderationRejected'))
      }
      return { success: true }
    },

    getStreamStatus: async ({ platform, channelId }) => {
      const res = await backendFetch(
        `/api/stream-status?platform=${platform}&channelId=${encodeURIComponent(channelId)}`,
      )
      if (!res.ok) throw await backendFailure(t('runtime.api.action.loadStreamInfo'), res)
      return streamStatusResponseSchema.parse(await res.json())
    },

    updateStream: async (params) => {
      const { platform, channelId, title, categoryId } = params
      if (platform !== 'twitch' && platform !== 'kick') {
        throw new Error('Stream updates are unavailable for this platform.')
      }
      const account = AccountStore.findByPlatform(platform)
      if (!account) throw new Error(t('runtime.api.noAccountFound', { platform }))
      const tokens = AccountStore.getTokens(account.id)
      if (!tokens?.accessToken) throw new Error(t('runtime.api.noAccessToken', { platform }))

      if (platform === 'twitch') {
        const credentials = await twitchUserCredentials(await currentTwitchAccessToken(account.id))
        return updateTwitchStream({ channelId, title, categoryId }, credentials)
      }
      const body: UpdateStreamRequest = {
        platform,
        channelId,
        title,
        categoryId,
        userAccessToken: tokens.accessToken,
      }
      const res = await backendFetch(`/api/update-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw await backendFailure(t('runtime.api.action.updateStream'), res)
      return updateStreamResponseSchema.parse(await res.json())
    },

    searchCategories: async ({ platform, query }) => {
      const res = await backendFetch(
        `/api/search-categories?platform=${platform}&query=${encodeURIComponent(query)}`,
      )
      if (!res.ok) throw await backendFailure(t('runtime.api.action.categorySearchFailed'), res)
      return searchCategoriesResponseSchema.parse(await res.json())
    },

    getChannelsStatus: async ({ channels }) => {
      const res = await backendFetch(`/api/channels-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channels: channels.map(({ platform, channelId, channelLogin }) => ({
            platform,
            channelId,
            channelLogin,
          })),
        }),
      })
      if (!res.ok) throw await backendFailure(t('runtime.api.action.loadChannelStatus'), res)
      return channelsStatusResponseSchema.parse(await res.json())
    },

    getRecentMessages: async (params) => {
      const account = AccountStore.findByPlatform('twitch')
      if (account)
        void ctx.twitchHistory
          ?.refresh(account.username)
          .catch((error) => log.debug('Twitch history unavailable', { error: String(error) }))
      return MessageStore.getRecent(params?.limit ?? 100)
    },

    getUserChatHistory: async ({
      platform,
      platformUserId,
      channelId,
      username,
      limit,
      cursor,
    }) => {
      const query = { platform, channelId, authorId: platformUserId, limit: limit ?? 50, cursor }
      return ctx.twitchHistory?.query(query, username) ?? readChatHistory(query)
    },

    getUserProfile: async (params) => {
      const { platform, platformUserId, channelSlug } = params
      const request = { platform, platformUserId, channelSlug }
      const account = AccountStore.findByPlatform('twitch')
      const accessToken = account ? await twitchAccessTokenIfAvailable(account.id) : undefined
      const response = await backendFetch('/api/user-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!response.ok)
        throw await backendFailure(t('runtime.api.action.loadUserProfile'), response)
      const profile = userProfileSnapshotSchema.parse(await response.json())
      return accessToken
        ? enrichTwitchUserProfile(request, profile, accessToken).catch(() => profile)
        : profile
    },
    getUserNotes: async (params) => getUserNotes(params),
    setUserNotes: async (params) => setUserNotes(params),
    getModerationSettings: async () => getModerationSettings(),
    saveModerationSettings: async (settings) => saveModerationSettings(settings),

    getUserCardMetadata: async ({ platform, platformUserId, username, channelId, channelSlug }) => {
      const request = { platform, platformUserId, username, channelId, channelSlug }
      const account = platform === 'twitch' ? AccountStore.findByPlatform(platform) : null
      const accessToken = account ? await twitchAccessTokenIfAvailable(account.id) : undefined
      const details = accessToken
        ? loadTwitchUserCardDetails(request, accessToken).catch(() => undefined)
        : undefined
      const res = await backendFetch('/api/user-card-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!res.ok) throw await backendFailure(t('runtime.api.action.loadAccountDetails'), res)
      const metadata = userCardMetadataResponseSchema.parse(await res.json())
      return { ...metadata, ...(await details) }
    },

    getStatuses: async () => [...currentStatuses.values()],

    resolveMentionUser,

    getChannelEmotes: async ({ platform, channelId }) => {
      const runtime = (ctx.providerRuntime ??= createDesktopProviderRuntime())
      runtime.refreshPreferences()
      return runtime.warm(platform, channelId)
    },
    getEmoteProviderErrors: async () => getProviderErrors(),
    getUserCosmetics: async ({ platform, platformUserId, username, preferences }) => {
      const cosmetics = await getUserCosmetics(platform, platformUserId, username, preferences)
      if (cosmetics && cosmetics.lookupStatus !== 'unavailable')
        void ctx.providerRuntime
          ?.warmAuthorPersonal(platform, platformUserId, cosmetics.personalEmoteSetId)
          .catch((error) => log.warn('Could not warm personal emotes', { error: String(error) }))
      return cosmetics
    },
    getPaintNameImage: ({ name, paint, fontSize, fontFamily }) =>
      getPaintNameImage(name, paint, fontSize, fontFamily),

    getAppVersion: async () => APP_VERSION,
    checkForUpdate: () => updater.check(),
    downloadUpdate: () => updater.download(),
    applyUpdate: () => updater.apply(),
    skipUpdate: ({ hash }) => updater.skip(hash),
    getReleaseNotes: async ({ version }) => {
      const cached = readCachedReleaseNotes(version)
      // Preview remounts must not burn the unauthenticated GitHub API limit.
      const preview = process.env.TWIRCHAT_CHANGELOG_PREVIEW === '1'
      if (preview && cached && process.env.TWIRCHAT_RELEASE_NOTES_REFRESH !== '1') return cached

      const url = `https://api.github.com/repos/Satont/twirchat/releases/tags/v${version}`
      try {
        const res = await fetch(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'TwirChat',
          },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) return cached
        const release = githubReleaseSchema.parse(await res.json())
        const notes = {
          version: release.tag_name?.replace(/^v/u, '') ?? version,
          releaseNotes: release.body ?? '',
          publishedAt: release.published_at ?? '',
          htmlUrl:
            release.html_url ?? `https://github.com/Satont/twirchat/releases/tag/v${version}`,
        }
        if (notes.releaseNotes) writeCachedReleaseNotes(notes)
        return notes
      } catch (error) {
        log.warn('Could not load release notes', { version, error: String(error) })
        return cached
      }
    },

    getWatchedChannels: async () => {
      const builtin = watchedChannelManager.getAll()
      const external = ctx.pluginChannels?.list() ?? []
      return external.length === 0
        ? builtin
        : [...builtin, ...external].toSorted((a, b) => a.createdAt - b.createdAt)
    },

    setActiveWatchedChannels: async ({ ids, paneAccounts }) => {
      watchedChannelManager.setPaneAccounts(paneAccounts ?? {})
      const active = new Set(ids)
      for (const channel of watchedChannelManager.getAll())
        ctx.providerRuntime?.setJoined(
          `watched:${channel.id}`,
          channel.platform,
          active.has(channel.id) ? channel.channelSlug : null,
        )
      ctx.pluginChannels?.setActive(active)
      await watchedChannelManager.setActiveChannels(ids)
    },

    addWatchedChannel: async ({ platform, channelSlug }) => {
      if (isPluginPlatform(platform)) {
        if (!ctx.pluginChannels) throw new Error(t('runtime.api.pluginTransportsUnavailable'))
        return ctx.pluginChannels.add(platform, channelSlug)
      }
      void ctx.providerRuntime?.warm(platform, channelSlug).catch((error) =>
        log.warn('Could not warm channel emotes', {
          platform,
          channelSlug,
          error: String(error),
        }),
      )
      const channel = await watchedChannelManager.addChannel(platform, channelSlug)
      return channel
    },

    removeWatchedChannel: async ({ id }) => {
      if (ctx.pluginChannels?.remove(id)) return
      const channel = watchedChannelManager.getAll().find((candidate) => candidate.id === id)
      if (channel) ctx.providerRuntime?.setJoined(`watched:${id}`, channel.platform, null)
      await watchedChannelManager.removeChannel(id)
    },

    setWatchedChannelAccount: async ({ id, accountId }) => {
      if (accountId !== null) {
        const channel = watchedChannelManager.getAll().find((candidate) => candidate.id === id)
        const account = AccountStore.findById(accountId)
        if (!channel) throw new Error(t('runtime.api.chatNoLongerSaved'))
        if (channel.platform === 'youtube') throw new Error(t('runtime.api.youtubeDefaultAccount'))
        if (account?.platform !== channel.platform)
          throw new Error(t('runtime.api.accountPlatformMismatch'))
      }
      const channel = watchedChannelManager.setChannelAccount(id, accountId)
      if (channel.platform === 'twitch') ctx.twitchEventSub?.refresh()
      return channel
    },

    getWatchedChannelMessages: async ({ id }) => {
      const channel = watchedChannelManager.getAll().find((candidate) => candidate.id === id)
      if (!channel) return []
      if (channel.platform === 'twitch')
        void ctx.twitchHistory
          ?.refresh(channel.channelSlug)
          .catch((error) => log.debug('Twitch history unavailable', { error: String(error) }))
      const local = await readChatHistory({
        platform: channel.platform,
        channelId: channel.channelSlug,
        limit: 200,
      })
      return mergeChatMessageSnapshot(watchedChannelManager.getMessages(id), local.messages, 200)
    },

    sendWatchedChannelMessage: async ({ id, text, replyTo, accountId }) => {
      const command = text
        .trim()
        .match(/^\/([a-z]+)/i)?.[1]
        ?.toLowerCase()
      if (command && platformCommands.has(command)) {
        throw new Error(t('runtime.api.slashCommandHandler'))
      }
      return watchedChannelManager.sendMessage(id, text, replyTo, accountId)
    },

    prepareWatchedChannelSend: async ({ id, accountId }) => {
      watchedChannelManager.prepareSend(id, accountId)
    },

    setPanelAccount: async ({ tabId, panelId, accountId }) => {
      const layout = WatchedChannelsLayoutStore.get(tabId)
      const panel = WatchedChannelsLayoutStore.getPanelNode(layout, panelId)
      if (panel?.content.type !== 'watched') throw new Error(t('runtime.api.chatNoLongerSaved'))
      const channelId = panel.content.channelId
      const channel = watchedChannelManager.getAll().find((candidate) => candidate.id === channelId)
      if (!channel) throw new Error(t('runtime.api.chatNoLongerSaved'))
      if (channel.platform === 'youtube') throw new Error(t('runtime.api.youtubeDefaultAccount'))
      if (accountId === null) panel.content = { type: 'watched', channelId }
      else {
        platformAccount(channel.platform, accountId)
        panel.content = { type: 'watched', channelId, accountId }
      }
      WatchedChannelsLayoutStore.set(tabId, layout)
    },

    getWatchedChannelStatuses: async () => {
      return watchedChannelManager.getAllStatuses()
    },

    getPluginTransports: () => ctx.pluginChannels?.transports() ?? [],
    observePluginChannel: (id, listener) => ctx.pluginChannels?.observe(id, listener) ?? (() => {}),
    sendPluginChannelMessage: async ({ id, text }) => {
      if (!ctx.pluginChannels) throw new Error(t('runtime.api.pluginTransportsUnavailable'))
      await ctx.pluginChannels.sendMessage(id, text)
    },

    getChatters: async ({ targets }) => {
      const results: ChannelChatters[] = []
      for (const target of targets) {
        try {
          if (target.platform === 'twitch') {
            results.push(await fetchTwitchChatters(target))
          } else if (target.platform === 'kick') {
            results.push(await fetchKickChatters(target.channelSlug))
          } else {
            results.push({
              ...target,
              total: 0,
              groups: [],
              error: t('runtime.api.chattersUnsupportedPlatform', { platform: target.platform }),
            })
          }
        } catch (error) {
          results.push({ ...target, total: 0, groups: [], error: String(error) })
        }
      }
      return { results }
    },

    openExternalUrl: async ({ url }) => {
      ctx.openBrowser(url)
    },

    ...createLayoutApi((key, value) => {
      if (key === 'emote_preferences_v1') ctx.providerRuntime?.refreshPreferences()
      ctx.onUiStateSaved?.(key, value)
    }),

    copyText: async ({ text }) => {
      const candidates: string[][] =
        process.platform === 'darwin'
          ? [['pbcopy']]
          : process.platform === 'win32'
            ? [['clip']]
            : process.env.WAYLAND_DISPLAY
              ? [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard']]
              : [['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard'], ['wl-copy']]
      let lastError: unknown = null
      for (const cmd of candidates) {
        try {
          const proc = Bun.spawn(cmd, {
            stdin: 'pipe',
            stdout: 'ignore',
            stderr: 'ignore',
            windowsHide: true,
          })
          await proc.stdin.write(text)
          await proc.stdin.end()
          await proc.exited
          if (proc.exitCode === 0) return
        } catch (error) {
          lastError = error
        }
      }
      throw new Error(t('runtime.api.clipboardUnavailable', { error: String(lastError) }))
    },
    readClipboard: () => systemIntegration.readClipboard(),
    notify: (params) => systemIntegration.notify(params),
  }
}
