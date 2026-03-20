<script setup lang="ts">
import type { NormalizedChatMessage, Emote } from "@chatrix/shared/types";

const props = defineProps<{
  message: NormalizedChatMessage;
  showPlatformIcon?: boolean;
  showAvatar?: boolean;
  showBadges?: boolean;
  fontSize?: number;
}>();

function platformColor(platform: string): string {
  switch (platform) {
    case "twitch": return "#9146ff";
    case "youtube": return "#ff0000";
    case "kick": return "#53fc18";
    default: return "#888";
  }
}

/** Replace emote positions with <img> tags */
function renderText(msg: NormalizedChatMessage): string {
  if (!msg.emotes.length) return escapeHtml(msg.text);

  const chars = [...msg.text];
  const result: string[] = [];
  let i = 0;

  // Build sorted list of emote ranges
  const ranges: Array<{ start: number; end: number; emote: Emote }> = [];
  for (const emote of msg.emotes) {
    for (const pos of emote.positions) {
      ranges.push({ ...pos, emote });
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  for (const range of ranges) {
    if (i < range.start) {
      result.push(escapeHtml(chars.slice(i, range.start).join("")));
    }
    result.push(
      `<img class="emote" src="${escapeHtml(range.emote.imageUrl)}" alt="${escapeHtml(range.emote.name)}" title="${escapeHtml(range.emote.name)}" />`
    );
    i = range.end + 1;
  }

  if (i < chars.length) {
    result.push(escapeHtml(chars.slice(i).join("")));
  }

  return result.join("");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
</script>

<template>
  <div
    class="chat-message"
    :class="[`platform-${message.platform}`, message.type === 'action' ? 'action' : '']"
    :style="{ fontSize: `${props.fontSize ?? 14}px` }"
  >
    <!-- Platform indicator -->
    <span
      v-if="props.showPlatformIcon !== false"
      class="platform-dot"
      :style="{ background: platformColor(message.platform) }"
      :title="message.platform"
    />

    <!-- Avatar -->
    <img
      v-if="props.showAvatar !== false && message.author.avatarUrl"
      class="avatar"
      :src="message.author.avatarUrl"
      :alt="message.author.displayName"
    />
    <span
      v-else-if="props.showAvatar !== false"
      class="avatar avatar-placeholder"
    >{{ message.author.displayName[0] }}</span>

    <!-- Author -->
    <span
      class="author"
      :style="message.author.color ? { color: message.author.color } : {}"
    >{{ message.author.displayName }}</span>

    <!-- Badges -->
    <span
      v-if="props.showBadges !== false"
      class="badges"
    >
      <span
        v-for="badge in message.author.badges"
        :key="badge.id"
        class="badge"
        :title="badge.type"
      >
        <img v-if="badge.imageUrl" :src="badge.imageUrl" :alt="badge.text" />
        <span v-else>{{ badge.text }}</span>
      </span>
    </span>

    <span class="separator">:</span>

    <!-- Message text with emotes -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <span class="text" v-html="renderText(message)" />
  </div>
</template>

<style scoped>
.chat-message {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  line-height: 1.4;
  word-break: break-word;
}

.chat-message:hover {
  background: rgba(255, 255, 255, 0.03);
}

.chat-message.action .text {
  font-style: italic;
}

.platform-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.avatar {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
}

.avatar-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #444;
  color: #ccc;
  font-size: 10px;
  font-weight: 600;
}

.author {
  flex-shrink: 0;
  font-weight: 600;
  cursor: default;
}

.badges {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}

.badge img {
  width: 14px;
  height: 14px;
}

.badge span {
  font-size: 10px;
  padding: 1px 3px;
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
}

.separator {
  flex-shrink: 0;
  color: #888;
}

.text {
  flex: 1;
}

:deep(.emote) {
  width: 24px;
  height: 24px;
  vertical-align: middle;
  display: inline-block;
}
</style>
