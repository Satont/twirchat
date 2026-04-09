<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { VList } from 'virtua/vue'
import type { VListHandle } from 'virtua/vue'
import ChatMessage from './ChatMessage.vue'
import ChatInput from './ChatInput.vue'
import Tooltip from './ui/Tooltip.vue'
import ChatAppearancePopover from './ui/ChatAppearancePopover.vue'
import { rpc } from '../main'
import { platformColor } from '../../shared/utils/platform'
import { useStreamStatusStore } from '../stores/streamStatus'
import KickIcon from '../../../assets/icons/platforms/kick.svg'
import TwitchIcon from '../../../assets/icons/platforms/twitch.svg'
import YoutubeIcon from '../../../assets/icons/platforms/youtube.svg'
import type {
  Account,
  AppSettings,
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
import type { ChannelStatus, ChannelStatusRequest } from '@twirchat/shared/protocol'

const props = defineProps<{
  messages: NormalizedChatMessage[]
  settings: AppSettings | null
  accounts: Account[]
  statuses: Map<string, PlatformStatusInfo>
  /** Set when a watched channel tab is active */
  watchedChannel?: WatchedChannel | null
  watchedChannelStatus?: PlatformStatusInfo | null
  watchedMessages?: NormalizedChatMessage[]
  /** Whether this is the main (combined) panel — hides split/close actions */
  isMain?: boolean
  /** Whether the chat header acts as a drag handle */
  isDraggable?: boolean
}>()

const emit = defineEmits<{
  'go-to-platforms': []
  'settings-change': [settings: AppSettings]
  'send-watched': [payload: { text: string; channelId: string; replyToMessageId?: string }]
  'split-right': []
  'change-channel': []
  'close-panel': []
  'header-dragstart': [e: DragEvent]
  'header-dragend': []
}>()

const vlistRef = ref<VListHandle | null>(null)
const isAtBottom = ref(true)

function onVListScroll(offset: number) {
  // offset = scrollTop from top. At bottom when scrollTop + viewportSize ≈ scrollSize.
  const handle = vlistRef.value
  if (!handle) return
  isAtBottom.value = handle.scrollSize - offset - handle.viewportSize < 40
}

function scrollToBottom() {
  const len = activeMessages.value.length
  if (len > 0) vlistRef.value?.scrollToIndex(len - 1, { align: 'end' })
}

const replyTarget = ref<NormalizedChatMessage | null>(null)
const showMenu = ref(false)

function onReply(msg: NormalizedChatMessage) {
  replyTarget.value = msg
}

const streamStatusStore = useStreamStatusStore()

function platformIcon(platform: string) {
  if (platform === 'twitch') return TwitchIcon
  if (platform === 'kick') return KickIcon
  return YoutubeIcon
}

const watchedStreamStatus = computed(() => {
  if (!props.watchedChannel || props.watchedChannel.platform === 'youtube') return undefined
  return streamStatusStore.getStatus(
    props.watchedChannel.platform as 'twitch' | 'kick',
    props.watchedChannel.channelSlug,
  )
})

// ---- Active messages (home vs watched) ----
const activeMessages = computed<NormalizedChatMessage[]>(() => {
  if (props.watchedChannel) {
    return props.watchedMessages ?? []
  }
  return props.messages
})

// Connected channels: derived from statuses map — twitch/kick only (backend channels-status API)
const connectedChannels = computed<ChannelStatusRequest[]>(() => {
  const result: ChannelStatusRequest[] = []
  for (const [, info] of props.statuses) {
    if (
      (info.status === 'connected' || info.status === 'connecting') &&
      info.channelLogin &&
      (info.platform === 'twitch' || info.platform === 'kick')
    ) {
      result.push({ channelLogin: info.channelLogin, platform: info.platform as 'twitch' | 'kick' })
    }
  }
  return result
})

// Auto-connected channels for Kick: when user is authenticated, their own channel is auto-connected
const autoConnectedChannels = computed<ChannelStatusRequest[]>(() => {
  const result: ChannelStatusRequest[] = []
  for (const account of props.accounts) {
    // For Kick, when authenticated, auto-connect to user's own channel
    if (account.platform === 'kick') {
      // Check if this channel is not already in connectedChannels (case-insensitive)
      const alreadyConnected = connectedChannels.value.some(
        (ch) =>
          ch.platform === account.platform &&
          ch.channelLogin.toLowerCase() === account.username.toLowerCase(),
      )
      if (!alreadyConnected) {
        result.push({
          channelLogin: account.username,
          platform: account.platform as 'twitch' | 'kick',
        })
      }
    }
  }
  return result
})

// All channels to display: connected + auto-connected
const allChannels = computed<ChannelStatusRequest[]>(() => [
  ...connectedChannels.value,
  ...autoConnectedChannels.value,
])

// Channels shown in the bar: merge allChannels with store-fetched statuses.
// This ensures the bar is visible immediately when a channel is joined, even if
// The store hasn't fetched yet (or fails).
const displayedChannels = computed<ChannelStatus[]>(() =>
  allChannels.value.map((ch) => {
    const stored = streamStatusStore.getStatus(ch.platform, ch.channelLogin)
    if (stored) return stored
    return { channelLogin: ch.channelLogin, isLive: false, platform: ch.platform, title: '' }
  }),
)

onMounted(() => {
  scrollToBottom()
})

// Auto-scroll to bottom when new messages arrive and user is already at bottom
let initialScrollDone = false
watch(
  () => activeMessages.value.length,
  (len) => {
    if (!initialScrollDone && len > 0) {
      initialScrollDone = true
      scrollToBottom()
      return
    }
    if (isAtBottom.value) {
      scrollToBottom()
    }
  },
  { flush: 'post' },
)

// ---- Scroll ----
const hasAnyConnection = computed(() =>
  ['twitch', 'youtube', 'kick'].some((p) => props.statuses.get(p)?.status === 'connected'),
)

function platformName(platform: string): string {
  switch (platform) {
    case 'twitch': {
      return 'Twitch'
    }
    case 'youtube': {
      return 'YouTube'
    }
    case 'kick': {
      return 'Kick'
    }
    default: {
      return platform
    }
  }
}

function formatViewers(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1000) {
    return `${(n / 1_000).toFixed(1)}K`
  }
  return String(n)
}

async function onSend(
  targets: { platform: string; channelLogin: string; text: string; replyToMessageId?: string }[],
) {
  await Promise.allSettled(
    targets.map((t) =>
      rpc.request
        .sendMessage({
          channelId: t.channelLogin,
          platform: t.platform as Platform,
          text: t.text,
          replyToMessageId: t.replyToMessageId,
        })
        .catch((error) => console.warn(`[ChatInput] send failed on ${t.platform}:`, error)),
    ),
  )
  replyTarget.value = null
}

function onSendWatched(payload: { text: string; channelId: string; replyToMessageId?: string }) {
  emit('send-watched', payload)
  replyTarget.value = null
}

function onAppearanceChange(s: AppSettings) {
  emit('settings-change', s)
  rpc.request
    .saveSettings(s)
    .catch((error) => console.warn('[ChatList] saveSettings failed:', error))
}
</script>

<template>
  <div class="chat-wrapper">
    <!-- Chat header -->
    <div
      class="chat-header"
      :class="{ 'is-drag-handle': isDraggable }"
      :draggable="isDraggable"
      @dragstart="(e) => emit('header-dragstart', e)"
      @dragend="emit('header-dragend')"
    >
      <!-- Watched channel header -->
      <template v-if="watchedChannel">
        <span
          class="watched-dot"
          :class="{
            connected: watchedChannelStatus?.status === 'connected',
            connecting: watchedChannelStatus?.status === 'connecting',
          }"
        />
        <component
          :is="platformIcon(watchedChannel.platform)"
          class="watched-platform-icon"
          :style="{ color: platformColor(watchedChannel.platform) }"
          width="14"
          height="14"
        />
        <span class="chat-header-title">{{ watchedChannel.displayName }}</span>
        <template v-if="watchedStreamStatus?.isLive">
          <span v-if="watchedStreamStatus.viewerCount !== undefined" class="watched-viewers">
            {{ formatViewers(watchedStreamStatus.viewerCount) }}
          </span>
          <span v-if="watchedStreamStatus.categoryName" class="watched-category">
            {{ watchedStreamStatus.categoryName }}
          </span>
          <span v-if="watchedStreamStatus.title" class="watched-stream-title">
            {{ watchedStreamStatus.title }}
          </span>
        </template>
        <span
          v-if="watchedChannelStatus"
          class="watched-mode"
          :class="{ anon: watchedChannelStatus.mode !== 'authenticated' }"
        >
          {{ watchedChannelStatus.mode === 'authenticated' ? 'authenticated' : 'read-only' }}
        </span>
      </template>

      <!-- Home header -->
      <template v-else>
        <span class="chat-header-title">Live Chat</span>

        <!-- Channel status chips -->
        <div v-if="displayedChannels.length > 0" class="header-chips">
          <Tooltip
            v-for="ch in displayedChannels"
            :key="`${ch.platform}:${ch.channelLogin}`"
            side="bottom"
            :side-offset="8"
          >
            <div
              class="header-chip"
              :class="{ live: ch.isLive }"
              :style="{ '--chip-color': platformColor(ch.platform) }"
            >
              <span class="chip-dot" :class="{ pulse: ch.isLive }" />
              <span class="chip-name">{{ ch.channelLogin }}</span>
              <span v-if="ch.isLive && ch.viewerCount !== undefined" class="chip-viewers">
                {{ formatViewers(ch.viewerCount) }}
              </span>
            </div>

            <template #content>
              <div class="chip-tooltip-header">
                <span class="chip-tooltip-platform" :style="{ color: platformColor(ch.platform) }">
                  {{ platformName(ch.platform) }}
                </span>
                <span class="chip-tooltip-status" :class="{ live: ch.isLive }">
                  {{ ch.isLive ? 'LIVE' : 'Offline' }}
                </span>
              </div>
              <div v-if="ch.title" class="chip-tooltip-title">{{ ch.title }}</div>
              <div v-if="ch.categoryName" class="chip-tooltip-row">
                <span class="chip-tooltip-label">Category</span>{{ ch.categoryName }}
              </div>
              <div v-if="ch.isLive && ch.viewerCount !== undefined" class="chip-tooltip-row">
                <span class="chip-tooltip-label">Viewers</span>{{ ch.viewerCount.toLocaleString() }}
              </div>
            </template>
          </Tooltip>
        </div>
      </template>

      <div class="chat-header-right">
        <span class="chat-count" v-if="activeMessages.length > 0"
          >{{ activeMessages.length }} messages</span
        >

        <!-- Appearance popup button -->
        <ChatAppearancePopover v-if="settings" :settings="settings" @change="onAppearanceChange" />

        <!-- Panel action buttons (non-main panels only) -->
        <template v-if="!isMain">
          <div v-if="showMenu" class="menu-overlay" @click="showMenu = false" />
          <div class="panel-actions">
            <!-- + split button -->
            <button class="panel-action-btn" title="Split right" @click.stop="emit('split-right')">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <!-- ⋮ menu button -->
            <button class="panel-action-btn panel-menu-btn" @click.stop="showMenu = !showMenu">
              ⋮
            </button>
            <div v-if="showMenu" class="panel-menu-dropdown">
              <button v-if="watchedChannel" class="menu-item" @click="emit('change-channel')">
                📺 Change channel
              </button>
              <div v-if="watchedChannel" class="menu-divider" />
              <button class="menu-item menu-item-danger" @click="emit('close-panel')">
                ✕ Close panel
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Messages + scroll pill wrapper -->
    <div class="chat-list-wrapper">
      <VList
        v-if="activeMessages.length > 0"
        ref="vlistRef"
        class="chat-list"
        :data="activeMessages"
        @scroll="onVListScroll"
      >
        <template #default="{ item }">
          <ChatMessage
            :key="item.id"
            :message="item"
            :show-platform-color-stripe="settings?.showPlatformColorStripe"
            :show-platform-icon="settings?.showPlatformIcon"
            :show-timestamp="settings?.showTimestamp"
            :show-avatar="settings?.showAvatars"
            :show-badges="settings?.showBadges"
            :font-size="settings?.fontSize"
            :chat-theme="settings?.chatTheme"
            :accounts="accounts"
            :self-ping-enabled="settings?.selfPing?.enabled"
            :self-ping-color="settings?.selfPing?.color"
            @reply="onReply"
          />
        </template>
      </VList>

      <!-- Empty state -->
      <div v-else class="empty-state chat-list">
        <div class="empty-icon">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            opacity=".35"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>

        <!-- Watched channel: just waiting -->
        <template v-if="watchedChannel">
          <p class="empty-title">
            {{
              watchedChannelStatus?.status === 'connecting'
                ? 'Connecting…'
                : watchedChannelStatus?.status === 'connected'
                  ? 'No messages yet'
                  : 'Connecting…'
            }}
          </p>
          <p class="empty-hint">
            Messages from <strong>{{ watchedChannel.displayName }}</strong> will appear here.
          </p>
        </template>

        <!-- No accounts at all -->
        <template v-else-if="accounts.length === 0 && !hasAnyConnection">
          <p class="empty-title">No accounts connected</p>
          <p class="empty-hint">Connect your streaming accounts to start reading chat.</p>
          <button class="empty-action" @click="emit('go-to-platforms')">Go to Platforms →</button>
        </template>

        <!-- Accounts exist, but no active connection yet -->
        <template v-else-if="!hasAnyConnection">
          <p class="empty-title">Waiting for connection…</p>
          <div class="empty-accounts">
            <div
              v-for="acc in accounts"
              :key="acc.id"
              class="empty-account-chip"
              :style="{ '--chip-color': platformColor(acc.platform) }"
            >
              <img v-if="acc.avatarUrl" :src="acc.avatarUrl" class="chip-avatar" />
              <span v-else class="chip-avatar-fallback">{{
                acc.displayName.charAt(0).toUpperCase()
              }}</span>
              <span class="chip-name">{{ acc.displayName }}</span>
              <span class="chip-platform">{{ acc.platform }}</span>
            </div>
          </div>
          <p class="empty-hint">Join a channel in <strong>Platforms</strong> to see chat.</p>
        </template>

        <!-- Connected, just no messages yet -->
        <template v-else>
          <p class="empty-title">No messages yet</p>
          <p class="empty-hint">Chat messages will appear here in real time.</p>
        </template>
      </div>
      <!-- /empty-state -->

      <!-- Scroll-to-bottom pill -->
      <Transition name="fade">
        <button
          v-if="!isAtBottom && activeMessages.length > 0"
          class="scroll-pill"
          @click="() => scrollToBottom()"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          Scroll to latest
        </button>
      </Transition>
    </div>
    <!-- /.chat-list-wrapper -->

    <!-- Chat input -->
    <ChatInput
      :statuses="statuses"
      :watched-channel="watchedChannel"
      :watched-channel-status="watchedChannelStatus"
      :reply-target="replyTarget"
      :messages="watchedChannel ? (watchedMessages ?? []) : messages"
      @cancel-reply="replyTarget = null"
      @send="onSend"
      @send-watched="onSendWatched"
    />
  </div>
</template>

<style scoped>
.chat-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-list-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--c-border, #2a2a33);
  flex-shrink: 0;
  min-height: 44px;
}

.chat-header.is-drag-handle {
  cursor: grab;
  user-select: none;
}
.chat-header.is-drag-handle:active {
  cursor: grabbing;
}

.watched-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c-text-2, #666);
  flex-shrink: 0;
}
.watched-dot.connected {
  background: #22c55e;
}
.watched-dot.connecting {
  background: #f59e0b;
}

.watched-platform-icon {
  flex-shrink: 0;
  opacity: 0.9;
}

.watched-viewers {
  font-size: 11px;
  font-weight: 600;
  color: #22c55e;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.watched-category {
  font-size: 11px;
  color: var(--c-text-2, #8b8b99);
  flex-shrink: 0;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watched-stream-title {
  font-size: 11px;
  color: var(--c-text-2, #8b8b99);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.watched-mode {
  font-size: 11px;
  color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.25);
  border-radius: 10px;
  padding: 2px 7px;
}
.watched-mode.anon {
  color: var(--c-text-2, #8b8b99);
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}

.chat-header-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--c-text-2, #8b8b99);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex-shrink: 0;
}

/* ---- inline channel chips ---- */
.header-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
}
.header-chips::-webkit-scrollbar {
  display: none;
}

.header-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 6px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: default;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--c-text-2, #aaa);
  transition:
    background 0.15s,
    border-color 0.15s;
}
.header-chip.live {
  background: color-mix(in srgb, var(--chip-color) 12%, transparent);
  border-color: color-mix(in srgb, var(--chip-color) 35%, transparent);
  color: var(--c-text, #e8e8f0);
}
.header-chip:hover {
  background: color-mix(in srgb, var(--chip-color) 20%, transparent);
  border-color: color-mix(in srgb, var(--chip-color) 50%, transparent);
}

.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-text-2, #666);
  flex-shrink: 0;
}
.chip-dot.pulse {
  background: var(--chip-color);
  animation: chip-pulse 2s infinite;
}
@keyframes chip-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--chip-color) 60%, transparent);
  }
  70% {
    box-shadow: 0 0 0 5px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

.chip-name {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip-viewers {
  font-size: 11px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

/* ---- chip tooltip ---- */
/* tooltip content styles live in ui/Tooltip.vue (global block) */

.chat-count {
  font-size: 11px;
  color: var(--c-text-2, #8b8b99);
  flex-shrink: 0;
}

.chat-header-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  position: relative;
}

/* Panel action buttons */
.panel-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  position: relative;
}

.panel-action-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--c-text-2, #8b8b99);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  font-family: inherit;
}
.panel-action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--c-text, #e2e2e8);
}

.panel-menu-btn {
  font-size: 18px;
  line-height: 1;
  width: 28px;
  height: 28px;
}

.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 199;
}

.panel-menu-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--c-surface, #18181b);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 8px;
  padding: 4px;
  min-width: 180px;
  z-index: 200;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--c-text, #e2e2e8);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background 0.15s;
  font-family: inherit;
}
.menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.menu-item-danger {
  color: #ef4444;
}
.menu-item-danger:hover {
  background: rgba(239, 68, 68, 0.15);
}

.menu-divider {
  height: 1px;
  background: var(--c-border, #2a2a33);
  margin: 4px 0;
}

.chat-list {
  flex: 1;
  overflow: hidden;
}

/* Empty state */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px 32px;
  text-align: center;
}

.empty-icon {
  color: var(--c-text-2, #8b8b99);
  margin-bottom: 4px;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text, #e2e2e8);
}

.empty-hint {
  font-size: 13px;
  color: var(--c-text-2, #8b8b99);
  max-width: 280px;
  line-height: 1.5;
}

.empty-hint strong {
  color: #a78bfa;
  font-weight: 600;
}

.empty-action {
  margin-top: 4px;
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
  border: 1px solid rgba(167, 139, 250, 0.3);
  border-radius: 8px;
  padding: 7px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
}
.empty-action:hover {
  background: rgba(167, 139, 250, 0.25);
}

.empty-accounts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin: 4px 0;
}

.empty-account-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px;
  padding: 4px 10px 4px 4px;
  font-size: 12px;
}

.chip-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--chip-color, #a78bfa);
}

.chip-avatar-fallback {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--chip-color, #a78bfa);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.chip-name {
  font-weight: 600;
  color: var(--c-text, #e2e2e8);
}

.chip-platform {
  font-size: 10px;
  color: var(--chip-color, #a78bfa);
  text-transform: capitalize;
  font-weight: 500;
}

/* Scroll pill */
.scroll-pill {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(15, 15, 17, 0.92);
  backdrop-filter: blur(8px);
  color: #e2e2e8;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  z-index: 10;
  font-family: inherit;
  transition: background 0.15s;
}

.scroll-pill:hover {
  background: rgba(30, 30, 36, 0.96);
}

.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}
</style>
