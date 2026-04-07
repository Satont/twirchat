<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { rpc } from '../main'
import type { Account, Emote, NormalizedChatMessage } from '@twirchat/shared/types'
import EmoteTooltip from './EmoteTooltip.vue'

const props = defineProps<{
  message: NormalizedChatMessage
  showPlatformColorStripe?: boolean
  showPlatformIcon?: boolean
  showTimestamp?: boolean
  showAvatar?: boolean
  showBadges?: boolean
  fontSize?: number
  chatTheme?: 'modern' | 'compact'
  accounts?: Account[]
  selfPingEnabled?: boolean
  selfPingColor?: string
}>()

const emit = defineEmits<{
  reply: [message: NormalizedChatMessage]
}>()

function onReply() {
  emit('reply', props.message)
}

const isSystemMessage = computed(() => props.message.type === 'system')

const isSelfPing = computed((): boolean => {
  if (!props.selfPingEnabled || !props.accounts?.length) return false
  const myAccount = props.accounts.find((a) => a.platform === props.message.platform)
  if (!myAccount) return false
  const lower = props.message.text.toLowerCase()
  const username = myAccount.username.toLowerCase()
  const displayName = myAccount.displayName.toLowerCase()
  return lower.includes(`@${username}`) || lower.includes(`@${displayName}`)
})

const selfPingStyle = computed(() =>
  isSelfPing.value && props.selfPingColor ? { background: props.selfPingColor } : {},
)

const systemAction = computed<'added' | 'removed' | 'renamed'>(() => {
  const t = props.message.text
  if (t.includes(' added ')) {
    return 'added'
  }
  if (t.includes(' removed ')) {
    return 'removed'
  }
  return 'renamed'
})

// In-memory cache for platform:username -> color (shared across all message instances via module scope)
// Key format: "platform:lowercase_username"
const mentionColorCache = reactive(new Map<string, string | null>())

function makeMentionKey(platform: string, username: string): string {
  return `${platform}:${username.toLowerCase()}`
}

async function fetchMentionColor(platform: string, username: string): Promise<void> {
  const key = makeMentionKey(platform, username)
  if (mentionColorCache.has(key)) {
    return
  }

  try {
    const color = await rpc.request.getUsernameColor({
      platform: platform as import('@twirchat/shared/types').Platform,
      username,
    })
    mentionColorCache.set(key, color)
  } catch (error) {
    console.warn('[ChatMessage] Failed to fetch color for:', platform, username, error)
    mentionColorCache.set(key, null)
  }
}

function platformColor(platform: string): string {
  switch (platform) {
    case 'twitch': {
      return '#9146ff'
    }
    case 'youtube': {
      return '#ff0000'
    }
    case 'kick': {
      return '#53fc18'
    }
    default: {
      return '#888'
    }
  }
}

function platformIconSvg(platform: string): string {
  switch (platform) {
    case 'twitch': {
      // Twitch glitch logo
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
      </svg>`
    }
    case 'youtube': {
      // YouTube play button logo
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>`
    }
    case 'kick': {
      // Kick "K" wordmark simplified
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
        <path d="M3 2h4v8l6-8h5l-7 9 7 11h-5l-6-9v9H3Z"/>
      </svg>`
    }
    default: {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
        <circle cx="12" cy="12" r="10"/>
      </svg>`
    }
  }
}

const URL_REGEX = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g
const MENTION_REGEX = /@([a-zA-Z0-9_]+)/g

interface MessagePart {
  type: 'text' | 'emote'
  content?: string
  emote?: Emote
}

/** Parse message into parts (text and emotes) */
const messageParts = computed((): MessagePart[] => {
  const msg = props.message
  const parts: MessagePart[] = []

  if (!msg.emotes.length) {
    return [{ content: msg.text, type: 'text' }]
  }

  const chars = [...msg.text]
  let i = 0

  const ranges: { start: number; end: number; emote: Emote }[] = []
  for (const emote of msg.emotes) {
    for (const pos of emote.positions) {
      ranges.push({ ...pos, emote })
    }
  }
  ranges.sort((a, b) => a.start - b.start)

  for (const range of ranges) {
    if (i < range.start) {
      parts.push({ content: chars.slice(i, range.start).join(''), type: 'text' })
    }
    parts.push({
      emote: range.emote,
      type: 'emote',
    })
    i = range.end + 1
  }

  if (i < chars.length) {
    parts.push({ content: chars.slice(i).join(''), type: 'text' })
  }

  return parts
})

/** Process text to highlight mentions and linkify URLs */
function processText(text: string): string {
  let result = escapeHtml(text)
  result = linkifyText(result)
  result = highlightMentions(result, props.message.platform)
  return result
}

/** Linkify plain-text segment (already HTML-escaped) */
function linkifyText(escaped: string): string {
  return escaped.replace(URL_REGEX, (url) => {
    const safeUrl = url.replace(/"/g, '&quot;')
    return `<a class="msg-link" href="#" data-href="${safeUrl}" title="${safeUrl}">${url}</a>`
  })
}

/** Highlight @mentions with colors from cache (platform-specific) */
function highlightMentions(escaped: string, platform: string): string {
  return escaped.replace(MENTION_REGEX, (match, username) => {
    const key = makeMentionKey(platform, username)
    const color = mentionColorCache.get(key)
    if (color) {
      return `<span class="mention" style="color: ${color}; font-weight: 600;">${match}</span>`
    }
    // Fetch color for next time (platform-specific)
    void fetchMentionColor(platform, username)
    return match
  })
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const brokenBadges = ref(new Set<string>())

function onBadgeError(id: string): void {
  brokenBadges.value = new Set([...brokenBadges.value, id])
}

function formatTime(ts: Date): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function initials(name: string): string {
  return name.slice(0, 1).toUpperCase()
}

function onMsgClick(e: MouseEvent): void {
  const target = e.target as HTMLElement
  const anchor = target.closest<HTMLAnchorElement>('a.msg-link')
  if (!anchor) {
    return
  }
  e.preventDefault()
  const url = anchor.dataset.href
  if (url) {
    void rpc.request.openExternalUrl({ url })
  }
}

// Copy functionality
const showCopyButton = ref(false)
const copySuccess = ref(false)

function copyMessage(): void {
  navigator.clipboard.writeText(props.message.text).then(() => {
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 1500)
  })
}

// Pre-fetch colors for any @mentions in this message (platform-specific)
onMounted(() => {
  const { platform } = props.message
  const mentions = props.message.text.match(MENTION_REGEX)
  if (mentions) {
    const uniqueUsers = new Set(mentions.map((m) => m.slice(1)))
    for (const username of uniqueUsers) {
      void fetchMentionColor(platform, username)
    }
  }
})
</script>

<template>
  <!-- ── SYSTEM MESSAGE ────────────────────────────────────── -->
  <!-- NOTE: System message check MUST come before compact theme check.
       System message authors have no `badges` field, so the compact
       branch would crash with "badges.length of undefined". -->
  <div
    v-if="isSystemMessage"
    class="msg msg-system"
    :class="[`platform-${message.platform}`, `action-${systemAction}`]"
    :style="{ '--font-size': `${props.fontSize ?? 14}px` }"
  >
    <!-- Action icon: +/−/~ colored pill -->
    <div class="system-action-icon" :class="`action-icon-${systemAction}`">
      {{ systemAction === 'added' ? '+' : systemAction === 'removed' ? '−' : '~' }}
    </div>

    <span class="msg-text system-text">
      <template v-for="(part, index) in messageParts" :key="index">
        <EmoteTooltip v-if="part.type === 'emote' && part.emote" :emote="part.emote">
          <img
            class="emote system-emote"
            :src="part.emote.imageUrl"
            :alt="part.emote.name"
            :title="part.emote.name"
          />
        </EmoteTooltip>
        <span v-else-if="part.type === 'text' && part.content" v-html="processText(part.content)" />
      </template>
    </span>

    <span v-if="props.showTimestamp" class="timestamp system-timestamp">{{
      formatTime(message.timestamp)
    }}</span>
  </div>

  <!-- ── COMPACT (single-line) ─────────────────────────────── -->
  <div
    v-else-if="props.chatTheme === 'compact'"
    class="msg msg-compact"
    :class="[`platform-${message.platform}`, { 'self-ping': isSelfPing }]"
    :style="{ '--font-size': `${props.fontSize ?? 14}px`, ...selfPingStyle }"
    @click="onMsgClick"
    @mouseenter="showCopyButton = true"
    @mouseleave="showCopyButton = false"
  >
    <span
      v-if="props.showPlatformColorStripe !== false"
      class="platform-stripe"
      :style="{ background: platformColor(message.platform) }"
    />

    <!-- Reply Preview -->
    <div v-if="message.reply" class="reply-preview compact-reply">
      <span class="reply-icon">↩</span>
      <span class="reply-author">{{ message.reply.parentAuthor.displayName }}</span
      >:
      <span class="reply-text">{{
        message.reply.parentMessageText.length > 80
          ? message.reply.parentMessageText.slice(0, 80) + '…'
          : message.reply.parentMessageText
      }}</span>
    </div>

    <!-- Platform icon -->
    <span
      v-if="props.showPlatformIcon"
      class="platform-icon"
      :style="{ color: platformColor(message.platform) }"
      :title="message.platform"
      v-html="platformIconSvg(message.platform)"
    />

    <!-- Badges inline -->
    <span v-if="props.showBadges !== false && message.author.badges.length" class="badges">
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

    <span class="author" :style="message.author.color ? { color: message.author.color } : {}">{{
      message.author.displayName
    }}</span
    ><span class="compact-sep">:</span
    ><span class="msg-text" :class="{ italic: message.type === 'action' }">
      <template v-for="(part, index) in messageParts" :key="index">
        <EmoteTooltip v-if="part.type === 'emote' && part.emote" :emote="part.emote">
          <img
            class="emote"
            :src="part.emote.imageUrl"
            :alt="part.emote.name"
            :title="part.emote.name"
          />
        </EmoteTooltip>
        <img
          v-else-if="part.type === 'emote' && part.emote"
          class="emote"
          :src="part.emote.imageUrl"
          :alt="part.emote.name"
          :title="part.emote.name"
        />
        <span v-else-if="part.type === 'text' && part.content" v-html="processText(part.content)" />
      </template>
    </span>
    <span v-if="props.showTimestamp" class="timestamp compact-time">{{
      formatTime(message.timestamp)
    }}</span>

    <!-- Reply button -->
    <button v-if="showCopyButton" class="reply-btn" @click.stop="onReply" title="Reply to message">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="9 17 4 12 9 7"></polyline>
        <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
      </svg>
    </button>

    <!-- Copy button -->
    <button
      v-if="showCopyButton"
      class="copy-btn"
      :class="{ success: copySuccess }"
      @click.stop="copyMessage"
      title="Copy message"
    >
      <svg
        v-if="!copySuccess"
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <svg
        v-else
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </button>
  </div>

  <div
    v-else
    class="msg"
    :class="[
      `platform-${message.platform}`,
      message.type === 'action' ? 'is-action' : '',
      { 'self-ping': isSelfPing },
    ]"
    :style="{ '--font-size': `${props.fontSize ?? 14}px`, ...selfPingStyle }"
    @click="onMsgClick"
    @mouseenter="showCopyButton = true"
    @mouseleave="showCopyButton = false"
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
      <!-- Reply Preview -->
      <div v-if="message.reply" class="reply-preview">
        <span class="reply-icon">↩</span>
        <span class="reply-author">{{ message.reply.parentAuthor.displayName }}</span
        >:
        <span class="reply-text">{{
          message.reply.parentMessageText.length > 80
            ? message.reply.parentMessageText.slice(0, 80) + '…'
            : message.reply.parentMessageText
        }}</span>
      </div>

      <div class="msg-meta">
        <!-- Badges -->
        <span v-if="props.showBadges !== false && message.author.badges.length" class="badges">
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
        <span class="author" :style="message.author.color ? { color: message.author.color } : {}">{{
          message.author.displayName
        }}</span>

        <span v-if="props.showTimestamp" class="timestamp">{{
          formatTime(message.timestamp)
        }}</span>
      </div>

      <!-- Message text -->
      <span class="msg-text" :class="{ italic: message.type === 'action' }">
        <template v-for="(part, index) in messageParts" :key="index">
          <EmoteTooltip v-if="part.type === 'emote' && part.emote" :emote="part.emote">
            <img
              class="emote"
              :src="part.emote.imageUrl"
              :alt="part.emote.name"
              :title="part.emote.name"
            />
          </EmoteTooltip>
          <span
            v-else-if="part.type === 'text' && part.content"
            v-html="processText(part.content)"
          />
        </template>
      </span>
    </div>

    <!-- Reply button -->
    <button v-if="showCopyButton" class="reply-btn" @click.stop="onReply" title="Reply to message">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="9 17 4 12 9 7"></polyline>
        <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
      </svg>
    </button>

    <!-- Copy button -->
    <button
      v-if="showCopyButton"
      class="copy-btn"
      :class="{ success: copySuccess }"
      @click.stop="copyMessage"
      title="Copy message"
    >
      <svg
        v-if="!copySuccess"
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <svg
        v-else
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 14px;
  padding-right: 64px;
  font-size: var(--font-size, 14px);
  line-height: 1.45;
  word-break: break-word;
  transition: background 0.1s;
  position: relative;
}

.msg:hover {
  background: rgba(255, 255, 255, 0.025);
}

.msg.self-ping:hover {
  filter: brightness(1.08);
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
  display: inline-block;
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

.emote {
  height: 24px;
  width: auto;
  max-width: 72px;
  vertical-align: middle;
  display: inline-block;
  object-fit: contain;
  cursor: pointer;
}

:deep(.mention) {
  cursor: pointer;
}

:deep(.mention:hover) {
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* Reply Preview */
.reply-preview {
  font-size: 0.8em;
  color: var(--c-text-2, #8b8b99);
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  white-space: nowrap;
}

.reply-author {
  color: var(--c-text, #e2e2e8);
  font-weight: 600;
}

.reply-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 80ch;
}

.reply-icon {
  opacity: 0.7;
  font-size: 1.1em;
}

/* Reply button */
.reply-btn {
  position: absolute;
  right: 34px;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
  color: var(--c-text-2, #8b8b99);
  opacity: 0;
  transition:
    opacity 0.15s,
    background 0.15s,
    color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.msg:hover .reply-btn,
.msg-compact:hover .reply-btn {
  opacity: 1;
}

.reply-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: var(--c-text, #e2e2e8);
}

/* Copy button */
.copy-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
  color: var(--c-text-2, #8b8b99);
  opacity: 0;
  transition:
    opacity 0.15s,
    background 0.15s,
    color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.msg:hover .copy-btn {
  opacity: 1;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: var(--c-text, #e2e2e8);
}

.copy-btn.success {
  background: rgba(74, 222, 128, 0.2);
  color: #4ade80;
  opacity: 1;
}

/* ── Compact (single-line) ──────────────────────────────── */
.msg-compact {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 14px;
  padding-right: 64px;
  font-size: var(--font-size, 14px);
  line-height: 1.5;
  word-break: break-word;
  flex-wrap: wrap;
  position: relative;
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
  margin-left: 4px;
}
.msg-compact .badges {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  align-self: center;
  line-height: 1;
}

.compact-reply {
  order: -1;
  width: 100%;
}

.msg-compact .copy-btn {
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 0;
}

.msg-compact .reply-btn {
  right: 34px;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 0;
}

/* ── System Messages ────────────────────────────────────── */
.msg-system {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 14px;
  font-size: var(--font-size, 14px);
  line-height: 1.45;
  border-left: 2px solid transparent;
  position: relative;
}

/* Action-based colour theming */
.msg-system.action-added {
  background: rgba(83, 252, 24, 0.04);
  border-left-color: #53fc18;
}
.msg-system.action-added:hover {
  background: rgba(83, 252, 24, 0.07);
}

.msg-system.action-removed {
  background: rgba(255, 80, 80, 0.05);
  border-left-color: #ff5050;
}
.msg-system.action-removed:hover {
  background: rgba(255, 80, 80, 0.09);
}

.msg-system.action-renamed {
  background: rgba(100, 65, 165, 0.06);
  border-left-color: #6441a5;
}
.msg-system.action-renamed:hover {
  background: rgba(100, 65, 165, 0.1);
}

/* Action icon: small coloured circle with +/−/~ */
.system-action-icon {
  width: 17px;
  height: 17px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  flex-shrink: 0;
  line-height: 1;
  user-select: none;
}
.action-icon-added {
  background: rgba(83, 252, 24, 0.15);
  color: #53fc18;
}
.action-icon-removed {
  background: rgba(255, 80, 80, 0.18);
  color: #ff6060;
}
.action-icon-renamed {
  background: rgba(167, 139, 250, 0.18);
  color: #a78bfa;
}

.system-text {
  color: var(--c-text-2, #8b8b99);
  font-size: 0.88em;
  flex: 1;
  min-width: 0;
}

.system-emote {
  height: 20px;
  vertical-align: middle;
}

.system-timestamp {
  font-size: 10px;
  color: var(--c-text-2, #8b8b99);
  flex-shrink: 0;
  margin-left: auto;
  opacity: 0.7;
}
</style>
