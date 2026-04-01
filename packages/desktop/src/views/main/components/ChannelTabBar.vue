<script setup lang="ts">
import type { WatchedChannel } from "@twirchat/shared/types";

const props = defineProps<{
  watchedChannels: WatchedChannel[];
  activeTabId: string; // "home" or a WatchedChannel.id
}>();

const emit = defineEmits<{
  "select-tab": [id: string];
  "add-channel": [];
  "remove-channel": [id: string];
}>();

function platformColor(platform: string): string {
  switch (platform) {
    case "twitch": return "#9146ff";
    case "kick": return "#53fc18";
    default: return "#a78bfa";
  }
}
</script>

<template>
  <div class="tab-bar">
    <!-- Home tab -->
    <button
      class="tab"
      :class="{ active: activeTabId === 'home' }"
      @click="emit('select-tab', 'home')"
      title="My Channels"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
      <span class="tab-label">My channels</span>
    </button>

    <!-- Watched channel tabs -->
    <div
      v-for="ch in watchedChannels"
      :key="ch.id"
      class="tab-wrapper"
    >
      <button
        class="tab"
        :class="{ active: activeTabId === ch.id }"
        :style="activeTabId === ch.id ? { '--tab-color': platformColor(ch.platform) } : {}"
        @click="emit('select-tab', ch.id)"
        :title="`${ch.platform}: ${ch.displayName}`"
      >
        <!-- Platform icon -->
        <svg v-if="ch.platform === 'twitch'" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
        </svg>
        <svg v-else-if="ch.platform === 'kick'" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 2h4v7.5l5-7.5h5l-6 9 6 11h-5l-5-8V22H3z"/>
        </svg>
        <span class="tab-label">{{ ch.displayName }}</span>
      </button>

      <!-- Close button — only show when this tab is hovered -->
      <button
        class="tab-close"
        :title="`Remove ${ch.displayName}`"
        @click.stop="emit('remove-channel', ch.id)"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Add button -->
    <button class="tab tab-add" @click="emit('add-channel')" title="Add channel">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px 0;
  border-bottom: 1px solid var(--c-border, #2a2a33);
  background: var(--c-nav-bg, #111114);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.tab-bar::-webkit-scrollbar { display: none; }

.tab-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.tab-wrapper:hover .tab-close {
  opacity: 1;
  pointer-events: auto;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px 6px;
  border: none;
  background: none;
  color: var(--c-text-2, #8b8b99);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  border-radius: 6px 6px 0 0;
  transition: color 0.15s, background 0.15s;
  white-space: nowrap;
  position: relative;
  bottom: -1px;
  border-bottom: 2px solid transparent;
  flex-shrink: 0;
}

.tab:hover {
  background: rgba(255,255,255,0.05);
  color: var(--c-text, #e2e2e8);
}

.tab.active {
  color: var(--tab-color, #a78bfa);
  border-bottom-color: var(--tab-color, #a78bfa);
  background: rgba(167, 139, 250, 0.06);
}

.tab-label {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-close {
  position: absolute;
  right: -2px;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: none;
  background: var(--c-surface-2, #1f1f24);
  color: var(--c-text-2, #8b8b99);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  z-index: 1;
}

.tab-close:hover {
  background: #ef4444;
  color: #fff;
}

.tab-add {
  padding: 5px 8px 6px;
  opacity: 0.5;
  flex-shrink: 0;
}

.tab-add:hover {
  opacity: 1;
}
</style>
