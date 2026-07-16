<script setup lang="ts">
import type { TransientNotice } from '../composables/useTransientNotice'

defineProps<{
  notice: TransientNotice | null
}>()
</script>

<template>
  <Transition name="chat-notice">
    <div
      v-if="notice"
      class="chat-notice"
      :class="`chat-notice-${notice.kind}`"
      role="status"
      aria-live="polite"
    >
      <span class="chat-notice-dot" aria-hidden="true" />
      <span>{{ notice.text }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.chat-notice {
  align-items: center;
  backdrop-filter: blur(10px);
  border: 1px solid transparent;
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3);
  display: flex;
  font-size: 13px;
  font-weight: 600;
  gap: 8px;
  left: 50%;
  max-width: min(440px, calc(100vw - 32px));
  padding: 9px 12px;
  position: fixed;
  top: 16px;
  transform: translateX(-50%);
  z-index: 500;
}

.chat-notice-dot {
  background: currentColor;
  border-radius: 50%;
  flex: 0 0 auto;
  height: 7px;
  width: 7px;
}

.chat-notice-info {
  background: rgba(31, 41, 55, 0.94);
  border-color: rgba(148, 163, 184, 0.35);
  color: #e2e8f0;
}

.chat-notice-success {
  background: rgba(20, 83, 45, 0.94);
  border-color: rgba(74, 222, 128, 0.35);
  color: #bbf7d0;
}

.chat-notice-error {
  background: rgba(127, 29, 29, 0.94);
  border-color: rgba(248, 113, 113, 0.4);
  color: #fecaca;
}

.chat-notice-enter-active,
.chat-notice-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.chat-notice-enter-from,
.chat-notice-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}
</style>
