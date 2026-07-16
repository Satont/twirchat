<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { VList } from 'virtua/vue'
import type { EmoteCatalogEntry, EmoteSource } from '@twirchat/shared/protocol'
import { useEmoteStore } from '../stores/emoteStore'
import { groupEmoteCatalog } from '../utils/emote-catalog'

const ITEMS_PER_ROW = 7

const props = defineProps<{
  platform: string
  channelId: string
  useSessionCache: boolean
}>()

const emit = defineEmits<{
  select: [alias: string]
}>()

const emoteStore = useEmoteStore()
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<InstanceType<typeof VList> | null>(null)

type PickerRow =
  | { kind: 'heading'; source: EmoteSource; label: string }
  | { kind: 'emotes'; source: EmoteSource; entries: EmoteCatalogEntry[] }

onMounted(() => {
  void emoteStore.loadEmotes(props.platform, props.channelId, props.useSessionCache)
})

const cacheKey = computed(() => `${props.platform}:${props.channelId}`)

const allEmotes = computed((): EmoteCatalogEntry[] => {
  return emoteStore.emoteMap.get(cacheKey.value) ?? []
})

const isLoading = computed((): boolean => {
  return allEmotes.value.length === 0 && !emoteStore.emoteMap.has(cacheKey.value)
})

const emoteGroups = computed(() => groupEmoteCatalog(allEmotes.value, searchQuery.value))

const pickerRows = computed<PickerRow[]>(() => {
  const rows: PickerRow[] = []
  for (const group of emoteGroups.value) {
    rows.push({ kind: 'heading', source: group.source, label: group.label })
    for (let index = 0; index < group.entries.length; index += ITEMS_PER_ROW) {
      rows.push({
        kind: 'emotes',
        source: group.source,
        entries: group.entries.slice(index, index + ITEMS_PER_ROW),
      })
    }
  }
  return rows
})

watch(pickerRows, () => {
  listRef.value?.scrollToIndex(0)
})

defineExpose({
  focus: () => searchInputRef.value?.focus(),
})
</script>

<template>
  <div class="emote-picker">
    <div class="emote-picker-search">
      <div class="search-icon">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        placeholder="Search emotes…"
        class="emote-search-input"
      />
    </div>
    <div v-if="isLoading" class="emote-picker-state">
      <span class="state-spinner" />
      Loading…
    </div>
    <div v-else-if="emoteGroups.length === 0" class="emote-picker-state">No emotes found</div>
    <div v-else class="emote-picker-grid-container">
      <VList ref="listRef" :data="pickerRows" class="emote-grid-list">
        <template #default="{ item: row }">
          <div v-if="row.kind === 'heading'" class="emote-group-heading">
            {{ row.label }}
          </div>
          <div v-else class="emote-row">
            <div
              v-for="emote in row.entries"
              :key="`${emote.source}:${emote.id}`"
              class="emote-cell"
              :title="emote.alias"
              @click="emit('select', emote.alias)"
            >
              <img :src="emote.imageUrl" :alt="emote.alias" class="emote-img" loading="lazy" />
            </div>
          </div>
        </template>
      </VList>
    </div>
  </div>
</template>

<style scoped>
.emote-picker {
  width: 300px;
  display: flex;
  flex-direction: column;
}

/* ---- Search bar ---- */
.emote-picker-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--c-border, #2a2a33);
}

.search-icon {
  flex-shrink: 0;
  color: var(--c-text-2, #8b8b99);
  display: flex;
  align-items: center;
}

.emote-search-input {
  flex: 1;
  background: transparent;
  border: none;
  padding: 0;
  color: var(--c-text, #e2e2e8);
  font-size: 13px;
  outline: none;
  font-family: inherit;
}
.emote-search-input::placeholder {
  color: var(--c-text-2, #8b8b99);
}

/* ---- States ---- */
.emote-picker-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 24px;
  color: var(--c-text-2, #8b8b99);
  font-size: 13px;
}

.state-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: rgba(167, 139, 250, 0.7);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---- Grid ---- */
.emote-picker-grid-container {
  /* VList needs explicit height */
}

.emote-grid-list {
  height: 340px;
}

.emote-group-heading {
  color: var(--c-text-2, #8b8b99);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 10px 10px 4px;
  text-transform: uppercase;
}

.emote-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  padding: 2px 6px;
  gap: 2px;
}

.emote-cell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 6px;
  padding: 5px;
  transition: background 0.1s;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}
.emote-cell:hover {
  background: rgba(255, 255, 255, 0.09);
}

.emote-img {
  width: 32px;
  height: 32px;
  max-width: 32px;
  max-height: 32px;
  object-fit: contain;
  pointer-events: none;
  display: block;
  flex-shrink: 0;
}
</style>
