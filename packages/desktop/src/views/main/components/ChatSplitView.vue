<script setup lang="ts">
import { computed } from 'vue'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import ChatPanel from './ChatPanel.vue'
import type {
  Account,
  AppSettings,
  ChatLayout,
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
  SplitConfig,
  WatchedChannel,
} from '@twirchat/shared/types'

const props = defineProps<{
  layout: ChatLayout
  messages: NormalizedChatMessage[]
  watchedMessages: Map<string, NormalizedChatMessage[]>
  watchedChannels: WatchedChannel[]
  watchedStatuses: Map<string, PlatformStatusInfo>
  settings: AppSettings
  accounts: Account[]
  statuses: Map<string, PlatformStatusInfo>
}>()

const emit = defineEmits<{
  'update:layout': [layout: ChatLayout]
  'close-panel': [splitId: string]
  'maximize-panel': [splitId: string]
  resize: [sizes: number[]]
}>()

// ---- Helpers ----

function watchedChannelForSplit(split: SplitConfig): WatchedChannel | undefined {
  if (split.type !== 'channel' || !split.channelId) return undefined
  return props.watchedChannels.find((ch) => ch.id === split.channelId)
}

function watchedStatusForSplit(split: SplitConfig): PlatformStatusInfo | undefined {
  if (split.type !== 'channel' || !split.channelId) return undefined
  return props.watchedStatuses.get(split.channelId)
}

function platformForSplit(split: SplitConfig): Platform | undefined {
  return watchedChannelForSplit(split)?.platform as Platform | undefined
}

function channelNameForSplit(split: SplitConfig): string | undefined {
  return watchedChannelForSplit(split)?.displayName
}

// Pane size payload from splitpanes is an array of { size } objects
interface PaneInfo {
  size: number
}

function onResized(paneInfos: PaneInfo[]) {
  const sizes = paneInfos.map((p) => p.size)
  emit('resize', sizes)

  const updatedSplits = props.layout.splits.map((split, i) => ({
    ...split,
    size: sizes[i] ?? split.size,
  }))

  emit('update:layout', { ...props.layout, splits: updatedSplits })
}

const splits = computed(() => props.layout.splits)
</script>

<template>
  <Splitpanes class="split-view" @resized="onResized">
    <Pane v-for="split in splits" :key="split.id" :size="split.size" class="split-pane">
      <ChatPanel
        :panel-id="split.id"
        :type="split.type"
        :channel-id="split.channelId"
        :channel-name="channelNameForSplit(split)"
        :platform="platformForSplit(split)"
        :messages="messages"
        :watched-messages="watchedMessages"
        :watched-channel="watchedChannelForSplit(split)"
        :watched-status="watchedStatusForSplit(split)"
        :settings="settings"
        :accounts="accounts"
        :statuses="statuses"
        @close="emit('close-panel', split.id)"
        @maximize="emit('maximize-panel', split.id)"
      />
    </Pane>
  </Splitpanes>
</template>

<style scoped>
.split-view {
  width: 100%;
  height: 100%;
}

.split-pane {
  overflow: hidden;
}

/* Override splitpanes splitter styles to match app theme */
:deep(.splitpanes__splitter) {
  background: var(--c-border, #2a2a33);
  position: relative;
  flex-shrink: 0;
  transition: background 0.15s;
}

:deep(.splitpanes--vertical > .splitpanes__splitter) {
  width: 4px;
  cursor: col-resize;
}

:deep(.splitpanes--horizontal > .splitpanes__splitter) {
  height: 4px;
  cursor: row-resize;
}

:deep(.splitpanes__splitter:hover),
:deep(.splitpanes__splitter:active) {
  background: #a78bfa;
}

:deep(.splitpanes__splitter::before) {
  content: '';
  position: absolute;
  inset: 0;
  /* Expand hit area without changing visual size */
  margin: -4px;
}
</style>
