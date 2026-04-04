<script setup lang="ts">
defineProps<{
  mode: 'combined' | 'split'
  canAddPanel: boolean
  canRemovePanel: boolean
}>()

const emit = defineEmits<{
  'toggle-mode': []
  'add-panel': []
  'remove-panel': []
}>()
</script>

<template>
  <div class="split-toolbar">
    <!-- Mode toggle -->
    <button
      class="toolbar-btn mode-btn"
      :class="{ active: mode === 'split' }"
      :title="mode === 'combined' ? 'Switch to split view' : 'Switch to combined view'"
      @click="emit('toggle-mode')"
    >
      <!-- Combined icon: single pane -->
      <svg
        v-if="mode === 'combined'"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="12" y1="3" x2="12" y2="21" />
      </svg>
      <!-- Split icon: two panes -->
      <svg
        v-else
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
      </svg>
      <span class="btn-label">{{ mode === 'combined' ? 'Split' : 'Combined' }}</span>
    </button>

    <div class="toolbar-divider" />

    <!-- Add panel -->
    <button
      class="toolbar-btn"
      :disabled="!canAddPanel"
      title="Add panel"
      @click="emit('add-panel')"
    >
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

    <!-- Remove panel -->
    <button
      class="toolbar-btn"
      :disabled="!canRemovePanel"
      title="Remove panel"
      @click="emit('remove-panel')"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.split-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 6px;
  background: var(--c-nav-bg, #111114);
  border-bottom: 1px solid var(--c-border, #2a2a33);
  flex-shrink: 0;
}

.toolbar-divider {
  width: 1px;
  height: 16px;
  background: var(--c-border, #2a2a33);
  margin: 0 2px;
  flex-shrink: 0;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border: none;
  background: none;
  color: var(--c-text-2, #8b8b99);
  font-size: 11px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  border-radius: 6px;
  transition:
    background 0.15s,
    color 0.15s,
    opacity 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}

.toolbar-btn:not(:disabled):hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--c-text, #e2e2e8);
}

.toolbar-btn.active {
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
}

.toolbar-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.btn-label {
  line-height: 1;
}
</style>
