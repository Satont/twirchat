import { glob } from 'fs/promises';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SRC_DIR = 'packages/desktop/src/views/main';

const replacements = [
  // Imports
  {
    regex: /import \{ rpc \} from '(.*)\/main'/g,
    replacement: `import { invoke } from '@tauri-apps/api/core'`
  },
  {
    regex: /import \{ rpc \} from "\.\.\/main"/g,
    replacement: `import { invoke } from '@tauri-apps/api/core'`
  },
  {
    regex: /import \{ rpc \} from '\.\/main'/g,
    replacement: `import { invoke } from '@tauri-apps/api/core'`
  },
  {
    regex: /import \{ useRpcListener \} from '(.*)\/composables\/useRpcListener'/g,
    replacement: `import { useTauriEvent } from '$1/composables/useTauriEvent'`
  },
  
  // RPC Requests
  { regex: /rpc\.request\.getAccounts!?\(\)/g, replacement: `invoke<Account[]>('get_accounts')` },
  { regex: /rpc\.request\.getSettings!?\(\)/g, replacement: `invoke<AppSettings>('get_settings')` },
  { regex: /rpc\.request\.saveSettings!?\((.*?)\)/g, replacement: `invoke('save_settings', { settings: $1 })` },
  { regex: /rpc\.request\.getUserAliases!?\(\)/g, replacement: `invoke<UserAlias[]>('get_user_aliases')` },
  { regex: /rpc\.request\.setUserAlias!?\(\{\s*platform,\s*platformUserId,\s*alias\s*\}\)/g, replacement: `invoke('set_user_alias', { platform, platform_user_id: platformUserId, alias })` },
  { regex: /rpc\.request\.removeUserAlias!?\(\{\s*platform,\s*platformUserId\s*\}\)/g, replacement: `invoke('remove_user_alias', { platform, platform_user_id: platformUserId })` },
  { regex: /rpc\.request\.getChannels!?\(\)/g, replacement: `invoke<Record<Platform, string[]>>('get_channels')` },
  { regex: /rpc\.request\.authStart!?\(\{\s*platform\s*\}\)/g, replacement: `invoke('auth_start', { platform })` },
  { regex: /rpc\.request\.authLogout!?\(\{\s*platform\s*\}\)/g, replacement: `invoke('auth_logout', { platform })` },
  { regex: /rpc\.request\.joinChannel!?\(\{\s*channelSlug:\s*([a-zA-Z0-9_.]+),\s*platform\s*\}\)/g, replacement: `invoke('join_channel', { platform, channel_slug: $1 })` },
  { regex: /rpc\.request\.joinChannel!?\(\{\s*platform,\s*channelSlug:\s*([a-zA-Z0-9_.]+)\s*\}\)/g, replacement: `invoke('join_channel', { platform, channel_slug: $1 })` },
  { regex: /rpc\.request\.joinChannel!?\(\{\s*platform,\s*channelSlug\s*\}\)/g, replacement: `invoke('join_channel', { platform, channel_slug: channelSlug })` },
  { regex: /rpc\.request\.leaveChannel!?\(\{\s*channelSlug:\s*([a-zA-Z0-9_.]+),\s*platform\s*\}\)/g, replacement: `invoke('leave_channel', { platform, channel_slug: $1 })` },
  { regex: /rpc\.request\.leaveChannel!?\(\{\s*platform,\s*channelSlug:\s*([a-zA-Z0-9_.]+)\s*\}\)/g, replacement: `invoke('leave_channel', { platform, channel_slug: $1 })` },
  { regex: /rpc\.request\.leaveChannel!?\(\{\s*platform,\s*channelSlug\s*\}\)/g, replacement: `invoke('leave_channel', { platform, channel_slug: channelSlug })` },
  { regex: /rpc\.request\.sendMessage!?\(\{\s*platform,\s*channelId,\s*text,\s*replyToMessageId\s*\}\)/g, replacement: `invoke('send_message', { platform, channel_id: channelId, text, reply_to_message_id: replyToMessageId })` },
  { regex: /rpc\.request\.sendMessage!?\(\{\s*platform,\s*channelId,\s*text\s*\}\)/g, replacement: `invoke('send_message', { platform, channel_id: channelId, text })` },
  { regex: /rpc\.request\.getStreamStatus!?\(\{\s*platform,\s*channelId\s*\}\)/g, replacement: `invoke<StreamStatusResponse>('get_stream_status', { platform, channel_id: channelId })` },
  { regex: /rpc\.request\.updateStream!?\(\{\s*platform,\s*channelId,\s*title,\s*categoryId\s*\}\)/g, replacement: `invoke('update_stream', { platform, channel_id: channelId, title, category_id: categoryId })` },
  { regex: /rpc\.request\.searchCategories!?\(\{\s*platform,\s*query\s*\}\)/g, replacement: `invoke<SearchCategoriesResponse>('search_categories', { platform, query })` },
  { regex: /rpc\.request\.getChannelsStatus!?\(\{\s*channels\s*\}\)/g, replacement: `invoke<ChannelsStatusResponse>('get_channels_status', { channels })` },
  { regex: /rpc\.request\.getChannelsStatus!?\(\{\s*channels:\s*(.+?)\s*\}\)/g, replacement: `invoke<ChannelsStatusResponse>('get_channels_status', { channels: $1 })` },
  { regex: /rpc\.request\.getRecentMessages!?\(\{\s*limit\s*\}\)/g, replacement: `invoke<NormalizedChatMessage[]>('get_recent_messages', { limit })` },
  { regex: /rpc\.request\.getRecentMessages!?\(\{\s*\}\)/g, replacement: `invoke<NormalizedChatMessage[]>('get_recent_messages')` },
  { regex: /rpc\.request\.getStatuses!?\(\)/g, replacement: `invoke<PlatformStatusInfo[]>('get_statuses')` },
  { regex: /rpc\.request\.getUsernameColor!?\(\{\s*platform,\s*username\s*\}\)/g, replacement: `invoke<string | null>('get_username_color', { platform, username })` },
  { regex: /rpc\.request\.getChannelEmotes!?\(\{\s*platform,\s*channelId\s*\}\)/g, replacement: `invoke<SevenTVEmote[]>('get_channel_emotes', { platform, channel_id: channelId })` },
  { regex: /rpc\.request\.checkForUpdate!?\(\)/g, replacement: `invoke<{ updateAvailable: boolean; version?: string; currentVersion: string }>('check_for_update')` },
  { regex: /rpc\.request\.downloadUpdate!?\(\)/g, replacement: `invoke('download_update')` },
  { regex: /rpc\.request\.applyUpdate!?\(\)/g, replacement: `invoke('apply_update')` },
  { regex: /rpc\.request\.skipUpdate!?\(\{\s*hash\s*\}\)/g, replacement: `invoke('skip_update', { hash })` },
  { regex: /rpc\.request\.getWatchedChannels!?\(\)/g, replacement: `invoke<WatchedChannel[]>('get_watched_channels')` },
  { regex: /rpc\.request\.addWatchedChannel!?\(\{\s*platform,\s*channelSlug\s*\}\)/g, replacement: `invoke<WatchedChannel>('add_watched_channel', { platform, channel_slug: channelSlug })` },
  { regex: /rpc\.request\.addWatchedChannel!?\(\{\s*channelSlug,\s*platform\s*\}\)/g, replacement: `invoke<WatchedChannel>('add_watched_channel', { platform, channel_slug: channelSlug })` },
  { regex: /rpc\.request\.removeWatchedChannel!?\(\{\s*id\s*\}\)/g, replacement: `invoke('remove_watched_channel', { id })` },
  { regex: /rpc\.request\.getWatchedChannelMessages!?\(\{\s*id\s*\}\)/g, replacement: `invoke<NormalizedChatMessage[]>('get_watched_channel_messages', { id })` },
  { regex: /rpc\.request\.getWatchedChannelMessages!?\(\{\s*id:\s*([a-zA-Z0-9_.]+)\s*\}\)/g, replacement: `invoke<NormalizedChatMessage[]>('get_watched_channel_messages', { id: $1 })` },
  { regex: /rpc\.request\.sendWatchedChannelMessage!?\(\{\s*id,\s*text,\s*replyToMessageId\s*\}\)/g, replacement: `invoke('send_watched_channel_message', { id, text, reply_to_message_id: replyToMessageId })` },
  { regex: /rpc\.request\.sendWatchedChannelMessage!?\(\{\s*id:\s*([a-zA-Z0-9_.]+),\s*text\s*\}\)/g, replacement: `invoke('send_watched_channel_message', { id: $1, text })` },
  { regex: /rpc\.request\.sendWatchedChannelMessage!?\(\{\s*id,\s*text\s*\}\)/g, replacement: `invoke('send_watched_channel_message', { id, text })` },
  { regex: /rpc\.request\.getWatchedChannelStatuses!?\(\)/g, replacement: `invoke('get_watched_channel_statuses')` },
  { regex: /rpc\.request\.getTabChannelIds!?\(\)/g, replacement: `invoke<string[]>('get_tab_channel_ids')` },
  { regex: /rpc\.request\.setTabChannelIds!?\(\{\s*ids:\s*([^}]+)\s*\}\)/g, replacement: `invoke('set_tab_channel_ids', { ids: $1 })` },
  { regex: /rpc\.request\.setTabChannelIds!?\(\{\s*ids\s*\}\)/g, replacement: `invoke('set_tab_channel_ids', { ids })` },
  { regex: /rpc\.request\.getWatchedChannelsLayout!?\(\{\s*tabId:\s*([a-zA-Z0-9_.'"]+)\s*\}\)/g, replacement: `invoke<WatchedChannelsLayout | null>('get_watched_channels_layout', { tab_id: $1 })` },
  { regex: /rpc\.request\.getWatchedChannelsLayout!?\(\{\s*tabId\s*\}\)/g, replacement: `invoke<WatchedChannelsLayout | null>('get_watched_channels_layout', { tab_id: tabId })` },
  { regex: /rpc\.request\.setWatchedChannelsLayout!?\(\{\s*tabId,\s*layout\s*\}\)/g, replacement: `invoke('set_watched_channels_layout', { tab_id: tabId, layout })` },
  { regex: /rpc\.request\.removePanel!?\(\{\s*tabId:\s*([^,]+),\s*panelId\s*\}\)/g, replacement: `invoke('remove_panel', { tab_id: $1, panel_id: panelId })` },
  { regex: /rpc\.request\.assignChannelToPanel!?\(\{\s*tabId:\s*([^,]+),\s*panelId,\s*channelId\s*\}\)/g, replacement: `invoke('assign_channel_to_panel', { tab_id: $1, panel_id: panelId, channel_id: channelId })` },
  { regex: /rpc\.request\.splitPanel!?\(\{\s*tabId:\s*([^,]+),\s*panelId,\s*direction\s*\}\)/g, replacement: `invoke('split_panel', { tab_id: $1, panel_id: panelId, direction })` },
  { regex: /rpc\.request\.getOverlaySettings!?\(\)/g, replacement: `invoke<OverlayConfig>('get_overlay_settings')` },
  { regex: /rpc\.request\.updateOverlaySettings!?\(\{\s*overlay\s*\}\)/g, replacement: `invoke('update_overlay_settings', { overlay })` },
  { regex: /rpc\.request\.pushOverlayMessage!?\(\{\s*message\s*\}\)/g, replacement: `invoke('push_overlay_message', { message })` },
  { regex: /rpc\.request\.pushOverlayEvent!?\(\{\s*event\s*\}\)/g, replacement: `invoke('push_overlay_event', { event })` },
  { regex: /rpc\.request\.openExternalUrl!?\(\{\s*url\s*\}\)/g, replacement: `invoke('open_external_url', { url })` },
  { regex: /rpc\.request\.getAppVersion!?\(\)/g, replacement: `invoke<string>('get_app_version')` },

  // RPC Listeners
  { regex: /useRpcListener\('chat_message',/g, replacement: `useTauriEvent<NormalizedChatMessage>('chat:message',` },
  { regex: /useRpcListener\('chat_event',/g, replacement: `useTauriEvent<NormalizedEvent>('chat:event',` },
  { regex: /useRpcListener\('platform_status',/g, replacement: `useTauriEvent<PlatformStatusInfo>('platform:status',` },
  { regex: /useRpcListener\('auth_success',/g, replacement: `useTauriEvent<{ platform: string; username: string; displayName: string }>('auth:success',` },
  { regex: /useRpcListener\('auth_error',/g, replacement: `useTauriEvent<{ platform: string; error: string }>('auth:error',` },
  { regex: /useRpcListener\('update_status',/g, replacement: `useTauriEvent<{ status: string; message: string; progress?: number; hash?: string }>('update:status',` },
  { regex: /useRpcListener\('watched_channel_message',/g, replacement: `useTauriEvent<{ channelId: string; message: NormalizedChatMessage }>('watched_channel:message',` },
  { regex: /useRpcListener\('watched_channel_status',/g, replacement: `useTauriEvent<{ channelId: string; status: PlatformStatusInfo }>('watched_channel:status',` },
  { regex: /useRpcListener\('channel_emotes_set',/g, replacement: `useTauriEvent<{ platform: Platform; channelId: string; emotes: SevenTVEmote[] }>('channel_emotes:set',` },
  { regex: /useRpcListener\('channel_emote_added',/g, replacement: `useTauriEvent<{ platform: Platform; channelId: string; emote: SevenTVEmote }>('channel_emote:added',` },
  { regex: /useRpcListener\('channel_emote_removed',/g, replacement: `useTauriEvent<{ platform: Platform; channelId: string; emoteId: string }>('channel_emote:removed',` },
  { regex: /useRpcListener\('channel_emote_updated',/g, replacement: `useTauriEvent<{ platform: Platform; channelId: string; emoteId: string; newAlias: string }>('channel_emote:updated',` },

  // Direct RPC Listeners
  { regex: /rpc\.addMessageListener\('channel_emotes_set',/g, replacement: `listen<{ platform: Platform; channelId: string; emotes: SevenTVEmote[] }>('channel_emotes:set',` },
  { regex: /rpc\.addMessageListener\('channel_emote_added',/g, replacement: `listen<{ platform: Platform; channelId: string; emote: SevenTVEmote }>('channel_emote:added',` },
  { regex: /rpc\.addMessageListener\('channel_emote_removed',/g, replacement: `listen<{ platform: Platform; channelId: string; emoteId: string }>('channel_emote:removed',` },
  { regex: /rpc\.addMessageListener\('channel_emote_updated',/g, replacement: `listen<{ platform: Platform; channelId: string; emoteId: string; newAlias: string }>('channel_emote:updated',` },

  // Remove `rpc.` object access (like void rpc.request...)
  { regex: /void rpc\.request\./g, replacement: `void invoke` }, // This will leave `.XYZ` which is bad, but I'll check it
];

async function run() {
  const globIter = new Bun.Glob("**/*.{ts,vue}").scan(SRC_DIR);
  for await (const file of globIter) {
    const fullPath = join(SRC_DIR, file);
    let content = readFileSync(fullPath, 'utf-8');
    const original = content;

    for (const { regex, replacement } of replacements) {
      content = content.replace(regex, replacement);
    }
    
    // Auto-fix any multi-line format leftovers
    content = content.replace(/rpc\.request\s*\.\s*/g, 'rpc.request.');

    if (content !== original) {
      writeFileSync(fullPath, content);
      console.log(`Updated ${file}`);
    }
  }
}

run().catch(console.error);
