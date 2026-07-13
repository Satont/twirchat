<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { VList } from 'virtua/vue'
import type { VListHandle } from 'virtua/vue'
import type { Platform } from '@twirchat/shared/types'

import { useUserChatHistory } from '../composables/useUserChatHistory'
import UserChatHistoryMessage from './UserChatHistoryMessage.vue'

const props = defineProps<{
  platform: Platform
  platformUserId: string
  open: boolean
}>()

const listRef = ref<VListHandle | null>(null)
const openRef = toRef(props, 'open')
const platformRef = toRef(props, 'platform')
const platformUserIdRef = toRef(props, 'platformUserId')

const { messages, loadingInitial, loadingOlder, error, hasMore, loadOlder, loadInitial } =
  useUserChatHistory(platformRef, platformUserIdRef, openRef)

const isEmpty = computed(() => !loadingInitial.value && messages.value.length === 0 && !error.value)

function onScroll(offset: number): void {
  if (offset < 160) {
    void loadOlder()
  }
}
</script>

<template>
  <section class="history-panel">
    <div class="history-panel-header">
      <div>
        <h4 class="history-panel-title">Chat logs</h4>
        <p class="history-panel-subtitle">Stored local history for this user</p>
      </div>

      <button class="history-panel-refresh" :disabled="loadingInitial" @click="void loadInitial()">
        Refresh
      </button>
    </div>

    <div v-if="loadingInitial" class="history-panel-state">Loading messages…</div>
    <div v-else-if="error" class="history-panel-state history-panel-state-error">
      <span>{{ error }}</span>
      <button class="history-panel-inline-btn" @click="void loadInitial()">Retry</button>
    </div>
    <div v-else-if="isEmpty" class="history-panel-state">No stored messages for this user yet.</div>
    <div v-else class="history-panel-list-wrap">
      <div v-if="hasMore || loadingOlder" class="history-panel-top-status">
        {{ loadingOlder ? 'Loading older messages…' : 'Scroll up to load older messages' }}
      </div>

      <VList
        ref="listRef"
        :data="messages"
        :shift="true"
        class="history-panel-list"
        style="height: 360px"
        @scroll="onScroll"
      >
        <template #default="{ item }">
          <UserChatHistoryMessage :message="item" />
        </template>
      </VList>
    </div>
  </section>
</template>

<style scoped>
.history-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 16px;
}

.history-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.history-panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--c-text, #e2e2e8);
}

.history-panel-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-2, #8b8b99);
}

.history-panel-refresh,
.history-panel-inline-btn {
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--c-text, #e2e2e8);
  cursor: pointer;
  font: inherit;
}

.history-panel-refresh {
  padding: 7px 10px;
  font-size: 12px;
}

.history-panel-inline-btn {
  padding: 6px 10px;
  font-size: 12px;
}

.history-panel-refresh:disabled,
.history-panel-inline-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.history-panel-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 160px;
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--c-text-2, #8b8b99);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.16);
}

.history-panel-state-error {
  color: #fca5a5;
  flex-direction: column;
}

.history-panel-list-wrap {
  min-height: 0;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.16);
}

.history-panel-top-status {
  min-height: 32px;
  box-sizing: border-box;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 11px;
  color: var(--c-text-2, #8b8b99);
}

.history-panel-top-status.quiet {
  color: rgba(139, 139, 153, 0.75);
}

.history-panel-list {
  min-height: 0;
}
</style>
