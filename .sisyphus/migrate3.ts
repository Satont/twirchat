import { glob } from 'fs/promises';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SRC_DIR = 'packages/desktop/src/views/main';

const replacements = [
  // Missing RPC requests with optional chaining ?.
  { regex: /rpc\.request\.getTabChannelIds\?\.\(\)/g, replacement: `invoke<string[]>('get_tab_channel_ids')` },
  { regex: /rpc\.request\.setTabChannelIds\?\.\(\{\s*ids:\s*([^}]+)\s*\}\)/gs, replacement: `invoke('set_tab_channel_ids', { ids: $1 })` },
  { regex: /rpc\.request\.setTabChannelIds\?\.\(\{\s*ids\s*\}\)/g, replacement: `invoke('set_tab_channel_ids', { ids })` },
  { regex: /rpc\.request\.getWatchedChannelsLayout\?\.\(\{\s*tabId:\s*([^}]+)\s*\}\)/gs, replacement: `invoke<WatchedChannelsLayout | null>('get_watched_channels_layout', { tab_id: $1 })` },
  { regex: /rpc\.request\.getWatchedChannelsLayout\?\.\(\{\s*tabId\s*\}\)/gs, replacement: `invoke<WatchedChannelsLayout | null>('get_watched_channels_layout', { tab_id: tabId })` },
  { regex: /rpc\.request\.setWatchedChannelsLayout\?\.\(\{\s*tabId:\s*([^,]+),\s*layout\s*\}\)/gs, replacement: `invoke('set_watched_channels_layout', { tab_id: $1, layout })` },
  { regex: /rpc\.request\.splitPanel\?\.\(\{\s*tabId:\s*([^,]+),\s*panelId(.*?),\s*direction(.*?)\}\)/gs, replacement: `invoke('split_panel', { tab_id: $1, panel_id: panelId, direction$3 })` },
  { regex: /rpc\.request\.removePanel\?\.\(\{\s*tabId:\s*([^,]+),\s*panelId(.*?)\}\)/gs, replacement: `invoke('remove_panel', { tab_id: $1, panel_id: panelId })` },
  { regex: /rpc\.request\.assignChannelToPanel\?\.\(\{\s*tabId:\s*([^,]+),\s*panelId(.*?),\s*channelId(.*?)\}\)/gs, replacement: `invoke('assign_channel_to_panel', { tab_id: $1, panel_id: panelId, channel_id: channelId })` },
  { regex: /rpc\.request\.sendMessage\(\{\s*platform:\s*([^,]+),\s*channelId:\s*([^,]+),\s*text:\s*([^,]+),\s*replyToMessageId:\s*([^}\n]+)\s*\}\)/g, replacement: `invoke('send_message', { platform: $1, channel_id: $2, text: $3, reply_to_message_id: $4 })` },
  { regex: /rpc\.request\.sendMessage\(\{\s*platform:\s*([^,]+),\s*channelId:\s*([^,]+),\s*text:\s*([^}\n]+)\s*\}\)/g, replacement: `invoke('send_message', { platform: $1, channel_id: $2, text: $3 })` },
  { regex: /rpc\.request\.getStreamStatus!\(\{\s*platform:\s*([^,]+),\s*channelId:\s*([^}\n]+)\s*\}\)/g, replacement: `invoke<StreamStatusResponse>('get_stream_status', { platform: $1, channel_id: $2 })` },
  { regex: /rpc\.request\.updateStream!\(\{\s*platform:\s*([^,]+),\s*channelId:\s*([^,]+),\s*title:\s*([^,]+),\s*categoryId:\s*([^}\n]+)\s*\}\)/g, replacement: `invoke('update_stream', { platform: $1, channel_id: $2, title: $3, category_id: $4 })` },
  
  // App.vue useRpcListener missing multiline replacement
  { regex: /useRpcListener\(\n\s*'update_status',\n\s*\(\{(.*?)\}\)/gs, replacement: `useTauriEvent<{ status: string; message: string; progress?: number; hash?: string }>('update:status', ({$1})` }
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