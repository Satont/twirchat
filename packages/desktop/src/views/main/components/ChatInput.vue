<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import type { PlatformStatusInfo } from "@twirchat/shared/types";

const props = defineProps<{
  statuses: Map<string, PlatformStatusInfo>;
}>();

const emit = defineEmits<{
  send: [payload: Array<{ platform: string; channelLogin: string; text: string }>];
}>();

const text = ref("");
const textareaEl = ref<HTMLTextAreaElement | null>(null);

function resizeTextarea() {
  const el = textareaEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

watch(text, () => nextTick(resizeTextarea));

// All connected platforms (including anon) — shown as chips
const connectedPlatforms = computed(() => {
  const result: PlatformStatusInfo[] = [];
  for (const info of props.statuses.values()) {
    if (
      (info.status === "connected" || info.status === "connecting") &&
      info.channelLogin
    ) {
      result.push(info);
    }
  }
  return result;
});

// Subset that can actually send (authenticated only)
const sendablePlatforms = computed(() =>
  connectedPlatforms.value.filter((p) => p.mode === "authenticated"),
);

const hasAnything = computed(() => connectedPlatforms.value.length > 0);
const isDisabled = computed(() => sendablePlatforms.value.length === 0);

// Per-platform enabled toggle
const enabled = ref<Record<string, boolean>>({});

function isEnabled(platform: string): boolean {
  // anon platforms are never enabled for sending
  const info = connectedPlatforms.value.find((p) => p.platform === platform);
  if (!info || info.mode !== "authenticated") return false;
  return enabled.value[platform] !== false;
}

function toggle(platform: string) {
  const info = connectedPlatforms.value.find((p) => p.platform === platform);
  if (!info || info.mode !== "authenticated") return;
  enabled.value = { ...enabled.value, [platform]: !isEnabled(platform) };
}

const canSend = computed(() =>
  text.value.trim().length > 0 &&
  sendablePlatforms.value.some((p) => isEnabled(p.platform)),
);

function send() {
  const trimmed = text.value.trim();
  if (!trimmed) return;
  const targets = sendablePlatforms.value
    .filter((p) => isEnabled(p.platform))
    .map((p) => ({ platform: p.platform, channelLogin: p.channelLogin!, text: trimmed }));
  if (targets.length === 0) return;
  emit("send", targets);
  text.value = "";
  nextTick(() => {
    if (textareaEl.value) textareaEl.value.style.height = "auto";
  });
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

function platformColor(platform: string): string {
  switch (platform) {
    case "twitch": return "#9146ff";
    case "kick":   return "#53fc18";
    case "youtube": return "#ff0000";
    default:       return "#a78bfa";
  }
}

function placeholderText(): string {
  if (!hasAnything.value) return "Connect a channel to send messages…";
  if (isDisabled.value) return "Log in to send messages…";
  return "Send a message… (Enter ↵ to send, Shift+Enter for newline)";
}
</script>

<template>
  <div class="chat-input-bar">
    <!-- Platform chips — always show connected ones, anon ones are non-clickable -->
    <div v-if="connectedPlatforms.length > 0" class="input-targets">
      <button
        v-for="p in connectedPlatforms"
        :key="p.platform"
        class="target-btn"
        :class="{
          active: isEnabled(p.platform),
          anon: p.mode !== 'authenticated',
        }"
        :style="{ '--p-color': platformColor(p.platform) }"
        :title="p.mode !== 'authenticated'
          ? `${p.platform} — anonymous (log in to send)`
          : isEnabled(p.platform) ? `Disable ${p.platform}` : `Enable ${p.platform}`"
        @click="toggle(p.platform)"
      >
        <!-- Twitch icon -->
        <svg v-if="p.platform === 'twitch'" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
        </svg>
        <!-- Kick icon -->
        <svg v-else-if="p.platform === 'kick'" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 2h4v7.5l5-7.5h5l-6 9 6 11h-5l-5-8V22H3z"/>
        </svg>
        <!-- YouTube icon -->
        <svg v-else-if="p.platform === 'youtube'" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
        </svg>
        <span v-else class="target-letter">{{ p.platform[0].toUpperCase() }}</span>

        <span class="target-name">{{ p.channelLogin }}</span>

        <!-- Lock icon for anon -->
        <svg v-if="p.mode !== 'authenticated'" class="anon-lock" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </button>
    </div>

    <!-- Textarea + send -->
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
      <button
        class="send-btn"
        :disabled="!canSend"
        @click="send"
        title="Send"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-input-bar {
  flex-shrink: 0;
  border-top: 1px solid var(--c-border, #2a2a33);
  padding: 8px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  background: var(--c-surface, #18181b);
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
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.04);
  color: var(--c-text-2, #8b8b99);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
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
  transition: background 0.15s, opacity 0.15s;
}
.send-btn:hover:not(:disabled) {
  background: #6d28d9;
}
.send-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
