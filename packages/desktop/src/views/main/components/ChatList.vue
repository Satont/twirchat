<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from "vue";
import ChatMessage from "./ChatMessage.vue";
import ChannelStatusBar from "./ChannelStatusBar.vue";
import { rpc } from "../main";
import type {
  NormalizedChatMessage,
  AppSettings,
  Account,
  PlatformStatusInfo,
  Platform,
} from "@twirchat/shared/types";
import type { ChannelStatus, ChannelStatusRequest } from "@twirchat/shared/protocol";

const props = defineProps<{
  messages: NormalizedChatMessage[];
  settings: AppSettings | null;
  accounts: Account[];
  statuses: Map<string, PlatformStatusInfo>;
}>();

const emit = defineEmits<{
  "go-to-platforms": [];
}>();

const listEl = ref<HTMLElement | null>(null);
const isAtBottom = ref(true);

// ---- Channel status bar ----
const channelStatuses = ref<ChannelStatus[]>([]);

// Connected channels: derived from statuses map — any platform-connected entry
const connectedChannels = computed<ChannelStatusRequest[]>(() => {
  const result: ChannelStatusRequest[] = [];
  for (const [, info] of props.statuses) {
    if (
      (info.status === "connected" || info.status === "connecting") &&
      (info.platform === "twitch" || info.platform === "kick") &&
      info.channelLogin
    ) {
      result.push({ platform: info.platform, channelLogin: info.channelLogin });
    }
  }
  return result;
});

// Channels shown in the bar: merge connectedChannels with backend-fetched statuses.
// This ensures the bar is visible immediately when a channel is joined, even if
// the backend fetch hasn't returned yet (or fails).
const displayedChannels = computed<ChannelStatus[]>(() => {
  const backendMap = new Map(
    channelStatuses.value.map((s) => [`${s.platform}:${s.channelLogin}`, s]),
  );
  return connectedChannels.value.map((ch) => {
    const key = `${ch.platform}:${ch.channelLogin}`;
    return (
      backendMap.get(key) ?? {
        platform: ch.platform,
        channelLogin: ch.channelLogin,
        isLive: false,
        title: "",
      }
    );
  });
});

async function fetchChannelStatuses() {
  const channels = connectedChannels.value;
  if (channels.length === 0) {
    channelStatuses.value = [];
    return;
  }
  try {
    const res = await rpc.request.getChannelsStatus({ channels });
    channelStatuses.value = res.channels;
  } catch (err) {
    console.warn("[ChannelStatusBar] fetch failed:", err);
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  fetchChannelStatuses();
  pollTimer = setInterval(fetchChannelStatuses, 10_000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

// Re-fetch immediately when connected channels change
watch(connectedChannels, () => fetchChannelStatuses(), { deep: true });

// ---- Scroll ----
const hasAnyConnection = computed(() =>
  ["twitch", "youtube", "kick"].some(
    (p) => props.statuses.get(p)?.status === "connected",
  ),
);

function onScroll() {
  if (!listEl.value) return;
  const { scrollTop, scrollHeight, clientHeight } = listEl.value;
  isAtBottom.value = scrollHeight - scrollTop - clientHeight < 40;
}

watch(
  () => props.messages.length,
  async () => {
    if (isAtBottom.value) {
      await nextTick();
      listEl.value?.scrollTo({
        top: listEl.value.scrollHeight,
        behavior: "smooth",
      });
    }
  },
);

function scrollToBottom() {
  listEl.value?.scrollTo({
    top: listEl.value.scrollHeight,
    behavior: "smooth",
  });
  isAtBottom.value = true;
}

function platformColor(platform: string): string {
  switch (platform) {
    case "twitch": return "#9146ff";
    case "youtube": return "#ff0000";
    case "kick": return "#53fc18";
    default: return "#a78bfa";
  }
}
</script>

<template>
  <div class="chat-wrapper">
    <!-- Channel status bar -->
    <ChannelStatusBar :channels="displayedChannels" />

    <!-- Chat header -->
    <div class="chat-header">
      <span class="chat-header-title">Live Chat</span>
      <span class="chat-count" v-if="messages.length > 0"
        >{{ messages.length }} messages</span
      >
    </div>

    <!-- Messages -->
    <div ref="listEl" class="chat-list" @scroll="onScroll">
      <template v-if="messages.length > 0">
        <ChatMessage
          v-for="msg in [...messages].reverse()"
          :key="msg.id"
          :message="msg"
          :show-platform-icon="settings?.showPlatformIcon"
          :show-avatar="settings?.showAvatars"
          :show-badges="settings?.showBadges"
          :font-size="settings?.fontSize"
        />
      </template>

      <!-- Empty state -->
      <div v-else class="empty-state">
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
            <path
              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
            />
          </svg>
        </div>

        <!-- No accounts at all -->
        <template v-if="accounts.length === 0">
          <p class="empty-title">No accounts connected</p>
          <p class="empty-hint">Connect your streaming accounts to start reading chat.</p>
          <button class="empty-action" @click="emit('go-to-platforms')">
            Go to Platforms →
          </button>
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
              <span v-else class="chip-avatar-fallback">{{ acc.displayName.charAt(0).toUpperCase() }}</span>
              <span class="chip-name">{{ acc.displayName }}</span>
              <span class="chip-platform">{{ acc.platform }}</span>
            </div>
          </div>
          <p class="empty-hint">Join a channel in <strong>Platforms</strong> to see chat.</p>
        </template>

        <!-- Connected, just no messages yet -->
        <template v-else>
          <p class="empty-title">Waiting for messages…</p>
          <p class="empty-hint">Chat messages will appear here in real time.</p>
        </template>
      </div>
    </div>

    <!-- Scroll-to-bottom pill -->
    <Transition name="fade">
      <button
        v-if="!isAtBottom && messages.length > 0"
        class="scroll-pill"
        @click="scrollToBottom"
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
</template>

<style scoped>
.chat-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--c-border, #2a2a33);
  flex-shrink: 0;
}

.chat-header-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--c-text-2, #8b8b99);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.chat-count {
  font-size: 11px;
  color: var(--c-text-2, #8b8b99);
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 4px 0;
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
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
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
