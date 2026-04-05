<script setup lang="ts">
import { computed } from 'vue'
import { useLayoutStore } from '../stores/layout'

const layoutStore = useLayoutStore()

const panelCount = computed(() => layoutStore.panelCount.value)
const canAddPanel = computed(() => layoutStore.canAddPanel.value)

const handlePreset2x2 = () => {
  layoutStore.applyPreset2x2()
}

const handlePreset3Vertical = () => {
  layoutStore.applyPreset3Vertical()
}

const handlePreset3Horizontal = () => {
  layoutStore.applyPreset3Horizontal()
}

const handleReset = () => {
  if (confirm('Reset layout to default?')) {
    layoutStore.resetLayout()
  }
}
</script>

<template>
  <div class="layout-toolbar">
    <div class="toolbar-section">
      <span class="toolbar-label">Layout Presets:</span>
      <button class="toolbar-btn" title="2x2 Grid" @click="handlePreset2x2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect x="3" y="3" width="8" height="8" rx="1" />
          <rect x="13" y="3" width="8" height="8" rx="1" />
          <rect x="3" y="13" width="8" height="8" rx="1" />
          <rect x="13" y="13" width="8" height="8" rx="1" />
        </svg>
        <span>2x2</span>
      </button>

      <button class="toolbar-btn" title="3 Vertical" @click="handlePreset3Vertical">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect x="3" y="3" width="5" height="18" rx="1" />
          <rect x="10" y="3" width="5" height="18" rx="1" />
          <rect x="17" y="3" width="5" height="18" rx="1" />
        </svg>
        <span>3 Col</span>
      </button>

      <button class="toolbar-btn" title="3 Horizontal" @click="handlePreset3Horizontal">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect x="3" y="3" width="18" height="5" rx="1" />
          <rect x="3" y="10" width="18" height="5" rx="1" />
          <rect x="3" y="17" width="18" height="5" rx="1" />
        </svg>
        <span>3 Row</span>
      </button>
    </div>

    <div class="toolbar-section">
      <span class="panel-count" :class="{ 'at-limit': !canAddPanel }">
        {{ panelCount }} / 8 panels
      </span>
      <button class="toolbar-btn danger" title="Reset Layout" @click="handleReset">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
        <span>Reset</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.layout-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--c-surface, #18181b);
  border-bottom: 1px solid var(--c-border, #2a2a33);
  gap: 16px;
}

.toolbar-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-label {
  font-size: 12px;
  color: var(--c-text-2, #8b8b99);
  font-weight: 500;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: var(--c-surface-2, #1f1f24);
  color: var(--c-text, #e2e2e8);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.toolbar-btn:hover {
  background: rgba(167, 139, 250, 0.2);
  color: #a78bfa;
}

.toolbar-btn.danger:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.panel-count {
  font-size: 12px;
  color: var(--c-text-2, #8b8b99);
  font-weight: 500;
  padding: 4px 8px;
  background: var(--c-surface-2, #1f1f24);
  border-radius: 4px;
}

.panel-count.at-limit {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}
</style>
