import { glob } from 'fs/promises';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SRC_DIR = 'packages/desktop/src/views/main';

const replacements = [
  // Multi-line or missed RPC Requests
  { regex: /rpc\.request\.openExternalUrl!?\(\{\s*url:\s*([^}]+)\s*\}\)/g, replacement: `invoke('open_external_url', { url: $1 })` },
  { regex: /rpc\.request\.searchCategories!?\(\{\s*platform(.*?),\s*query(.*?)\}\)/gs, replacement: `invoke<SearchCategoriesResponse>('search_categories', { platform$1, query$2})` },
  { regex: /rpc\.request\.getStreamStatus!?\(\{\s*platform(.*?),\s*channelId(.*?)\}\)/gs, replacement: `invoke<StreamStatusResponse>('get_stream_status', { platform$1, channel_id: channelId })` },
  { regex: /rpc\.request\.updateStream!?\(\{\s*platform(.*?),\s*channelId(.*?),\s*title(.*?),\s*categoryId(.*?)\}\)/gs, replacement: `invoke('update_stream', { platform$1, channel_id: channelId, title$3, category_id: categoryId })` },
  { regex: /rpc\.request\.sendMessage!?\(\{\s*platform(.*?),\s*channelId(.*?),\s*text(.*?),\s*replyToMessageId(.*?)\}\)/gs, replacement: `invoke('send_message', { platform$1, channel_id: channelId, text$3, reply_to_message_id: replyToMessageId })` },
  { regex: /rpc\.request\.saveSettings!?\((.*?)\)/g, replacement: `invoke('save_settings', { settings: $1 })` },
  { regex: /rpc\.request\.getUsernameColor!?\(\{\s*platform(.*?),\s*username(.*?)\}\)/gs, replacement: `invoke<string | null>('get_username_color', { platform$1, username$2 })` },
  { regex: /rpc\.request\.getWatchedChannelsLayout!?\(\{\s*tabId(.*?)\}\)/gs, replacement: `invoke<WatchedChannelsLayout | null>('get_watched_channels_layout', { tab_id: tabId })` },
  { regex: /rpc\.request\.setWatchedChannelsLayout!?\(\{\s*tabId(.*?),\s*layout(.*?)\}\)/gs, replacement: `invoke('set_watched_channels_layout', { tab_id: tabId, layout$2 })` },
  { regex: /rpc\.request\.splitPanel!?\(\{\s*tabId(.*?),\s*panelId(.*?),\s*direction(.*?)\}\)/gs, replacement: `invoke('split_panel', { tab_id: tabId, panel_id: panelId, direction$3 })` },
  { regex: /rpc\.request\.removePanel!?\(\{\s*tabId(.*?),\s*panelId(.*?)\}\)/gs, replacement: `invoke('remove_panel', { tab_id: tabId, panel_id: panelId })` },
  { regex: /rpc\.request\.assignChannelToPanel!?\(\{\s*tabId(.*?),\s*panelId(.*?),\s*channelId(.*?)\}\)/gs, replacement: `invoke('assign_channel_to_panel', { tab_id: tabId, panel_id: panelId, channel_id: channelId })` },
  { regex: /rpc\.request\.getChannelEmotes!?\(\{\s*platform(.*?),\s*channelId(.*?)\}\)/gs, replacement: `invoke<SevenTVEmote[]>('get_channel_emotes', { platform$1, channel_id: channelId })` },
  { regex: /rpc\.request\.getTabChannelIds!?\(\)/g, replacement: `invoke<string[]>('get_tab_channel_ids')` },
  { regex: /rpc\.request\.setTabChannelIds!?\(\{\s*ids:\s*([^}]+)\s*\}\)/g, replacement: `invoke('set_tab_channel_ids', { ids: $1 })` },
  
  // Multiline listeners
  { regex: /useRpcListener\(\s*'update_status',\s*\(\{\s*status,\s*message,\s*progress,\s*hash\s*\}\)/gs, replacement: `useTauriEvent<{ status: string; message: string; progress?: number; hash?: string }>('update:status', ({ status, message, progress, hash })` },
  { regex: /useRpcListener\(\s*'watched_channel_message',\s*\(\{\s*channelId,\s*message\s*\}\)/gs, replacement: `useTauriEvent<{ channelId: string; message: NormalizedChatMessage }>('watched_channel:message', ({ channelId, message })` },
  { regex: /useRpcListener\(\s*'watched_channel_status',\s*\(\{\s*channelId,\s*status\s*\}\)/gs, replacement: `useTauriEvent<{ channelId: string; status: PlatformStatusInfo }>('watched_channel:status', ({ channelId, status })` },
  { regex: /useRpcListener\(\s*'update_status',\s*\((.*?)\)\s*=>/gs, replacement: `useTauriEvent<{ status: string; message: string; progress?: number; hash?: string }>('update:status', $1 =>` },
  { regex: /useRpcListener\(\s*'watched_channel_message',\s*\((.*?)\)\s*=>/gs, replacement: `useTauriEvent<{ channelId: string; message: NormalizedChatMessage }>('watched_channel:message', $1 =>` },
  { regex: /useRpcListener\(\s*'watched_channel_status',\s*\((.*?)\)\s*=>/gs, replacement: `useTauriEvent<{ channelId: string; status: PlatformStatusInfo }>('watched_channel:status', $1 =>` },
  { regex: /useRpcListener\(\s*'channel_emotes_set',\s*\((.*?)\)\s*=>/gs, replacement: `useTauriEvent<{ platform: Platform; channelId: string; emotes: SevenTVEmote[] }>('channel_emotes:set', $1 =>` },
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

    if (content !== original) {
      writeFileSync(fullPath, content);
      console.log(`Updated ${file}`);
    }
  }
}

run().catch(console.error);