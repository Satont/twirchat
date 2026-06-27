/**
 * TwirChat Deno Desktop — Binding Type Contract
 *
 * Defines the typed contract between the Deno main process and the
 * webview (Vue) side. Replaces the Electrobun RPC schema.
 *
 * The Deno side registers handlers via win.bind().
 * The webview side calls them via the global `bindings` object.
 */

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
} from "@twirchat/shared";
import type {
  ChannelsStatusResponse,
  ChannelStatusRequest,
  SearchCategoriesResponse,
  SevenTVEmote,
  StreamStatusResponse,
  UpdateStreamResponse,
  UserCardMetadataRequest,
  UserCardMetadataResponse,
} from "@twirchat/shared/protocol";

export interface UserAlias {
  platform: Platform;
  platformUserId: string;
  alias: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserChatHistoryCursor {
  createdAt: number;
  id: string;
}

export interface UserChatHistoryPage {
  messages: NormalizedChatMessage[];
  nextCursor: UserChatHistoryCursor | null;
  hasMore: boolean;
}

export interface AppBindings {
  getAccounts(): Promise<Account[]>;
  getSettings(): Promise<AppSettings>;
  saveSettings(s: AppSettings): Promise<void>;
  getChannels(): Promise<Partial<Record<Platform, string[]>>>;
  getUserAliases(): Promise<UserAlias[]>;
  setUserAlias(
    params: { platform: Platform; platformUserId: string; alias: string },
  ): Promise<void>;
  removeUserAlias(
    params: { platform: Platform; platformUserId: string },
  ): Promise<void>;
  authStart(params: { platform: Platform }): Promise<void>;
  authLogout(params: { platform: Platform }): Promise<void>;
  joinChannel(
    params: { platform: Platform; channelSlug: string },
  ): Promise<void>;
  leaveChannel(
    params: { platform: Platform; channelSlug: string },
  ): Promise<void>;
  sendMessage(params: {
    platform: Platform;
    channelId: string;
    text: string;
    replyToMessageId?: string;
  }): Promise<void>;
  getStreamStatus(params: {
    platform: "twitch" | "kick";
    channelId: string;
  }): Promise<StreamStatusResponse>;
  updateStream(params: {
    platform: Platform;
    channelId: string;
    title?: string;
    category?: string;
  }): Promise<UpdateStreamResponse>;
  searchCategories(params: {
    platform: "twitch" | "kick";
    query: string;
  }): Promise<SearchCategoriesResponse>;
  getChannelsStatus(
    params: { channels: ChannelStatusRequest[] },
  ): Promise<ChannelsStatusResponse>;
  getStatuses(): Promise<PlatformStatusInfo[]>;
  getRecentMessages(
    params?: { limit?: number },
  ): Promise<NormalizedChatMessage[]>;
  getUserChatHistory(params: {
    platform: Platform;
    platformUserId: string;
    limit?: number;
    cursor?: UserChatHistoryCursor;
  }): Promise<UserChatHistoryPage>;
  getUserCardMetadata(
    params: UserCardMetadataRequest,
  ): Promise<UserCardMetadataResponse>;
  getUsernameColor(
    params: { platform: Platform; username: string },
  ): Promise<string | null>;
  getChannelEmotes(
    params: { platform: Platform; channelId: string },
  ): Promise<SevenTVEmote[]>;
  checkForUpdate(): Promise<{
    updateAvailable: boolean;
    version?: string;
    currentVersion: string;
  }>;
  downloadUpdate(): Promise<{ success: boolean; error?: string }>;
  applyUpdate(): Promise<void>;
  skipUpdate(params: { hash: string }): Promise<void>;
  getWatchedChannels(): Promise<WatchedChannel[]>;
  addWatchedChannel(params: {
    platform: "twitch" | "kick" | "youtube";
    channelSlug: string;
  }): Promise<WatchedChannel>;
  removeWatchedChannel(params: { id: string }): Promise<void>;
  getWatchedChannelMessages(
    params: { id: string },
  ): Promise<NormalizedChatMessage[]>;
  sendWatchedChannelMessage(params: {
    id: string;
    text: string;
    replyToMessageId?: string;
  }): Promise<void>;
  getWatchedChannelStatuses(): Promise<
    Array<{ channelId: string; status: PlatformStatusInfo }>
  >;
  openExternalUrl(params: { url: string }): Promise<void>;
  getTabChannelIds(): Promise<string[] | null>;
  setTabChannelIds(params: { ids: string[] }): Promise<void>;
  getWatchedChannelsLayout(
    params: { tabId: string },
  ): Promise<WatchedChannelsLayout | null>;
  setWatchedChannelsLayout(
    params: { tabId: string; layout: WatchedChannelsLayout },
  ): Promise<void>;
  removePanel(params: { tabId: string; panelId: string }): Promise<void>;
  assignChannelToPanel(params: {
    tabId: string;
    panelId: string;
    channelId: string | null;
  }): Promise<void>;
  splitPanel(params: {
    tabId: string;
    panelId: string;
    direction: SplitDirection;
  }): Promise<{ original: LayoutNode; newPanel: LayoutNode }>;
}

declare global {
  const bindings: AppBindings;
}
