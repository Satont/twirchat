<script setup lang="ts">
import type { AutocompleteSuggestion } from '../composables/useAutocomplete'

const props = defineProps<{
  suggestions: AutocompleteSuggestion[]
  selectedIndex: number
  mode: 'mention' | 'emote' | null
}>()

const emit = defineEmits<{
  select: [index: number]
}>()
</script>

<template>
  <div v-if="mode && suggestions.length > 0" class="autocomplete-popup" @mousedown.prevent>
    <ul class="autocomplete-list">
      <li
        v-for="(suggestion, i) in suggestions"
        :key="suggestion.label"
        class="autocomplete-item"
        :class="{ 'is-selected': i === selectedIndex }"
        @mousedown.prevent="emit('select', i)"
      >
        <template v-if="suggestion.type === 'mention'">
          <span
            class="mention-dot"
            :style="{ backgroundColor: suggestion.color || '#8b8b99' }"
          ></span>
          <span class="mention-label">{{ suggestion.label }}</span>
        </template>

        <template v-else-if="suggestion.type === 'emote'">
          <img :src="suggestion.imageUrl" width="24" height="24" alt="" class="emote-image" />
          <span class="emote-label">{{ suggestion.label }}</span>
        </template>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.autocomplete-popup {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  max-height: 240px;
  min-width: 200px;
  overflow-y: auto;
  background-color: var(--c-surface-2);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  z-index: 50;
  margin-bottom: 8px;
}

.autocomplete-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.autocomplete-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--c-text);
  user-select: none;
}

.autocomplete-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.autocomplete-item.is-selected {
  background-color: rgba(167, 139, 250, 0.15);
}

.mention-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mention-label,
.emote-label {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--c-text);
}

.emote-image {
  object-fit: contain;
  flex-shrink: 0;
}
</style>
