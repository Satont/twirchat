<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import ChatMessage from "./ChatMessage.vue";
import type { NormalizedChatMessage, AppSettings } from "@chatrix/shared/types";

const props = defineProps<{
  messages: NormalizedChatMessage[];
  settings: AppSettings | null;
}>();

const listEl = ref<HTMLElement | null>(null);
const isAtBottom = ref(true);

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
      listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: "smooth" });
    }
  }
);

function scrollToBottom() {
  listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: "smooth" });
  isAtBottom.value = true;
}
</script>

<template>
  <div class="chat-list-wrapper">
    <div
      ref="listEl"
      class="chat-list"
      @scroll="onScroll"
    >
      <ChatMessage
        v-for="msg in [...messages].reverse()"
        :key="msg.id"
        :message="msg"
        :show-platform-icon="settings?.showPlatformIcon"
        :show-avatar="settings?.showAvatars"
        :show-badges="settings?.showBadges"
        :font-size="settings?.fontSize"
      />

      <p v-if="messages.length === 0" class="empty-state">
        No messages yet. Join a channel to start.
      </p>
    </div>

    <button
      v-if="!isAtBottom"
      class="scroll-to-bottom"
      @click="scrollToBottom"
    >
      ↓ Scroll to bottom
    </button>
  </div>
</template>

<style scoped>
.chat-list-wrapper {
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  scroll-behavior: smooth;
}

.empty-state {
  color: #888;
  text-align: center;
  padding: 40px;
  font-size: 14px;
}

.scroll-to-bottom {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  border: 1px solid #444;
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
  z-index: 10;
  transition: background 0.2s;
}

.scroll-to-bottom:hover {
  background: rgba(60, 60, 60, 0.9);
}
</style>
