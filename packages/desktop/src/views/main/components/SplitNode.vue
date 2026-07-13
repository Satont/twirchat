<script setup lang="ts">
import { computed } from 'vue'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import type {
  LayoutNode,
  SplitNode as SplitNodeType,
  PanelNode as PanelNodeType,
  SplitDirection,
  AppSettings,
  NormalizedChatMessage,
  Account,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
import PanelNodeComponent from './PanelNode.vue'

const props = defineProps<{
  node: LayoutNode
  depth?: number
  messages?: NormalizedChatMessage[]
  settings?: AppSettings | null
  accounts?: Account[]
  statuses?: Map<string, PlatformStatusInfo>
  watchedMessages?: Map<string, NormalizedChatMessage[]>
  watchedStatuses?: Map<string, PlatformStatusInfo>
  watchedChannels?: WatchedChannel[]
  draggedPanelId?: string | null
  dropTargetId?: string | null
}>()

const emit = defineEmits<{
  split: [panelId: string, direction: SplitDirection]
  remove: [panelId: string]
  assign: [panelId: string, channelId: string | null]
  'add-and-assign': [panelId: string, platform: 'twitch' | 'kick' | 'youtube', channelSlug: string]
  resize: [nodeId: string, sizes: number[]]
  'settings-change': [settings: AppSettings]
  'send-watched': [payload: { text: string; channelId: string }]
  dragstart: [panelId: string]
  dragend: []
  dragover: [panelId: string]
  dragleave: []
  drop: [targetId: string, direction: 'left' | 'right' | 'top' | 'bottom']
}>()

const isSplit = computed(() => props.node.type === 'split')
const isPanel = computed(() => props.node.type === 'panel')

const splitNode = computed(() => props.node as SplitNodeType)
const panelNode = computed(() => props.node as PanelNodeType)

const isHorizontal = computed(() => {
  if (props.node.type !== 'split') return false
  return (props.node as SplitNodeType).direction === 'horizontal'
})

const isDraggable = computed(() => {
  if (!isPanel.value) return false
  return panelNode.value.content.type !== 'main'
})

const isDragging = computed(() => {
  return isPanel.value && props.draggedPanelId === panelNode.value.id
})

const isDropTarget = computed(() => {
  return isPanel.value && props.dropTargetId === panelNode.value.id
})

const handleResized = (sizes: { size: number }[]) => {
  const sizeValues = sizes.map((s) => s.size)
  emit('resize', props.node.id, sizeValues)
}

const handlePanelSplit = (panelId: string, direction: SplitDirection) => {
  emit('split', panelId, direction)
}

const handlePanelRemove = (panelId: string) => {
  emit('remove', panelId)
}

const handlePanelAssign = (panelId: string, channelId: string | null) => {
  emit('assign', panelId, channelId)
}

const handlePanelAddAndAssign = (
  panelId: string,
  platform: 'twitch' | 'kick' | 'youtube',
  channelSlug: string,
) => {
  emit('add-and-assign', panelId, platform, channelSlug)
}

const handleDragStart = (panelId: string) => {
  emit('dragstart', panelId)
}

const handleDragEnd = () => {
  emit('dragend')
}

const handleDragOver = (panelId: string) => {
  emit('dragover', panelId)
}

const handleDragLeave = () => {
  emit('dragleave')
}

const handleDrop = (targetId: string, direction: 'left' | 'right' | 'top' | 'bottom') => {
  emit('drop', targetId, direction)
}

const handleSettingsChange = (s: AppSettings) => {
  emit('settings-change', s)
}

const handleSendWatched = (payload: { text: string; channelId: string }) => {
  emit('send-watched', payload)
}
</script>

<template>
  <div v-if="isPanel" class="split-node-panel">
    <PanelNodeComponent
      :panel="panelNode"
      :messages="messages"
      :settings="settings"
      :accounts="accounts"
      :statuses="statuses"
      :watched-messages="watchedMessages"
      :watched-statuses="watchedStatuses"
      :watched-channels="watchedChannels"
      :is-draggable="isDraggable"
      :is-dragging="isDragging"
      :is-drop-target="isDropTarget"
      @split="handlePanelSplit"
      @remove="handlePanelRemove"
      @assign="handlePanelAssign"
      @add-and-assign="handlePanelAddAndAssign"
      @settings-change="handleSettingsChange"
      @send-watched="handleSendWatched"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    />
  </div>

  <Splitpanes
    v-else-if="isSplit"
    :class="['split-node-container', isHorizontal ? 'horizontal' : 'vertical']"
    :horizontal="isHorizontal"
    @resized="handleResized"
  >
    <Pane
      v-for="child in splitNode.children"
      :key="child.id"
      :size="child.flex"
      class="split-node-pane"
    >
      <SplitNode
        :node="child"
        :depth="(depth ?? 0) + 1"
        :messages="messages"
        :settings="settings"
        :accounts="accounts"
        :statuses="statuses"
        :watched-messages="watchedMessages"
        :watched-statuses="watchedStatuses"
        :watched-channels="watchedChannels"
        :dragged-panel-id="draggedPanelId"
        :drop-target-id="dropTargetId"
        @split="handlePanelSplit"
        @remove="handlePanelRemove"
        @assign="handlePanelAssign"
        @add-and-assign="handlePanelAddAndAssign"
        @resize="(nodeId: string, sizes: number[]) => $emit('resize', nodeId, sizes)"
        @settings-change="handleSettingsChange"
        @send-watched="handleSendWatched"
        @dragstart="handleDragStart"
        @dragend="handleDragEnd"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      />
    </Pane>
  </Splitpanes>
</template>

<style scoped>
.split-node-container {
  width: 100%;
  height: 100%;
}

.split-node-pane {
  height: 100%;
  overflow: hidden;
}

.split-node-panel {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

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
  margin: -4px;
}
</style>
