<script setup lang="ts">
import { ref, onMounted, reactive, computed } from "vue";
import { rpc } from "../main";
import type { NormalizedChatMessage, Emote } from "@twirchat/shared/types";

const props = defineProps<{
  message: NormalizedChatMessage;
  showPlatformColorStripe?: boolean;
  showPlatformIcon?: boolean;
  showTimestamp?: boolean;
  showAvatar?: boolean;
  showBadges?: boolean;
  fontSize?: number;
  chatTheme?: "modern" | "compact";
}>();

// In-memory cache for platform:username -> color (shared across all message instances via module scope)
// Key format: "platform:lowercase_username"
const mentionColorCache = reactive(new Map<string, string | null>());

function makeMentionKey(platform: string, username: string): string {
  return `${platform}:${username.toLowerCase()}`;
}

async function fetchMentionColor(platform: string, username: string): Promise<void> {
  const key = makeMentionKey(platform, username);
  if (mentionColorCache.has(key)) return;
  
  try {
    const color = await rpc.request.getUsernameColor({ 
      platform: platform as import("@twirchat/shared/types").Platform, 
      username 
    });
    mentionColorCache.set(key, color);
  } catch (e) {
    console.warn("[ChatMessage] Failed to fetch color for:", platform, username, e);
    mentionColorCache.set(key, null);
  }
}

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

function platformIconSvg(platform: string): string {
  switch (platform) {
    case "twitch":
      // Twitch glitch logo
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
      </svg>`;
    case "youtube":
      // YouTube play button logo
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>`;
    case "kick":
      // Kick "K" wordmark simplified
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
        <path d="M3 2h4v8l6-8h5l-7 9 7 11h-5l-6-9v9H3Z"/>
      </svg>`;
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
        <circle cx="12" cy="12" r="10"/>
      </svg>`;
  }
}

const URL_REGEX = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;
const MENTION_REGEX = /@([a-zA-Z0-9_]+)/g;

/** Linkify plain-text segment (already HTML-escaped) */
function linkifyText(escaped: string): string {
  return escaped.replace(URL_REGEX, (url) => {
    const safeUrl = url.replace(/"/g, "&quot;");
    return `<a class="msg-link" href="#" data-href="${safeUrl}" title="${safeUrl}">${url}</a>`;
  });
}

/** Highlight @mentions with colors from cache (platform-specific) */
function highlightMentions(escaped: string, platform: string): string {
  return escaped.replace(MENTION_REGEX, (match, username) => {
    const key = makeMentionKey(platform, username);
    const color = mentionColorCache.get(key);
    if (color) {
      return `<span class="mention" style="color: ${color}; font-weight: 600;">${match}</span>`;
    }
    // Fetch color for next time (platform-specific)
    void fetchMentionColor(platform, username);
    return match;
  });
}

/** Compute rendered HTML with emotes, links, and highlighted mentions */
const renderedText = computed(() => {
  const msg = props.message;
  const platform = msg.platform;
  
  // Access the cache to create a dependency for reactivity
  // This ensures the computed property re-evaluates when cache updates
  mentionColorCache.size;
  
  if (!msg.emotes.length) {
    return highlightMentions(linkifyText(escapeHtml(msg.text)), platform);
  }

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
      // Process plain text between emotes: escape -> linkify -> highlight mentions
      result.push(highlightMentions(linkifyText(escapeHtml(chars.slice(i, range.start).join(""))), platform));
    }
    result.push(
      `<img class="emote" src="${escapeHtml(range.emote.imageUrl)}" alt="${escapeHtml(range.emote.name)}" title="${escapeHtml(range.emote.name)}" />`,
    );
    i = range.end + 1;
  }

  if (i < chars.length) {
    result.push(highlightMentions(linkifyText(escapeHtml(chars.slice(i).join(""))), platform));
  }

  return result.join("");
});

/** Legacy function for template compatibility */
function renderText(msg: NormalizedChatMessage): string {
  // Just return the computed value - msg parameter kept for API compatibility
  return renderedText.value;
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
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

function onMsgClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  const anchor = target.closest<HTMLAnchorElement>("a.msg-link");
  if (!anchor) return;
  e.preventDefault();
  const url = anchor.dataset.href;
  if (url) window.open(url, "_blank");
}

// Pre-fetch colors for any @mentions in this message (platform-specific)
onMounted(() => {
  const platform = props.message.platform;
  const mentions = props.message.text.match(MENTION_REGEX);
  if (mentions) {
    const uniqueUsers = new Set(mentions.map(m => m.slice(1)));
    for (const username of uniqueUsers) {
      void fetchMentionColor(platform, username);
    }
  }
});
</script>

<template>
  <!-- ── COMPACT (single-line) ─────────────────────────────── -->
  <div
    v-if="props.chatTheme === 'compact'"
    class="msg msg-compact"
    :class="`platform-${message.platform}`"
    :style="{ '--font-size': `${props.fontSize ?? 14}px` }"
    @click="onMsgClick"
  >
    <span
      v-if="props.showPlatformColorStripe !== false"
      class="platform-stripe"
      :style="{ background: platformColor(message.platform) }"
    />

    <!-- Platform icon -->
    <span
      v-if="props.showPlatformIcon"
      class="platform-icon"
      :style="{ color: platformColor(message.platform) }"
      :title="message.platform"
      v-html="platformIconSvg(message.platform)"
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
        <span
          v-if="badge.imageUrl && badge.imageUrl.startsWith('<svg')"
          class="badge-svg"
          v-html="badge.imageUrl"
        />
        <img
          v-else-if="badge.imageUrl && !brokenBadges.has(badge.id)"
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
      >{{ message.author.displayName }}</span
    >
    <span class="compact-sep">:</span>
    <span
      class="msg-text"
      :class="{ italic: message.type === 'action' }"
      v-html="renderText(message)"
    />
    <span v-if="props.showTimestamp" class="timestamp compact-time">{{
      formatTime(message.timestamp)
    }}</span>
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
    @click="onMsgClick"
  >
    <!-- Platform colour stripe -->
    <span
      v-if="props.showPlatformColorStripe !== false"
      class="platform-stripe"
      :style="{ background: platformColor(message.platform) }"
      :title="message.platform"
    />

    <!-- Platform icon -->
    <span
      v-if="props.showPlatformIcon"
      class="platform-icon"
      :style="{ color: platformColor(message.platform) }"
      :title="message.platform"
      v-html="platformIconSvg(message.platform)"
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
            <span
              v-if="badge.imageUrl && badge.imageUrl.startsWith('<svg')"
              class="badge-svg"
              v-html="badge.imageUrl"
            />
            <img
              v-else-if="badge.imageUrl && !brokenBadges.has(badge.id)"
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

        <span v-if="props.showTimestamp" class="timestamp">{{
          formatTime(message.timestamp)
        }}</span>
      </div>

      <!-- Message text -->
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

/* Platform icon (inline SVG, coloured) */
.platform-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0.85;
  line-height: 1;
}

.msg-compact .platform-icon {
  margin-right: 1px;
  align-self: center;
}

.msg:not(.msg-compact) .platform-icon {
  margin-top: 6px;
}

.compact-time {
  margin-left: auto;
  flex-shrink: 0;
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

.badge-svg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
}

.badge-svg :deep(svg) {
  width: 100%;
  height: 100%;
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

:deep(.msg-link) {
  color: #a78bfa;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  word-break: break-all;
}

:deep(.msg-link:hover) {
  color: #c4b5fd;
}

.msg-text.italic {
  font-style: italic;
  opacity: 0.85;
}

:deep(.emote) {
  height: 24px;
  width: auto;
  max-width: 72px;
  vertical-align: middle;
  display: inline-block;
  object-fit: contain;
}

:deep(.mention) {
  cursor: pointer;
}

:deep(.mention:hover) {
  text-decoration: underline;
  text-underline-offset: 2px;
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
