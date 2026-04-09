<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { VList } from 'virtua/vue'
import type { SevenTVEmote } from '@twirchat/shared/protocol'
import { useEmoteCache } from '../composables/useEmoteCache'
import { fuzzyFilter } from '../utils/fuzzyFilter'

const ITEMS_PER_ROW = 6

const props = defineProps<{
  platform: string
  channelId: string
}>()

const emit = defineEmits<{
  select: [alias: string]
}>()

const { emoteCache, loadEmotes } = useEmoteCache()
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<InstanceType<typeof VList> | null>(null)

onMounted(() => {
  void loadEmotes(props.platform, props.channelId)
})

const cacheKey = computed(() => `${props.platform}:${props.channelId}`)

const allEmotes = computed((): SevenTVEmote[] => {
  return emoteCache.value.get(cacheKey.value) ?? []
})

const isLoading = computed((): boolean => {
  return allEmotes.value.length === 0 && !emoteCache.value.has(cacheKey.value)
})

const filteredEmotes = computed(() => {
  const mapped = allEmotes.value.map((e) => Object.assign({}, e, { label: e.alias }))
  return fuzzyFilter(mapped, searchQuery.value)
})

const emoteRows = computed(() => {
  const rows: (typeof filteredEmotes.value)[] = []
  for (let i = 0; i < filteredEmotes.value.length; i += ITEMS_PER_ROW) {
    rows.push(filteredEmotes.value.slice(i, i + ITEMS_PER_ROW))
  }
  return rows
})

watch(emoteRows, () => {
  listRef.value?.scrollToIndex(0)
})

defineExpose({
  focus: () => searchInputRef.value?.focus(),
})
</script>

<template>
  <div class="emote-picker">
    <div class="emote-picker-search">
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        placeholder="Search emotes…"
        class="emote-search-input"
      />
    </div>
    <div v-if="isLoading" class="emote-picker-loading">Loading…</div>
    <div v-else-if="filteredEmotes.length === 0" class="emote-picker-empty">No emotes found</div>
    <div v-else class="emote-picker-grid-container">
      <VList ref="listRef" :data="emoteRows" style="height: 360px" class="emote-grid-list">
        <template #default="{ item: row }">
          <div class="emote-row">
            <div
              v-for="emote in row"
              :key="emote.id"
              class="emote-cell"
              :title="emote.alias"
              @click="emit('select', emote.alias)"
            >
              <img
                :src="emote.imageUrl"
                :alt="emote.alias"
                width="40"
                height="40"
                loading="lazy"
                class="emote-img"
              />
            </div>
          </div>
        </template>
      </VList>
    </div>
  </div>
</template>

<style scoped>
.emote-picker {
  width: 320px;
  display: flex;
  flex-direction: column;
}

.emote-picker-search {
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--c-border, #2a2a33);
}

.emote-search-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--c-text, #e2e2e8);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}
.emote-search-input::placeholder {
  color: var(--c-text-2, #8b8b99);
}
.emote-search-input:focus {
  border-color: rgba(167, 139, 250, 0.5);
}

.emote-picker-loading,
.emote-picker-empty {
  padding: 24px;
  text-align: center;
  color: var(--c-text-2, #8b8b99);
  font-size: 13px;
}

.emote-picker-grid-container {
  /* VList needs fixed height, NOT max-height */
}

.emote-grid-list {
  /* height set inline via style prop — do not override */
}

.emote-row {
  display: flex;
  flex-wrap: wrap;
  padding: 0 6px;
}

.emote-cell {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.12s;
  flex-shrink: 0;
}
.emote-cell:hover {
  background: rgba(255, 255, 255, 0.08);
}

.emote-img {
  object-fit: contain;
  pointer-events: none;
}
</style>
