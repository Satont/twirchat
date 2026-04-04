<script setup lang="ts">
import { computed } from 'vue'
import ChatList from './ChatList.vue'
import type {
  Account,
  AppSettings,
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'

const props = defineProps<{
  panelId: string
  type: 'combined' | 'channel'
  channelId?: string
  channelName?: string
  platform?: Platform
  messages: NormalizedChatMessage[]
  watchedMessages?: Map<string, NormalizedChatMessage[]>
  watchedChannel?: WatchedChannel
  watchedStatus?: PlatformStatusInfo
  settings: AppSettings
  accounts: Account[]
  statuses: Map<string, PlatformStatusInfo>
}>()

const emit = defineEmits<{
  close: []
  maximize: []
}>()

const filteredMessages = computed<NormalizedChatMessage[]>(() => {
  if (props.type === 'channel' && props.channelId) {
    return props.messages.filter((m) => m.channelId === props.channelId)
  }
  return props.messages
})

const panelTitle = computed<string>(() => {
  if (props.type === 'channel') {
    if (props.channelName) {
      return props.channelName
    }
    if (props.channelId) {
      return props.channelId
    }
    return 'Channel'
  }
  return 'Combined'
})

function platformColor(p: string): string {
  switch (p) {
    case 'twitch': {
      return '#9146ff'
    }
    case 'youtube': {
      return '#ff0000'
    }
    case 'kick': {
      return '#53fc18'
    }
    default: {
      return '#a78bfa'
    }
  }
}
</script>

<template>
  <div class="chat-panel" :data-panel-id="panelId" :data-type="type">
    <!-- Panel header -->
    <div class="panel-header">
      <div class="panel-header-left">
        <!-- Platform color dot for channel panels -->
        <span
          v-if="type === 'channel' && platform"
          class="panel-platform-dot"
          :style="{ background: platformColor(platform) }"
        />

        <span class="panel-title">{{ panelTitle }}</span>

        <!-- Platform badge for channel panels -->
        <span
          v-if="type === 'channel' && platform"
          class="panel-platform-badge"
          :style="{ color: platformColor(platform) }"
        >
          {{ platform }}
        </span>

        <!-- Message count -->
        <span v-if="filteredMessages.length > 0" class="panel-msg-count">
          {{ filteredMessages.length }}
        </span>
      </div>

      <div class="panel-header-actions">
        <!-- Maximize button -->
        <button class="panel-action-btn" title="Maximize" @click="emit('maximize')">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>

        <!-- Close button -->
        <button
          class="panel-action-btn panel-action-btn--close"
          title="Close panel"
          @click="emit('close')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Content area -->
    <div class="panel-content">
      <ChatList
        :messages="filteredMessages"
        :settings="settings"
        :accounts="accounts"
        :statuses="statuses"
        :watched-channel="watchedChannel ?? null"
        :watched-channel-status="watchedStatus ?? null"
        :watched-messages="
          watchedChannel ? (watchedMessages?.get(watchedChannel.id) ?? []) : undefined
        "
      />
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
  background: var(--c-bg, #0f0f11);
  border-radius: 8px;
  border: 1px solid var(--c-border, #2a2a33);
}

/* ---- Header ---- */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px 0 12px;
  height: 40px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--c-border, #2a2a33);
  background: var(--c-surface, #18181b);
}

.panel-header-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
}

.panel-platform-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--c-text-2, #8b8b99);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}

.panel-platform-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: capitalize;
  opacity: 0.85;
  flex-shrink: 0;
}

.panel-msg-count {
  font-size: 10px;
  color: var(--c-text-2, #8b8b99);
  background: rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 1px 6px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* ---- Header action buttons ---- */
.panel-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.panel-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--c-text-2, #8b8b99);
  cursor: pointer;
  padding: 5px;
  border-radius: 5px;
  transition:
    background 0.12s,
    color 0.12s;
}

.panel-action-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--c-text, #e2e2e8);
}

.panel-action-btn--close:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

/* ---- Content ---- */
.panel-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
