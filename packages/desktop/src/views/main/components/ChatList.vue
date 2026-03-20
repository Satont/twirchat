<script setup lang="ts">
import { ref, watch, nextTick, computed } from "vue";
import ChatMessage from "./ChatMessage.vue";
import type {
  NormalizedChatMessage,
  AppSettings,
  Account,
  PlatformStatusInfo,
} from "@twirchat/shared/types";

const props = defineProps<{
  messages: NormalizedChatMessage[];
  settings: AppSettings | null;
  accounts: Account[];
  statuses: Map<string, PlatformStatusInfo>;
}>();

const listEl = ref<HTMLElement | null>(null);
const isAtBottom = ref(true);

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
</script>

<template>
  <div class="chat-wrapper">
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
        <template v-if="!hasAnyConnection">
          <p class="empty-title">No channels joined yet</p>
          <p class="empty-hint">
            Go to <strong>Platforms</strong> to connect your accounts and join
            channels.
          </p>
        </template>
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
