<script setup lang="ts">
import type { ChannelStatus } from "@twirchat/shared/protocol";
import type { Platform } from "@twirchat/shared/types";

const props = defineProps<{
  channels: ChannelStatus[];
}>();

function platformColor(platform: Platform | string): string {
  switch (platform) {
    case "twitch": return "#9146ff";
    case "kick":   return "#53fc18";
    default:       return "#a78bfa";
  }
}

function platformLabel(platform: Platform | string): string {
  switch (platform) {
    case "twitch": return "Twitch";
    case "kick":   return "Kick";
    default:       return platform;
  }
}

function formatViewers(n: number | undefined): string {
  if (n === undefined) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
</script>

<template>
  <div v-if="channels.length > 0" class="channel-bar">
    <div
      v-for="ch in channels"
      :key="`${ch.platform}:${ch.channelLogin}`"
      class="channel-chip"
      :class="{ live: ch.isLive, offline: !ch.isLive }"
      :style="{ '--platform-color': platformColor(ch.platform) }"
    >
      <!-- Status dot -->
      <span class="dot" :class="{ pulse: ch.isLive }" />

      <!-- Channel name -->
      <span class="chip-name">{{ ch.channelLogin }}</span>

      <!-- Viewer count (only when live) -->
      <span v-if="ch.isLive && ch.viewerCount !== undefined" class="chip-viewers">
        {{ formatViewers(ch.viewerCount) }}
      </span>

      <!-- Tooltip -->
      <div class="tooltip" role="tooltip">
        <div class="tooltip-header">
          <span
            class="tooltip-platform"
            :style="{ color: platformColor(ch.platform) }"
          >{{ platformLabel(ch.platform) }}</span>
          <span class="tooltip-status" :class="{ live: ch.isLive }">
            {{ ch.isLive ? "LIVE" : "Offline" }}
          </span>
        </div>
        <div v-if="ch.title" class="tooltip-title">{{ ch.title }}</div>
        <div v-if="ch.categoryName" class="tooltip-category">
          <span class="tooltip-category-label">Category</span>
          {{ ch.categoryName }}
        </div>
        <div v-if="ch.isLive && ch.viewerCount !== undefined" class="tooltip-viewers">
          <span class="tooltip-viewers-label">Viewers</span>
          {{ ch.viewerCount.toLocaleString() }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.channel-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-secondary, #1a1a2e);
  border-bottom: 1px solid var(--border, rgba(255,255,255,0.06));
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
}
.channel-bar::-webkit-scrollbar { display: none; }

/* ---- chip ---- */
.channel-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 6px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: default;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  transition: background 0.15s, border-color 0.15s;
  color: var(--text-secondary, #aaa);
}
.channel-chip.live {
  background: color-mix(in srgb, var(--platform-color) 12%, transparent);
  border-color: color-mix(in srgb, var(--platform-color) 35%, transparent);
  color: var(--text-primary, #e8e8f0);
}
.channel-chip:hover {
  background: color-mix(in srgb, var(--platform-color) 20%, transparent);
  border-color: color-mix(in srgb, var(--platform-color) 50%, transparent);
}

/* ---- status dot ---- */
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-secondary, #666);
  flex-shrink: 0;
}
.dot.pulse {
  background: var(--platform-color);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--platform-color) 60%, transparent);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0%   { box-shadow: 0 0 0 0   color-mix(in srgb, var(--platform-color) 60%, transparent); }
  70%  { box-shadow: 0 0 0 5px transparent; }
  100% { box-shadow: 0 0 0 0   transparent; }
}

.chip-name {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip-viewers {
  font-size: 11px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

/* ---- tooltip ---- */
.tooltip {
  visibility: hidden;
  opacity: 0;
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 200px;
  max-width: 280px;
  background: var(--bg-tooltip, #1e1e30);
  border: 1px solid var(--border, rgba(255,255,255,0.1));
  border-radius: 8px;
  padding: 10px 12px;
  z-index: 999;
  pointer-events: none;
  transition: opacity 0.15s, visibility 0.15s;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
/* Arrow */
.tooltip::before {
  content: "";
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 8px;
  height: 8px;
  background: var(--bg-tooltip, #1e1e30);
  border-left: 1px solid var(--border, rgba(255,255,255,0.1));
  border-top: 1px solid var(--border, rgba(255,255,255,0.1));
}
.channel-chip:hover .tooltip {
  visibility: visible;
  opacity: 1;
}

.tooltip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.tooltip-platform {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.tooltip-status {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-secondary, #888);
}
.tooltip-status.live {
  color: #4ade80;
}

.tooltip-title {
  font-size: 13px;
  color: var(--text-primary, #e8e8f0);
  line-height: 1.4;
  margin-bottom: 4px;
  word-break: break-word;
}
.tooltip-category,
.tooltip-viewers {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary, #999);
  margin-top: 3px;
}
.tooltip-category-label,
.tooltip-viewers-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.6;
  flex-shrink: 0;
}
</style>
