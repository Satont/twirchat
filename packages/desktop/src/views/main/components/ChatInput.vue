<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type {
  NormalizedChatMessage,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
import { platformColor } from '../../shared/utils/platform'
import TwitchIcon from '../../../assets/icons/platforms/twitch.svg'
import YoutubeIcon from '../../../assets/icons/platforms/youtube.svg'
import KickIcon from '../../../assets/icons/platforms/kick.svg'
import { parseToken, replaceToken, useAutocomplete } from '../composables/useAutocomplete'
import AutocompletePopup from './AutocompletePopup.vue'
import { PopoverContent, PopoverRoot, PopoverTrigger } from 'reka-ui'
import EmotePicker from './EmotePicker.vue'

const props = defineProps<{
  statuses: Map<string, PlatformStatusInfo>
  /** When set, input is scoped to this watched channel */
  watchedChannel?: WatchedChannel | null
  /** Connection status for the watched channel */
  watchedChannelStatus?: PlatformStatusInfo | null
  replyTarget?: NormalizedChatMessage | null
  messages?: NormalizedChatMessage[]
}>()

const emit = defineEmits<{
  send: [
    payload: { platform: string; channelLogin: string; text: string; replyToMessageId?: string }[],
  ]
  'send-watched': [payload: { text: string; channelId: string; replyToMessageId?: string }]
  'cancel-reply': []
}>()

const text = ref('')
const textareaEl = ref<HTMLTextAreaElement | null>(null)

const showEmotePicker = ref(false)
const emotePickerRef = ref<InstanceType<typeof EmotePicker> | null>(null)

const { suggestions, isOpen, selectedIndex, mode, selectSuggestion, moveUp, moveDown, close } =
  useAutocomplete({
    text,
    messages: computed(() => props.messages ?? []),
    watchedChannel: computed(() => props.watchedChannel ?? null),
    statuses: computed(() => props.statuses),
  })

const currentChannelInfo = computed((): { platform: string; channelId: string } | null => {
  if (props.watchedChannel) {
    return { platform: props.watchedChannel.platform, channelId: props.watchedChannel.channelSlug }
  }
  for (const info of props.statuses.values()) {
    if (info.channelLogin && info.status === 'connected') {
      return { platform: info.platform, channelId: info.channelLogin }
    }
  }
  return null
})

watch(showEmotePicker, async (isPickerOpen) => {
  if (isPickerOpen) {
    await nextTick()
    emotePickerRef.value?.focus()
  }
})

function onEmoteSelect(alias: string): void {
  // Branch 1: active :token at end of text → use replaceToken
  const token = parseToken(text.value)
  if (token.mode === 'emote') {
    text.value = replaceToken(text.value, {
      type: 'emote',
      label: alias,
      imageUrl: '',
      animated: false,
    })
  } else {
    // Branch 2: no active :token → insert at cursor position (or append)
    const el = textareaEl.value
    const pos = el?.selectionStart ?? text.value.length
    const insertion = alias + ' '
    text.value = text.value.slice(0, pos) + insertion + text.value.slice(pos)
    // Restore cursor after insertion
    void nextTick(() => {
      if (el) {
        const newPos = pos + insertion.length
        el.focus()
        el.setSelectionRange(newPos, newPos)
      }
    })
  }
  // Close picker after selection
  showEmotePicker.value = false
  // Refocus textarea
  void nextTick(() => textareaEl.value?.focus())
}

function resizeTextarea() {
  const el = textareaEl.value
  if (!el) {
    return
  }
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

watch(text, () => nextTick(resizeTextarea))

// ---- Normal (home tab) mode ----

const connectedPlatforms = computed(() => {
  if (props.watchedChannel) {
    return []
  }
  const result: PlatformStatusInfo[] = []
  for (const info of props.statuses.values()) {
    if ((info.status === 'connected' || info.status === 'connecting') && info.channelLogin) {
      result.push(info)
    }
  }
  return result
})

const sendablePlatforms = computed(() =>
  connectedPlatforms.value.filter((p) => p.mode === 'authenticated'),
)

const hasAnything = computed(() => {
  if (props.watchedChannel) {
    return true
  }
  return connectedPlatforms.value.length > 0
})

const isDisabled = computed(() => {
  if (props.watchedChannel) {
    // Can send if authenticated, or even anon for watched we allow read-only still
    return props.watchedChannelStatus?.mode !== 'authenticated'
  }
  return sendablePlatforms.value.length === 0
})

const enabled = ref<Record<string, boolean>>({})

function isEnabled(platform: string): boolean {
  const info = connectedPlatforms.value.find((p) => p.platform === platform)
  if (!info || info.mode !== 'authenticated') {
    return false
  }
  return enabled.value[platform] !== false
}

function toggle(platform: string) {
  const info = connectedPlatforms.value.find((p) => p.platform === platform)
  if (!info || info.mode !== 'authenticated') {
    return
  }
  enabled.value = { ...enabled.value, [platform]: !isEnabled(platform) }
}

const canSend = computed(() => {
  if (!text.value.trim()) {
    return false
  }
  if (props.watchedChannel) {
    return !isDisabled.value
  }
  return sendablePlatforms.value.some((p) => isEnabled(p.platform))
})

function send() {
  const trimmed = text.value.trim()
  if (!trimmed) {
    return
  }

  if (props.watchedChannel) {
    emit('send-watched', {
      text: trimmed,
      channelId: props.watchedChannel.id,
      replyToMessageId: props.replyTarget?.id,
    })
  } else {
    const targets = sendablePlatforms.value
      .filter((p) => isEnabled(p.platform))
      .map((p) => ({
        channelLogin: p.channelLogin!,
        platform: p.platform,
        text: trimmed,
        replyToMessageId: props.replyTarget?.id,
      }))
    if (targets.length === 0) {
      return
    }
    emit('send', targets)
  }

  text.value = ''
  nextTick(() => {
    if (textareaEl.value) {
      textareaEl.value.style.height = 'auto'
    }
  })
}

function onKeydown(e: KeyboardEvent) {
  if (isOpen.value) {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveUp()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveDown()
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      selectSuggestion(selectedIndex.value)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function placeholderText(): string {
  if (props.watchedChannel) {
    if (props.watchedChannelStatus?.mode !== 'authenticated') {
      return 'Log in to send messages…'
    }
    return `Message ${props.watchedChannel.displayName}…`
  }
  if (!hasAnything.value) {
    return 'Connect a channel to send messages…'
  }
  if (isDisabled.value) {
    return 'Log in to send messages…'
  }
  return 'Send a message… (Enter ↵ to send, Shift+Enter for newline)'
}
</script>

<template>
  <div class="chat-input-bar">
    <div v-if="replyTarget" class="reply-bar">
      <span class="reply-bar-icon">↩</span>
      <span class="reply-bar-body">
        Replying to <strong>{{ replyTarget.author.displayName }}</strong
        >:
        {{ replyTarget.text.length > 80 ? replyTarget.text.slice(0, 80) + '…' : replyTarget.text }}
      </span>
      <button class="reply-bar-dismiss" title="Cancel reply" @click="emit('cancel-reply')">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <!-- Watched channel: single fixed chip -->
    <div v-if="watchedChannel" class="input-targets">
      <div
        class="target-btn"
        :class="{
          active: watchedChannelStatus?.mode === 'authenticated',
          anon: watchedChannelStatus?.mode !== 'authenticated',
        }"
        :style="{ '--p-color': platformColor(watchedChannel.platform) }"
      >
        <component
          :is="
            watchedChannel.platform === 'twitch'
              ? TwitchIcon
              : watchedChannel.platform === 'kick'
                ? KickIcon
                : YoutubeIcon
          "
          width="13"
          height="13"
          fill="currentColor"
        />
        <span class="target-name">{{ watchedChannel.displayName }}</span>
        <svg
          v-if="watchedChannelStatus?.mode !== 'authenticated'"
          class="anon-lock"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
    </div>

    <!-- Home tab: per-platform chips -->
    <div v-else-if="connectedPlatforms.length > 0" class="input-targets">
      <button
        v-for="p in connectedPlatforms"
        :key="p.platform"
        class="target-btn"
        :class="{
          active: isEnabled(p.platform),
          anon: p.mode !== 'authenticated',
        }"
        :style="{ '--p-color': platformColor(p.platform) }"
        :title="
          p.mode !== 'authenticated'
            ? `${p.platform} — anonymous (log in to send)`
            : isEnabled(p.platform)
              ? `Disable ${p.platform}`
              : `Enable ${p.platform}`
        "
        @click="toggle(p.platform)"
      >
        <component
          v-if="p.platform === 'twitch' || p.platform === 'kick' || p.platform === 'youtube'"
          :is="
            p.platform === 'twitch' ? TwitchIcon : p.platform === 'kick' ? KickIcon : YoutubeIcon
          "
          width="13"
          height="13"
          fill="currentColor"
        />
        <span v-else class="target-letter">{{
          (p.platform as string).charAt(0).toUpperCase()
        }}</span>

        <span class="target-name">{{ p.channelLogin }}</span>

        <svg
          v-if="p.mode !== 'authenticated'"
          class="anon-lock"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </button>
    </div>

    <!-- Textarea + send -->
    <AutocompletePopup
      v-if="isOpen"
      :suggestions="suggestions"
      :selected-index="selectedIndex"
      :mode="mode"
      @select="selectSuggestion"
    />
    <div class="input-row">
      <textarea
        ref="textareaEl"
        v-model="text"
        class="chat-textarea"
        :placeholder="placeholderText()"
        :disabled="isDisabled"
        rows="1"
        @keydown="onKeydown"
      />
      <PopoverRoot v-model:open="showEmotePicker">
        <PopoverTrigger as-child>
          <button
            class="emote-btn"
            :class="{ 'is-open': showEmotePicker }"
            title="Emotes"
            :disabled="isDisabled"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M8 13s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          :side-offset="8"
          align="end"
          :avoid-collisions="true"
          class="emote-picker-popover"
        >
          <EmotePicker
            v-if="currentChannelInfo"
            ref="emotePickerRef"
            :platform="currentChannelInfo.platform"
            :channel-id="currentChannelInfo.channelId"
            @select="onEmoteSelect"
          />
        </PopoverContent>
      </PopoverRoot>
      <button class="send-btn" :disabled="!canSend" @click="send" title="Send">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-input-bar {
  position: relative;
  flex-shrink: 0;
  border-top: 1px solid var(--c-border, #2a2a33);
  padding: 8px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  background: var(--c-surface, #18181b);
}

.reply-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 5px 10px;
  border-left: 2px solid rgba(167, 139, 250, 0.5);
  font-size: 12px;
  color: var(--c-text-2, #8b8b99);
}

.reply-bar-icon {
  flex-shrink: 0;
  opacity: 0.7;
}

.reply-bar-body {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reply-bar-body strong {
  color: var(--c-text, #e2e2e8);
}

.reply-bar-dismiss {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--c-text-2, #8b8b99);
  padding: 0;
  border-radius: 4px;
}

.reply-bar-dismiss:hover {
  color: var(--c-text, #e2e2e8);
  background: rgba(255, 255, 255, 0.1);
}

/* ---- platform toggles ---- */
.input-targets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.target-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px 3px 7px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: var(--c-text-2, #8b8b99);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s,
    opacity 0.15s;
  user-select: none;
}
.target-btn.active {
  background: color-mix(in srgb, var(--p-color) 15%, transparent);
  border-color: color-mix(in srgb, var(--p-color) 45%, transparent);
  color: var(--p-color);
}
.target-btn:not(.active):not(.anon) {
  opacity: 0.4;
}
.target-btn.anon {
  opacity: 0.35;
  cursor: default;
}
.target-btn:not(.anon):hover {
  opacity: 1;
  background: color-mix(in srgb, var(--p-color) 20%, transparent);
  border-color: color-mix(in srgb, var(--p-color) 55%, transparent);
  color: var(--p-color);
}

.target-letter {
  font-size: 11px;
  font-weight: 700;
}
.target-name {
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.anon-lock {
  opacity: 0.5;
  flex-shrink: 0;
}

/* ---- input row ---- */
.input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.chat-textarea {
  flex: 1;
  resize: none;
  background: var(--c-surface-2, #1f1f24);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 10px;
  color: var(--c-text, #e2e2e8);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  padding: 8px 12px;
  max-height: 120px;
  overflow-y: auto;
  outline: none;
  transition: border-color 0.15s;
  scrollbar-width: thin;
}
.chat-textarea:focus {
  border-color: rgba(167, 139, 250, 0.5);
}
.chat-textarea::placeholder {
  color: var(--c-text-2, #8b8b99);
  opacity: 0.6;
}
.chat-textarea:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: none;
  background: #7c3aed;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 0.15s,
    opacity 0.15s;
}
.send-btn:hover:not(:disabled) {
  background: #6d28d9;
}
.send-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.emote-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--c-text-2, #8b8b99);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}
.emote-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--c-text, #e2e2e8);
}
.emote-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.emote-btn.is-open {
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
}
</style>

<style>
/* Global styles — PopoverContent is portalled outside the component tree */
.emote-picker-popover {
  background: var(--c-surface-2, #1f1f24);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 12px;
  padding: 0;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  z-index: 200;
  overflow: hidden;
}
</style>
