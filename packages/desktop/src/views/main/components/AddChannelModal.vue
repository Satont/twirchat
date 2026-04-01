<script setup lang="ts">
import { ref } from "vue";

const emit = defineEmits<{
  confirm: [platform: "twitch" | "kick", channelSlug: string];
  cancel: [];
}>();

const platform = ref<"twitch" | "kick">("twitch");
const channelSlug = ref("");
const inputEl = ref<HTMLInputElement | null>(null);

function onConfirm() {
  const slug = channelSlug.value.trim().toLowerCase();
  if (!slug) return;
  emit("confirm", platform.value, slug);
  channelSlug.value = "";
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") onConfirm();
  if (e.key === "Escape") emit("cancel");
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('cancel')">
      <div class="modal" @keydown="onKeydown">
        <div class="modal-header">
          <span class="modal-title">Add Channel</span>
          <button class="modal-close" @click="emit('cancel')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- Platform selector -->
        <div class="platform-row">
          <button
            class="platform-btn"
            :class="{ active: platform === 'twitch' }"
            style="--p-color: #9146ff"
            @click="platform = 'twitch'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
            </svg>
            Twitch
          </button>
          <button
            class="platform-btn"
            :class="{ active: platform === 'kick' }"
            style="--p-color: #53fc18"
            @click="platform = 'kick'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 2h4v7.5l5-7.5h5l-6 9 6 11h-5l-5-8V22H3z"/>
            </svg>
            Kick
          </button>
        </div>

        <!-- Channel input -->
        <div class="input-row">
          <input
            ref="inputEl"
            v-model="channelSlug"
            class="channel-input"
            :placeholder="`${platform === 'twitch' ? 'Twitch' : 'Kick'} channel name`"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          />
        </div>

        <!-- Actions -->
        <div class="modal-actions">
          <button class="btn-cancel" @click="emit('cancel')">Cancel</button>
          <button
            class="btn-confirm"
            :disabled="!channelSlug.trim()"
            @click="onConfirm"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
  backdrop-filter: blur(2px);
}

.modal {
  background: var(--c-surface, #18181b);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 14px;
  padding: 20px;
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.5);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--c-text, #e2e2e8);
}

.modal-close {
  background: none;
  border: none;
  color: var(--c-text-2, #8b8b99);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: color 0.15s;
}
.modal-close:hover {
  color: var(--c-text, #e2e2e8);
}

.platform-row {
  display: flex;
  gap: 8px;
}

.platform-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.04);
  color: var(--c-text-2, #8b8b99);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.platform-btn.active {
  background: color-mix(in srgb, var(--p-color) 15%, transparent);
  border-color: color-mix(in srgb, var(--p-color) 45%, transparent);
  color: var(--p-color);
}
.platform-btn:not(.active):hover {
  background: rgba(255,255,255,0.07);
  color: var(--c-text, #e2e2e8);
}

.input-row {
  display: flex;
}

.channel-input {
  flex: 1;
  background: var(--c-surface-2, #1f1f24);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 8px;
  color: var(--c-text, #e2e2e8);
  font-family: inherit;
  font-size: 13px;
  padding: 8px 12px;
  outline: none;
  transition: border-color 0.15s;
}
.channel-input:focus {
  border-color: rgba(167, 139, 250, 0.5);
}
.channel-input::placeholder {
  color: var(--c-text-2, #8b8b99);
  opacity: 0.6;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-cancel {
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.1);
  background: none;
  color: var(--c-text-2, #8b8b99);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.btn-cancel:hover {
  background: rgba(255,255,255,0.06);
  color: var(--c-text, #e2e2e8);
}

.btn-confirm {
  padding: 7px 16px;
  border-radius: 8px;
  border: none;
  background: #7c3aed;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}
.btn-confirm:hover:not(:disabled) {
  background: #6d28d9;
}
.btn-confirm:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
