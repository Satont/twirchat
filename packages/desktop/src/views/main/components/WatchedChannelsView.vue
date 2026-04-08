<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import SplitNode from './SplitNode.vue'
import { useLayoutStore } from '../stores/layout'
import type {
  SplitDirection,
  AppSettings,
  Account,
  NormalizedChatMessage,
  WatchedChannel,
  PlatformStatusInfo,
  LayoutNode,
} from '@twirchat/shared/types'

const props = defineProps<{
  tabId: string
  messages: NormalizedChatMessage[]
  settings: AppSettings | null
  accounts: Account[]
  statuses: Map<string, PlatformStatusInfo>
  watchedMessages: Map<string, NormalizedChatMessage[]>
  watchedStatuses: Map<string, PlatformStatusInfo>
  watchedChannels: WatchedChannel[]
  onAddWatchedChannel: (
    platform: 'twitch' | 'kick' | 'youtube',
    channelSlug: string,
  ) => Promise<WatchedChannel>
}>()

const emit = defineEmits<{
  assignChannel: [panelId: string, channelId: string | null]
  'settings-change': [settings: AppSettings]
  'send-watched': [payload: { text: string; channelId: string }]
  'tab-channels-updated': [payload: { tabId: string; channelNames: string[] }]
}>()

const layoutStore = useLayoutStore()
const { layout, rootNode, isLoading, error, draggedPanelId, dropTargetId, allPanels } =
  storeToRefs(layoutStore)

function emitTabChannels() {
  const names = allPanels.value
    .filter((p) => p.content.type === 'watched')
    .map((p) => {
      const ch = props.watchedChannels?.find(
        (c) => c.id === (p.content as { type: 'watched'; channelId: string }).channelId,
      )
      return ch?.displayName ?? null
    })
    .filter((n): n is string => n !== null)

  emit('tab-channels-updated', { tabId: props.tabId, channelNames: names })
}

watch([allPanels, () => props.watchedChannels], () => emitTabChannels(), {
  deep: true,
})

onMounted(() => {
  void layoutStore.loadLayout(props.tabId).then(() => {
    emitTabChannels()
  })
})

watch(
  () => props.tabId,
  (newTabId) => {
    if (newTabId) {
      void layoutStore.loadLayout(newTabId).then(() => {
        emitTabChannels()
      })
    }
  },
)

const handleSplit = (panelId: string, direction: SplitDirection) => {
  layoutStore.splitPanel(panelId, direction)
}

const handleRemove = (panelId: string) => {
  layoutStore.removePanel(panelId)
}

const handleAssign = (panelId: string, channelId: string | null) => {
  layoutStore.assignChannel(panelId, channelId)
  emit('assignChannel', panelId, channelId)
}

const handleAddAndAssign = async (
  panelId: string,
  platform: 'twitch' | 'kick' | 'youtube',
  channelSlug: string,
) => {
  try {
    const newChannel = await props.onAddWatchedChannel(platform, channelSlug)
    layoutStore.assignChannel(panelId, newChannel.id)
    emit('assignChannel', panelId, newChannel.id)
  } catch (err) {
    console.error('[WatchedChannelsView] addAndAssign failed:', err)
  }
}

const handleResize = (splitNodeId: string, sizes: number[]) => {
  if (!layout.value || sizes.length === 0) return

  const findAndUpdateSplit = (node: LayoutNode): boolean => {
    if (node.type === 'split' && node.id === splitNodeId) {
      if (node.children.length === sizes.length) {
        node.children.forEach((child, index) => {
          child.flex = sizes[index] ?? child.flex
        })
        return true
      }
    }
    if (node.type === 'split' && node.children) {
      for (const child of node.children) {
        if (findAndUpdateSplit(child)) return true
      }
    }
    return false
  }

  const updated = findAndUpdateSplit(layout.value.root)
  if (updated) {
    layoutStore.saveLayout()
  }
}

const handleSettingsChange = (s: AppSettings) => {
  emit('settings-change', s)
}

const handleSendWatched = (payload: { text: string; channelId: string }) => {
  emit('send-watched', payload)
}

const handleDragStart = (panelId: string) => {
  layoutStore.startDrag(panelId)
}

const handleDragEnd = () => {
  layoutStore.endDrag()
}

const handleDragOver = (panelId: string) => {
  layoutStore.setDropTarget(panelId)
}

const handleDragLeave = () => {
  layoutStore.setDropTarget(null)
}

const handleDrop = (targetId: string, direction: 'left' | 'right' | 'top' | 'bottom') => {
  const draggedId = draggedPanelId.value
  if (draggedId && draggedId !== targetId) {
    layoutStore.dropPanel(draggedId, targetId, direction)
  }
  layoutStore.endDrag()
}
</script>

<template>
  <div class="watched-channels-view">
    <div v-if="isLoading" class="loading">Loading layout...</div>
    <div v-else-if="error" class="error">Error: {{ error }}</div>
    <SplitNode
      v-else-if="rootNode"
      style="height: 100%"
      :node="rootNode"
      :messages="messages"
      :settings="settings"
      :accounts="accounts"
      :statuses="statuses"
      :watched-messages="watchedMessages"
      :watched-statuses="watchedStatuses"
      :watched-channels="watchedChannels"
      :dragged-panel-id="draggedPanelId"
      :drop-target-id="dropTargetId"
      @split="handleSplit"
      @remove="handleRemove"
      @assign="handleAssign"
      @add-and-assign="handleAddAndAssign"
      @resize="handleResize"
      @settings-change="handleSettingsChange"
      @send-watched="handleSendWatched"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    />
    <div v-else class="empty">No layout available</div>
  </div>
</template>

<style scoped>
.watched-channels-view {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.loading,
.error,
.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--c-text-2, #8b8b99);
}

.error {
  color: #ef4444;
}
</style>
