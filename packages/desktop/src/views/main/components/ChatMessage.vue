<script setup lang="ts">
import { ref } from "vue";
import type { NormalizedChatMessage, Emote } from "@twirchat/shared/types";

const props = defineProps<{
  message: NormalizedChatMessage;
  showPlatformIcon?: boolean;
  showAvatar?: boolean;
  showBadges?: boolean;
  fontSize?: number;
  chatTheme?: "modern" | "compact";
}>();

function platformColor(platform: string): string {
  switch (platform) {
    case "twitch":
      return "#9146ff";
    case "youtube":
      return "#ff0000";
    case "kick":
      return "#53fc18";
    default:
      return "#888";
  }
}

function platformLabel(platform: string): string {
  switch (platform) {
    case "twitch":
      return "T";
    case "youtube":
      return "Y";
    case "kick":
      return "K";
    default:
      return "?";
  }
}

/** Replace emote positions with <img> tags */
function renderText(msg: NormalizedChatMessage): string {
  if (!msg.emotes.length) return escapeHtml(msg.text);

  const chars = [...msg.text];
  const result: string[] = [];
  let i = 0;

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
      `<img class="emote" src="${escapeHtml(range.emote.imageUrl)}" alt="${escapeHtml(range.emote.name)}" title="${escapeHtml(range.emote.name)}" />`,
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

const brokenBadges = ref(new Set<string>());

function onBadgeError(id: string): void {
  brokenBadges.value = new Set([...brokenBadges.value, id]);
}

function formatTime(ts: Date): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function initials(name: string): string {
  return name.slice(0, 1).toUpperCase();
}
</script>

<template>
  <!-- ── COMPACT (single-line) ─────────────────────────────── -->
  <div
    v-if="props.chatTheme === 'compact'"
    class="msg msg-compact"
    :class="`platform-${message.platform}`"
    :style="{ '--font-size': `${props.fontSize ?? 14}px` }"
  >
    <span
      v-if="props.showPlatformIcon !== false"
      class="platform-stripe"
      :style="{ background: platformColor(message.platform) }"
    />

    <!-- Badges inline -->
    <span
      v-if="props.showBadges !== false && message.author.badges.length"
      class="badges"
    >
      <span
        v-for="badge in message.author.badges"
        :key="badge.id"
        class="badge"
        :title="badge.type"
      >
        <img
          v-if="badge.imageUrl && !brokenBadges.has(badge.id)"
          :src="badge.imageUrl"
          :alt="badge.text"
          @error="onBadgeError(badge.id)"
        />
        <span v-else class="badge-text">{{ badge.text }}</span>
      </span>
    </span>

    <span
      class="author"
      :style="message.author.color ? { color: message.author.color } : {}"
    >{{ message.author.displayName }}</span>
    <span class="compact-sep">:</span>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <span
      class="msg-text"
      :class="{ italic: message.type === 'action' }"
      v-html="renderText(message)"
    />
  </div>

  <!-- ── MODERN (two-row) ──────────────────────────────────── -->
  <div
    v-else
    class="msg"
    :class="[
      `platform-${message.platform}`,
      message.type === 'action' ? 'is-action' : '',
    ]"
    :style="{ '--font-size': `${props.fontSize ?? 14}px` }"
  >
    <!-- Platform stripe -->
    <span
      v-if="props.showPlatformIcon !== false"
      class="platform-stripe"
      :style="{ background: platformColor(message.platform) }"
      :title="message.platform"
    />

    <!-- Avatar -->
    <div v-if="props.showAvatar !== false" class="avatar-wrap">
      <img
        v-if="message.author.avatarUrl"
        class="avatar"
        :src="message.author.avatarUrl"
        :alt="message.author.displayName"
      />
      <div
        v-else
        class="avatar avatar-fallback"
        :style="{ background: message.author.color ?? '#444' }"
      >
        {{ initials(message.author.displayName) }}
      </div>
    </div>

    <!-- Body -->
    <div class="msg-body">
      <div class="msg-meta">
        <!-- Badges -->
        <span
          v-if="props.showBadges !== false && message.author.badges.length"
          class="badges"
        >
          <span
            v-for="badge in message.author.badges"
            :key="badge.id"
            class="badge"
            :title="badge.type"
          >
            <img
              v-if="badge.imageUrl && !brokenBadges.has(badge.id)"
              :src="badge.imageUrl"
              :alt="badge.text"
              @error="onBadgeError(badge.id)"
            />
            <span v-else class="badge-text">{{ badge.text }}</span>
          </span>
        </span>

        <!-- Author name -->
        <span
          class="author"
          :style="message.author.color ? { color: message.author.color } : {}"
          >{{ message.author.displayName }}</span
        >

        <span class="timestamp">{{ formatTime(message.timestamp) }}</span>
      </div>

      <!-- Message text -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <span
        class="msg-text"
        :class="{ italic: message.type === 'action' }"
        v-html="renderText(message)"
      />
    </div>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 14px;
  font-size: var(--font-size, 14px);
  line-height: 1.45;
  word-break: break-word;
  transition: background 0.1s;
  position: relative;
}

.msg:hover {
  background: rgba(255, 255, 255, 0.025);
}

/* Platform stripe on left edge */
.platform-stripe {
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 2px;
  opacity: 0.7;
}

.avatar-wrap {
  flex-shrink: 0;
  margin-top: 1px;
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
}

.msg-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.msg-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.badges {
  display: flex;
  align-items: center;
  gap: 3px;
}

.badge img {
  width: 14px;
  height: 14px;
  vertical-align: middle;
  display: block;
}

.badge-text {
  font-size: 10px;
  padding: 1px 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  line-height: 1.4;
}

.author {
  font-weight: 700;
  font-size: 0.9em;
  cursor: default;
}

.timestamp {
  font-size: 10px;
  color: var(--c-text-2, #8b8b99);
  margin-left: 2px;
}

.msg-text {
  color: var(--c-text, #e2e2e8);
}

.msg-text.italic {
  font-style: italic;
  opacity: 0.85;
}

:deep(.emote) {
  width: 24px;
  height: 24px;
  vertical-align: middle;
  display: inline-block;
}

/* ── Compact (single-line) ──────────────────────────────── */
.msg-compact {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 3px 14px;
  font-size: var(--font-size, 14px);
  line-height: 1.5;
  word-break: break-word;
  flex-wrap: wrap;
}
.msg-compact:hover {
  background: rgba(255, 255, 255, 0.025);
}
.msg-compact .platform-stripe {
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: 2px;
  border-radius: 2px;
  opacity: 0.7;
}
.msg-compact .author {
  font-weight: 700;
  font-size: 0.9em;
  flex-shrink: 0;
}
.compact-sep {
  color: var(--c-text-2, #8b8b99);
  flex-shrink: 0;
  margin-right: 1px;
}
.msg-compact .msg-text {
  flex: 1;
  min-width: 0;
}
.msg-compact .badges {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}
</style>
