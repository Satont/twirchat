<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { fuzzyFilter } from '../utils/fuzzyFilter'

export interface TabItem {
  id: string
  label: string
  platform?: 'twitch' | 'kick' | 'youtube'
  isLive?: boolean
}

const props = defineProps<{
  tabs: TabItem[]
  activeTabId: string
}>()

const emit = defineEmits<{
  select: [id: string]
  close: []
}>()

const searchRef = ref<HTMLInputElement | null>(null)
const query = ref('')
const previousFocus = ref<HTMLElement | null>(null)

const selectedIdx = ref(0)

const filteredTabs = computed(() => {
  return fuzzyFilter(props.tabs, query.value) as TabItem[]
})

watch(query, () => {
  selectedIdx.value = 0
})

onMounted(() => {
  previousFocus.value = document.activeElement as HTMLElement

  const activeIdx = filteredTabs.value.findIndex((t) => t.id === props.activeTabId)
  if (activeIdx !== -1) {
    selectedIdx.value = activeIdx
  }

  nextTick(() => {
    searchRef.value?.focus()
  })
})

onUnmounted(() => {
  if (previousFocus.value && typeof previousFocus.value.focus === 'function') {
    previousFocus.value.focus()
  }
})

function confirmSelection() {
  const item = filteredTabs.value[selectedIdx.value]
  if (item) {
    emit('select', item.id)
    emit('close')
  }
}

function selectTab(id: string) {
  emit('select', id)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" data-testid="tab-selector-modal" @click.self="emit('close')">
      <div class="modal" @keydown.stop>
        <div class="modal-search">
          <input
            ref="searchRef"
            v-model="query"
            placeholder="Switch to tab…"
            class="search-input"
            data-testid="tab-selector-search"
            @keydown.down.prevent="selectedIdx = Math.min(selectedIdx + 1, filteredTabs.length - 1)"
            @keydown.up.prevent="selectedIdx = Math.max(selectedIdx - 1, 0)"
            @keydown.enter.prevent="confirmSelection"
            @keydown.escape.prevent="emit('close')"
          />
        </div>
        <div class="modal-list" data-testid="tab-selector-list">
          <button
            v-for="(tab, idx) in filteredTabs"
            :key="tab.id"
            class="tab-item"
            :class="{ selected: idx === selectedIdx, active: tab.id === activeTabId }"
            data-testid="tab-selector-item"
            @click="selectTab(tab.id)"
          >
            <span v-if="tab.platform" class="platform-badge">[{{ tab.platform }}]</span>
            <span class="tab-label">{{ tab.label }}</span>
            <span v-if="tab.isLive" class="live-dot" />
          </button>
        </div>
        <div v-if="filteredTabs.length === 0" class="modal-empty">No tabs match "{{ query }}"</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.modal {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  width: 400px;
  max-width: 90vw;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-search {
  width: 100%;
}

.search-input {
  width: 100%;
  padding: 12px 16px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--c-border);
  color: var(--c-text);
  font-size: 14px;
  outline: none;
}

.modal-list {
  max-height: 300px;
  overflow-y: auto;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 16px;
  background: none;
  border: none;
  color: var(--c-text);
  cursor: pointer;
  text-align: left;
}

.tab-item.selected {
  background: rgba(167, 139, 250, 0.15);
}

.tab-item.active {
  font-weight: 600;
}

.tab-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.platform-badge {
  font-size: 10px;
  opacity: 0.7;
  text-transform: uppercase;
}

.tab-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  flex-shrink: 0;
  margin-left: auto;
}

.modal-empty {
  padding: 16px;
  color: var(--c-text);
  opacity: 0.5;
  text-align: center;
}
</style>
