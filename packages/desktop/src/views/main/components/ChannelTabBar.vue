<script setup lang="ts">
import type { PlatformStatusInfo, WatchedChannel } from '@twirchat/shared/types'
import { ref } from 'vue'
import { platformColor } from '../../shared/utils/platform'
import TwitchIcon from '../../../assets/icons/platforms/twitch.svg'
import YoutubeIcon from '../../../assets/icons/platforms/youtube.svg'
import KickIcon from '../../../assets/icons/platforms/kick.svg'

export type WatchedLiveStatus = {
  isLive: boolean
  viewerCount?: number
}

const props = defineProps<{
  watchedChannels: WatchedChannel[]
  activeTabId: string // "home" or a WatchedChannel.id
  watchedStatuses: Map<string, PlatformStatusInfo>
  /** ChannelId → live status info (from shared stream status store) */
  watchedLiveStatuses: Map<string, WatchedLiveStatus>
  tabChannelNames?: Map<string, string[]>
}>()

const emit = defineEmits<{
  'select-tab': [id: string]
  'add-channel': []
  'remove-channel': [id: string]
  reorder: [fromId: string, toId: string]
}>()

function isLive(id: string): boolean {
  return props.watchedLiveStatuses.get(id)?.isLive === true
}

function viewerCount(id: string): number | undefined {
  const s = props.watchedLiveStatuses.get(id)
  return s?.isLive ? s.viewerCount : undefined
}

function formatViewers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// ---- Drag-and-drop reordering ----
const dragOverId = ref<string | null>(null)
let dragSourceId: string | null = null

function onDragStart(e: DragEvent, id: string) {
  dragSourceId = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}

function onDragOver(e: DragEvent, id: string) {
  if (!dragSourceId || dragSourceId === id) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverId.value = id
}

function onDragLeave(id: string) {
  if (dragOverId.value === id) dragOverId.value = null
}

function onDrop(e: DragEvent, toId: string) {
  e.preventDefault()
  dragOverId.value = null
  if (!dragSourceId || dragSourceId === toId) return
  emit('reorder', dragSourceId, toId)
  dragSourceId = null
}

function onDragEnd() {
  dragOverId.value = null
  dragSourceId = null
}
</script>

<template>
  <div class="tab-bar">
    <!-- Home tab -->
    <button
      class="tab"
      :class="{ active: activeTabId === 'home' }"
      @click="emit('select-tab', 'home')"
      title="My Channels"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
      <span class="tab-label">My channels</span>
    </button>

    <!-- Watched channel tabs -->
    <div
      v-for="ch in watchedChannels"
      :key="ch.id"
      class="tab-wrapper"
      :class="{ 'drag-over': dragOverId === ch.id }"
      draggable="true"
      @dragstart="onDragStart($event, ch.id)"
      @dragover="onDragOver($event, ch.id)"
      @dragleave="onDragLeave(ch.id)"
      @drop="onDrop($event, ch.id)"
      @dragend="onDragEnd"
    >
      <button
        class="tab"
        :class="{ active: activeTabId === ch.id }"
        :style="activeTabId === ch.id ? { '--tab-color': platformColor(ch.platform) } : {}"
        @click="emit('select-tab', ch.id)"
        :title="`${ch.platform}: ${ch.displayName}`"
      >
        <!-- Live dot: only shown when stream is live -->
        <span
          v-if="isLive(ch.id)"
          class="live-dot"
          :style="{ '--dot-color': platformColor(ch.platform) }"
        />

        <!-- Platform icon -->
        <component
          :is="
            ch.platform === 'twitch' ? TwitchIcon : ch.platform === 'kick' ? KickIcon : YoutubeIcon
          "
          width="12"
          height="12"
          fill="currentColor"
        />
        <span class="tab-label">
          {{
            (props.tabChannelNames?.get(ch.id) ?? []).length > 0
              ? props.tabChannelNames!.get(ch.id)!.join(', ')
              : ch.displayName
          }}
        </span>
        <span v-if="viewerCount(ch.id) !== undefined" class="tab-viewers">
          {{ formatViewers(viewerCount(ch.id)!) }}
        </span>
      </button>

      <!-- Close button — only show when this tab is hovered -->
      <button
        class="tab-close"
        :title="`Remove ${ch.displayName}`"
        @click.stop="emit('remove-channel', ch.id)"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <!-- Add button -->
    <button class="tab tab-add" @click="emit('add-channel')" title="Add channel">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecep="round"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px 0;
  border-bottom: 1px solid var(--c-border, #2a2a33);
  background: var(--c-nav-bg, #111114);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.tab-bar::-webkit-scrollbar {
  display: none;
}

.tab-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.tab-wrapper:hover .tab-close {
  opacity: 1;
  pointer-events: auto;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px 6px;
  border: none;
  background: none;
  color: var(--c-text-2, #8b8b99);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  border-radius: 6px 6px 0 0;
  transition:
    color 0.15s,
    background 0.15s;
  white-space: nowrap;
  position: relative;
  bottom: -1px;
  border-bottom: 2px solid transparent;
  flex-shrink: 0;
}

.tab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--c-text, #e2e2e8);
}

.tab.active {
  color: var(--tab-color, #a78bfa);
  border-bottom-color: var(--tab-color, #a78bfa);
  background: rgba(167, 139, 250, 0.06);
}

.tab-label {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Live indicator dot */
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dot-color, #22c55e);
  flex-shrink: 0;
}

.tab-viewers {
  font-size: 10px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.tab-close {
  position: absolute;
  right: -2px;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: none;
  background: var(--c-surface-2, #1f1f24);
  color: var(--c-text-2, #8b8b99);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.15s,
    background 0.15s,
    color 0.15s;
  z-index: 1;
}

.tab-close:hover {
  background: #ef4444;
  color: #fff;
}

.tab-add {
  padding: 5px 8px 6px;
  opacity: 0.5;
  flex-shrink: 0;
}

.tab-add:hover {
  opacity: 1;
}

.tab-wrapper.drag-over {
  border-left: 2px solid var(--c-text-2, #8b8b99);
}
</style>
