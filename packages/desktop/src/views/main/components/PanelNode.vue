<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  PanelNode,
  SplitDirection,
  AppSettings,
  NormalizedChatMessage,
  Account,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
import ChatList from './ChatList.vue'
import AddChannelForm from './AddChannelForm.vue'

const props = defineProps<{
  panel: PanelNode
  messages?: NormalizedChatMessage[]
  settings?: AppSettings | null
  accounts?: Account[]
  statuses?: Map<string, PlatformStatusInfo>
  watchedMessages?: Map<string, NormalizedChatMessage[]>
  watchedStatuses?: Map<string, PlatformStatusInfo>
  watchedChannels?: WatchedChannel[]
  isDraggable?: boolean
  isDropTarget?: boolean
  isDragging?: boolean
}>()

const emit = defineEmits<{
  split: [panelId: string, direction: SplitDirection]
  remove: [panelId: string]
  assign: [panelId: string, channelId: string | null]
  'add-and-assign': [panelId: string, platform: 'twitch' | 'kick' | 'youtube', channelSlug: string]
  'settings-change': [settings: AppSettings]
  'send-watched': [payload: { text: string; channelId: string }]
  dragstart: [panelId: string]
  dragend: []
  dragover: [panelId: string]
  dragleave: []
  drop: [targetId: string, direction: 'left' | 'right' | 'top' | 'bottom']
}>()

const isMain = computed(() => props.panel.content.type === 'main')
const isWatched = computed(() => props.panel.content.type === 'watched')
const isEmpty = computed(() => props.panel.content.type === 'empty')

const channelId = computed(() => {
  if (props.panel.content.type === 'watched') {
    return props.panel.content.channelId
  }
  return null
})

const watchedChannel = computed(() => {
  if (!channelId.value || !props.watchedChannels) return null
  return props.watchedChannels.find((ch) => ch.id === channelId.value) ?? null
})

const watchedChannelStatus = computed(() => {
  if (!channelId.value || !props.watchedStatuses) return null
  return props.watchedStatuses.get(channelId.value) ?? null
})

const watchedChannelMessages = computed(() => {
  if (!channelId.value || !props.watchedMessages) return []
  return props.watchedMessages.get(channelId.value) ?? []
})

const youtubeAuthenticated = computed(
  () => props.accounts?.some((a) => a.platform === 'youtube') ?? false,
)

const showAddForm = ref(false)
const dropZone = ref<'left' | 'right' | 'top' | 'bottom' | null>(null)

const showForm = computed(() => isEmpty.value || showAddForm.value)

function handleFormConfirm(platform: 'twitch' | 'kick' | 'youtube', slug: string) {
  emit('add-and-assign', props.panel.id, platform, slug)
  showAddForm.value = false
}

const handleRemove = () => {
  if (isMain.value) return
  emit('remove', props.panel.id)
}

const handleSettingsChange = (s: AppSettings) => {
  emit('settings-change', s)
}

const handleSendWatched = (payload: { text: string; channelId: string }) => {
  emit('send-watched', payload)
}

function handleChangeChannel() {
  showAddForm.value = true
}

function handleCancelForm() {
  showAddForm.value = false
}

function handleSplitAndClose() {
  emit('split', props.panel.id, 'vertical')
}

const handleDragStart = (e: DragEvent) => {
  if (!props.isDraggable) {
    e.preventDefault()
    return
  }
  emit('dragstart', props.panel.id)
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', props.panel.id)
  }
}

const handleDragEnd = () => {
  emit('dragend')
}

const handleSplitHorizontal = () => {
  emit('split', props.panel.id, 'horizontal')
}

const handleDragOver = (e: DragEvent) => {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const relX = (e.clientX - rect.left) / rect.width
  const relY = (e.clientY - rect.top) / rect.height
  if (Math.abs(relX - 0.5) > Math.abs(relY - 0.5)) {
    dropZone.value = relX < 0.5 ? 'left' : 'right'
  } else {
    dropZone.value = relY < 0.5 ? 'top' : 'bottom'
  }
  emit('dragover', props.panel.id)
}

const handleDragLeave = () => {
  dropZone.value = null
  emit('dragleave')
}

const handleDrop = (e: DragEvent) => {
  e.preventDefault()
  const zone = dropZone.value ?? 'right'
  dropZone.value = null
  emit('drop', props.panel.id, zone)
}

const handleKeydown = (e: KeyboardEvent) => {
  if (!e.ctrlKey) return

  switch (e.key) {
    case 'h':
      if (e.shiftKey) {
        e.preventDefault()
        emit('split', props.panel.id, 'vertical')
      } else {
        e.preventDefault()
        handleSplitHorizontal()
      }
      break
    case 'w':
      if (!isMain.value) {
        e.preventDefault()
        handleRemove()
      }
      break
  }
}</script>

<template>
  <div
    class="panel-node"
    :class="{
      'is-dragging': isDragging,
      'is-drop-target': isDropTarget,
    }"
    tabindex="0"
    @keydown="handleKeydown"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <div
      v-if="isDropTarget && dropZone"
      class="drop-zone-overlay"
      :class="`drop-zone-${dropZone}`"
    />

    <div class="panel-content">
      <!-- Add-channel form: shown when empty OR user toggled change channel -->
      <div v-if="showForm" class="add-channel-form-wrapper">
        <!-- Thin drag handle strip for panels in form state -->
        <div
          v-if="isDraggable"
          class="form-drag-handle"
          draggable="true"
          @dragstart="handleDragStart"
          @dragend="handleDragEnd"
        />
        <AddChannelForm
          :youtube-authenticated="youtubeAuthenticated"
          :cancelable="isWatched && showAddForm"
          @confirm="handleFormConfirm"
          @cancel="handleCancelForm"
        />
      </div>

      <!-- Main chat (combined) -->
      <ChatList
        v-else-if="isMain"
        :messages="messages ?? []"
        :settings="settings ?? null"
        :accounts="accounts ?? []"
        :statuses="statuses ?? new Map()"
        :is-main="true"
        :is-draggable="isDraggable"
        @settings-change="handleSettingsChange"
        @header-dragstart="handleDragStart"
        @header-dragend="handleDragEnd"
      />

      <!-- Watched channel chat -->
      <ChatList
        v-else-if="isWatched && watchedChannel"
        :messages="watchedChannelMessages"
        :settings="settings ?? null"
        :accounts="accounts ?? []"
        :statuses="statuses ?? new Map()"
        :watched-channel="watchedChannel"
        :watched-channel-status="watchedChannelStatus"
        :watched-messages="watchedChannelMessages"
        :is-main="false"
        :is-draggable="isDraggable"
        @settings-change="handleSettingsChange"
        @send-watched="handleSendWatched"
        @split-right="handleSplitAndClose"
        @change-channel="handleChangeChannel"
        @close-panel="handleRemove"
        @header-dragstart="handleDragStart"
        @header-dragend="handleDragEnd"
      />
    </div>
  </div>
</template>

<style scoped>
.panel-node {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--c-bg, #0f0f11);
  border: 1px solid var(--c-border, #2a2a33);
  overflow: hidden;
  position: relative;
}

.panel-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Add channel form — fullscreen in panel content */
.add-channel-form-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 20px;
}
.add-channel-form-wrapper > *:not(.form-drag-handle) {
  max-width: 260px;
}

/* Thin drag handle for panels in form/empty state */
.form-drag-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 28px;
  cursor: grab;
  user-select: none;
}
.form-drag-handle:active {
  cursor: grabbing;
}

.panel-node.is-dragging {
  opacity: 0.5;
}

.drop-zone-overlay {
  position: absolute;
  background: rgba(88, 101, 242, 0.35);
  border: 2px solid rgba(88, 101, 242, 0.8);
  pointer-events: none;
  z-index: 10;
  border-radius: 4px;
  transition: all 0.08s ease;
}
.drop-zone-left {
  top: 0;
  left: 0;
  width: 50%;
  height: 100%;
}
.drop-zone-right {
  top: 0;
  right: 0;
  width: 50%;
  height: 100%;
}
.drop-zone-top {
  top: 0;
  left: 0;
  width: 100%;
  height: 50%;
}
.drop-zone-bottom {
  bottom: 0;
  left: 0;
  width: 100%;
  height: 50%;
}
</style>
