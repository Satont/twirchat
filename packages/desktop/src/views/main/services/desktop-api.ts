import type {
  Account,
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
import * as DesktopService from '../../../../frontend/bindings/github.com/Satont/twirchat/packages/desktop/internal/bridge/desktopservice.js'
import {
  ApplicationCapabilities,
  GatewayRequest,
  RequestMethod,
} from '../../../../frontend/bindings/github.com/Satont/twirchat/packages/desktop/internal/contracts/models.js'
import { desktopEvents, type DesktopEventMap, type DesktopEvents } from './desktop-events'

export interface UserAlias {
  platform: Platform
  platformUserId: string
  alias: string
  createdAt: number
  updatedAt: number
}

export interface UserChatHistoryCursor {
  createdAt: number
  id: string
}

export interface UserChatHistoryPage {
  messages: NormalizedChatMessage[]
  nextCursor: UserChatHistoryCursor | null
  hasMore: boolean
}

export type ModerationPlatform = 'twitch' | 'kick'
export type ModerationAction = 'delete_message' | 'timeout' | 'ban'

export interface AvatarResolution {
  avatarUrl?: string
}

export interface ModerationCapabilities {
  canModerate: boolean
}

export interface ModerationActionResult {
  success: boolean
}

type LegacyRequestMap = {
  getAccounts: { params: void; response: Account[] }
  getSettings: { params: void; response: AppSettings }
  saveSettings: { params: AppSettings; response: void }
  getUserAliases: { params: void; response: UserAlias[] }
  setUserAlias: {
    params: { platform: Platform; platformUserId: string; alias: string }
    response: void
  }
  removeUserAlias: { params: { platform: Platform; platformUserId: string }; response: void }
  getChannels: { params: void; response: Partial<Record<Platform, string[]>> }
  authStart: { params: { platform: Platform }; response: void }
  authLogout: { params: { platform: Platform }; response: void }
  joinChannel: { params: { platform: Platform; channelSlug: string }; response: void }
  leaveChannel: { params: { platform: Platform; channelSlug: string }; response: void }
  sendMessage: {
    params: { platform: Platform; channelId: string; text: string; replyToMessageId?: string }
    response: void
  }
  resolveAvatar: {
    params: { platform: ModerationPlatform; authorId: string; username?: string }
    response: AvatarResolution
  }
  getModerationCapabilities: {
    params: { platform: ModerationPlatform; channelSlug: string }
    response: ModerationCapabilities
  }
  moderateMessage: {
    params: {
      platform: ModerationPlatform
      channelSlug: string
      messageId: string
      targetUserId: string
      action: ModerationAction
      durationSeconds?: number
    }
    response: ModerationActionResult
  }
  getStreamStatus: {
    params: { platform: 'twitch' | 'kick'; channelId: string }
    response: StreamStatusResponse
  }
  updateStream: {
    params: Omit<UpdateStreamRequest, 'userAccessToken'>
    response: UpdateStreamResponse
  }
  searchCategories: {
    params: { platform: 'twitch' | 'kick'; query: string }
    response: SearchCategoriesResponse
  }
  getChannelsStatus: {
    params: { channels: ChannelStatusRequest[] }
    response: ChannelsStatusResponse
  }
  getRecentMessages: { params: { limit?: number } | void; response: NormalizedChatMessage[] }
  getUserChatHistory: {
    params: {
      platform: Platform
      platformUserId: string
      limit?: number
      cursor?: UserChatHistoryCursor
    }
    response: UserChatHistoryPage
  }
  getUserCardMetadata: { params: UserCardMetadataRequest; response: UserCardMetadataResponse }
  getStatuses: { params: void; response: PlatformStatusInfo[] }
  getUsernameColor: { params: { platform: Platform; username: string }; response: string | null }
  getChannelEmotes: {
    params: { platform: Platform; channelId: string }
    response: EmoteCatalogEntry[]
  }
  checkForUpdate: {
    params: void
    response: { updateAvailable: boolean; version?: string; currentVersion: string }
  }
  downloadUpdate: { params: void; response: { success: boolean; error?: string } }
  applyUpdate: { params: void; response: void }
  skipUpdate: { params: { hash: string }; response: void }
  getWatchedChannels: { params: void; response: WatchedChannel[] }
  addWatchedChannel: {
    params: { platform: 'twitch' | 'kick' | 'youtube'; channelSlug: string }
    response: WatchedChannel
  }
  removeWatchedChannel: { params: { id: string }; response: void }
  getWatchedChannelMessages: { params: { id: string }; response: NormalizedChatMessage[] }
  sendWatchedChannelMessage: {
    params: { id: string; text: string; replyToMessageId?: string }
    response: void
  }
  getWatchedChannelStatuses: {
    params: void
    response: Array<{ channelId: string; status: PlatformStatusInfo }>
  }
  openExternalUrl: { params: { url: string }; response: void }
  getTabChannelIds: { params: void; response: string[] | null }
  setTabChannelIds: { params: { ids: string[] }; response: void }
  getWatchedChannelsLayout: {
    params: { tabId: string }
    response: WatchedChannelsLayout | null
  }
  setWatchedChannelsLayout: {
    params: { tabId: string; layout: WatchedChannelsLayout }
    response: void
  }
  removePanel: { params: { tabId: string; panelId: string }; response: void }
  assignChannelToPanel: {
    params: { tabId: string; panelId: string; channelId: string | null }
    response: void
  }
  splitPanel: {
    params: { tabId: string; panelId: string; direction: SplitDirection }
    response: { original: LayoutNode; newPanel: LayoutNode }
  }
}

type LegacyRequestFunction<Definition> = Definition extends {
  params: infer Params
  response: infer Response
}
  ? [Params] extends [void]
    ? () => Promise<Response>
    : (params: Params) => Promise<Response>
  : never

export type LegacyRequests = {
  [Method in keyof LegacyRequestMap]: LegacyRequestFunction<LegacyRequestMap[Method]>
}

export interface GeneratedDesktopBinding {
  Call(request: GatewayRequest): Promise<unknown>
  Capabilities(): Promise<ApplicationCapabilities>
}

export interface DesktopApi {
  capabilities(): Promise<{ updates: false }>
  request: LegacyRequests
}

export interface LegacyRpcFacade {
  request: LegacyRequests
  addMessageListener<EventName extends keyof DesktopEventMap>(
    eventName: EventName,
    handler: (payload: DesktopEventMap[EventName]) => void,
  ): void
  removeMessageListener<EventName extends keyof DesktopEventMap>(
    eventName: EventName,
    handler: (payload: DesktopEventMap[EventName]) => void,
  ): void
}

const generatedBinding: GeneratedDesktopBinding = {
  Call: DesktopService.Call,
  Capabilities: DesktopService.Capabilities,
}

const requestMethods = {
  getAccounts: RequestMethod.RequestGetAccounts,
  getSettings: RequestMethod.RequestGetSettings,
  saveSettings: RequestMethod.RequestSaveSettings,
  getUserAliases: RequestMethod.RequestGetUserAliases,
  setUserAlias: RequestMethod.RequestSetUserAlias,
  removeUserAlias: RequestMethod.RequestRemoveUserAlias,
  getChannels: RequestMethod.RequestGetChannels,
  authStart: RequestMethod.RequestAuthStart,
  authLogout: RequestMethod.RequestAuthLogout,
  joinChannel: RequestMethod.RequestJoinChannel,
  leaveChannel: RequestMethod.RequestLeaveChannel,
  sendMessage: RequestMethod.RequestSendMessage,
  resolveAvatar: RequestMethod.RequestResolveAvatar,
  getModerationCapabilities: RequestMethod.RequestGetModerationCapabilities,
  moderateMessage: RequestMethod.RequestModerateMessage,
  getStreamStatus: RequestMethod.RequestGetStreamStatus,
  updateStream: RequestMethod.RequestUpdateStream,
  searchCategories: RequestMethod.RequestSearchCategories,
  getChannelsStatus: RequestMethod.RequestGetChannelsStatus,
  getRecentMessages: RequestMethod.RequestGetRecentMessages,
  getUserChatHistory: RequestMethod.RequestGetUserChatHistory,
  getUserCardMetadata: RequestMethod.RequestGetUserCardMetadata,
  getStatuses: RequestMethod.RequestGetStatuses,
  getUsernameColor: RequestMethod.RequestGetUsernameColor,
  getChannelEmotes: RequestMethod.RequestGetChannelEmotes,
  checkForUpdate: RequestMethod.RequestCheckForUpdate,
  downloadUpdate: RequestMethod.RequestDownloadUpdate,
  applyUpdate: RequestMethod.RequestApplyUpdate,
  skipUpdate: RequestMethod.RequestSkipUpdate,
  getWatchedChannels: RequestMethod.RequestGetWatchedChannels,
  addWatchedChannel: RequestMethod.RequestAddWatchedChannel,
  removeWatchedChannel: RequestMethod.RequestRemoveWatchedChannel,
  getWatchedChannelMessages: RequestMethod.RequestGetWatchedChannelMessages,
  sendWatchedChannelMessage: RequestMethod.RequestSendWatchedChannelMessage,
  getWatchedChannelStatuses: RequestMethod.RequestGetWatchedChannelStatuses,
  openExternalUrl: RequestMethod.RequestOpenExternalURL,
  getTabChannelIds: RequestMethod.RequestGetTabChannelIDs,
  setTabChannelIds: RequestMethod.RequestSetTabChannelIDs,
  getWatchedChannelsLayout: RequestMethod.RequestGetWatchedChannelsLayout,
  setWatchedChannelsLayout: RequestMethod.RequestSetWatchedChannelsLayout,
  removePanel: RequestMethod.RequestRemovePanel,
  assignChannelToPanel: RequestMethod.RequestAssignChannelToPanel,
  splitPanel: RequestMethod.RequestSplitPanel,
} satisfies Record<keyof LegacyRequestMap, RequestMethod>

export function createDesktopApi(binding: GeneratedDesktopBinding = generatedBinding): DesktopApi {
  const call = async <Method extends keyof LegacyRequestMap>(
    method: Method,
    params: LegacyRequestMap[Method]['params'],
  ): Promise<LegacyRequestMap[Method]['response']> => {
    return binding.Call(new GatewayRequest({ method: requestMethods[method], params })) as Promise<
      LegacyRequestMap[Method]['response']
    >
  }

  return {
    capabilities: async () => {
      const capabilities = await binding.Capabilities()
      return { updates: capabilities.updates as false }
    },
    request: {
      getAccounts: () => call('getAccounts', undefined),
      getSettings: () => call('getSettings', undefined),
      saveSettings: (params) => call('saveSettings', params),
      getUserAliases: () => call('getUserAliases', undefined),
      setUserAlias: (params) => call('setUserAlias', params),
      removeUserAlias: (params) => call('removeUserAlias', params),
      getChannels: () => call('getChannels', undefined),
      authStart: (params) => call('authStart', params),
      authLogout: (params) => call('authLogout', params),
      joinChannel: (params) => call('joinChannel', params),
      leaveChannel: (params) => call('leaveChannel', params),
      sendMessage: (params) => call('sendMessage', params),
      resolveAvatar: (params) => call('resolveAvatar', params),
      getModerationCapabilities: (params) => call('getModerationCapabilities', params),
      moderateMessage: (params) => call('moderateMessage', params),
      getStreamStatus: (params) => call('getStreamStatus', params),
      updateStream: (params) => call('updateStream', params),
      searchCategories: (params) => call('searchCategories', params),
      getChannelsStatus: (params) => call('getChannelsStatus', params),
      getRecentMessages: async (params) => {
        const messages = await call('getRecentMessages', params)
        return messages.map(toChatMessage)
      },
      getUserChatHistory: async (params) => {
        const page = await call('getUserChatHistory', params)
        return { ...page, messages: page.messages.map(toChatMessage) }
      },
      getUserCardMetadata: (params) => call('getUserCardMetadata', params),
      getStatuses: () => call('getStatuses', undefined),
      getUsernameColor: (params) => call('getUsernameColor', params),
      getChannelEmotes: (params) => call('getChannelEmotes', params),
      checkForUpdate: () => call('checkForUpdate', undefined),
      downloadUpdate: () => call('downloadUpdate', undefined),
      applyUpdate: () => call('applyUpdate', undefined),
      skipUpdate: (params) => call('skipUpdate', params),
      getWatchedChannels: () => call('getWatchedChannels', undefined),
      addWatchedChannel: (params) => call('addWatchedChannel', params),
      removeWatchedChannel: (params) => call('removeWatchedChannel', params),
      getWatchedChannelMessages: async (params) => {
        const messages = await call('getWatchedChannelMessages', params)
        return messages.map(toChatMessage)
      },
      sendWatchedChannelMessage: (params) => call('sendWatchedChannelMessage', params),
      getWatchedChannelStatuses: () => call('getWatchedChannelStatuses', undefined),
      openExternalUrl: (params) => call('openExternalUrl', params),
      getTabChannelIds: () => call('getTabChannelIds', undefined),
      setTabChannelIds: (params) => call('setTabChannelIds', params),
      getWatchedChannelsLayout: (params) => call('getWatchedChannelsLayout', params),
      setWatchedChannelsLayout: (params) => call('setWatchedChannelsLayout', params),
      removePanel: (params) => call('removePanel', params),
      assignChannelToPanel: (params) => call('assignChannelToPanel', params),
      splitPanel: (params) => call('splitPanel', params),
    },
  }
}

export function toChatMessage(message: NormalizedChatMessage): NormalizedChatMessage {
  return { ...message, timestamp: toDate(message.timestamp) }
}

function toDate(timestamp: Date | string): Date {
  return timestamp instanceof Date ? timestamp : new Date(timestamp)
}

export const desktopApi = createDesktopApi()
export function createRpcFacade(api: DesktopApi, events: DesktopEvents): LegacyRpcFacade {
  const subscriptions = new Map<string, Map<Function, () => void>>()

  return {
    request: api.request,
    addMessageListener(eventName, handler) {
      const eventSubscriptions = subscriptions.get(eventName) ?? new Map()
      subscriptions.set(eventName, eventSubscriptions)
      eventSubscriptions.get(handler)?.()
      eventSubscriptions.set(handler, events.on(eventName, handler))
    },
    removeMessageListener(eventName, handler) {
      const eventSubscriptions = subscriptions.get(eventName)
      const unsubscribe = eventSubscriptions?.get(handler)
      if (!unsubscribe) {
        return
      }

      unsubscribe()
      eventSubscriptions?.delete(handler)
      if (eventSubscriptions?.size === 0) {
        subscriptions.delete(eventName)
      }
    },
  }
}

export const rpc = createRpcFacade(desktopApi, desktopEvents)
