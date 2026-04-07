<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { rpc } from '../main'

const platform = ref<string>('')
const isMaximized = ref<boolean>(false)

const onMaximizeChange = (val: boolean) => {
  isMaximized.value = val
}

onMounted(async () => {
  platform.value = await rpc.request.getPlatform()
  isMaximized.value = await rpc.request.windowIsMaximized()
  rpc.addMessageListener('window_maximized_change', onMaximizeChange)
})

onUnmounted(() => {
  rpc.removeMessageListener('window_maximized_change', onMaximizeChange)
})

function minimize() {
  void rpc.request.windowMinimize()
}

function toggleMaximize() {
  void rpc.request.windowMaximize()
}

function close() {
  void rpc.request.windowClose()
}
</script>

<template>
  <div v-if="platform === 'win32'" class="titlebar electrobun-webkit-app-region-drag">
    <div class="titlebar-brand">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" style="color: #a78bfa">
        <rect x="2" y="3" width="20" height="14" rx="3" fill="currentColor" opacity=".9" />
        <path d="M7 21h10M12 17v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <span class="titlebar-title">TwirChat</span>
    </div>
    <div class="titlebar-controls electrobun-webkit-app-region-no-drag">
      <button class="titlebar-btn btn-minimize" @click="minimize" title="Minimize">
        <svg viewBox="0 0 16 16" width="10" height="10">
          <line
            x1="3"
            y1="8"
            x2="13"
            y2="8"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <button
        class="titlebar-btn btn-maximize"
        @click="toggleMaximize"
        :title="isMaximized ? 'Restore' : 'Maximize'"
      >
        <svg v-if="!isMaximized" viewBox="0 0 16 16" width="10" height="10">
          <rect
            x="3"
            y="3"
            width="10"
            height="10"
            rx="1"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
        <svg v-else viewBox="0 0 16 16" width="10" height="10">
          <rect
            x="5"
            y="3"
            width="8"
            height="8"
            rx="1"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
          <rect
            x="3"
            y="5"
            width="8"
            height="8"
            rx="1"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
      </button>
      <button class="titlebar-btn btn-close" @click="close" title="Close">
        <svg viewBox="0 0 16 16" width="10" height="10">
          <line
            x1="4"
            y1="4"
            x2="12"
            y2="12"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
          <line
            x1="12"
            y1="4"
            x2="4"
            y2="12"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  flex-shrink: 0;
  background: #111114;
  padding: 0 0 0 12px;
  user-select: none;
}

.titlebar-brand {
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: none;
}

.titlebar-title {
  font-size: 12px;
  font-weight: 600;
  color: #e2e2e8;
  font-family: var(--font-family, 'Inter', sans-serif);
  margin-left: 6px;
}

.titlebar-controls {
  display: flex;
  align-items: center;
  height: 100%;
  margin-left: auto;
}

.titlebar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 32px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  cursor: default;
  transition: background 0.1s ease;
  flex-shrink: 0;
}

.titlebar-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 1);
}

.btn-close:hover {
  background: #e81123;
  color: #fff;
}
</style>
