<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AppSettings, HotkeySettings } from '@twirchat/shared/types'
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'
import { rpc } from '../main'
import { pause, resume, startKeyRecording, stopKeyRecording } from '../composables/useHotkeys'

const props = defineProps<{
  settings: AppSettings | null
}>()

const emit = defineEmits<{
  saved: [settings: AppSettings]
  change: [settings: AppSettings]
}>()

function makeLocal(s: AppSettings): AppSettings {
  return {
    ...s,
    overlay: { ...s.overlay },
    selfPing: { ...(s.selfPing ?? DEFAULT_SETTINGS.selfPing!) },
    hotkeys: { ...(s.hotkeys ?? DEFAULT_SETTINGS.hotkeys) },
  }
}

const local = ref<AppSettings>(makeLocal(props.settings ?? DEFAULT_SETTINGS))

// Flag to avoid feedback loop: when local changes → App updates settings prop → we'd reset local again
let ignorePropSync = false

watch(
  () => props.settings,
  (s) => {
    if (ignorePropSync) {
      return
    }
    if (s) {
      local.value = makeLocal(s)
    }
  },
)

// Emit every local change so App can apply settings live (before Save)
watch(
  local,
  (s) => {
    ignorePropSync = true
    emit('change', makeLocal(s))
    // Reset flag on next tick after Vue has propagated the prop update
    Promise.resolve().then(() => {
      ignorePropSync = false
    })
  },
  { deep: true },
)

const saving = ref(false)
const saved = ref(false)

async function save() {
  saving.value = true
  try {
    await rpc.request.saveSettings!(local.value)
    emit('saved', makeLocal(local.value))
    saved.value = true
    setTimeout(() => {
      saved.value = false
    }, 2000)
  } finally {
    saving.value = false
  }
}

const overlayUrl = computed(() => {
  const p = local.value.overlay
  const params = new URLSearchParams({
    animation: p.animation,
    bg: p.background,
    color: p.textColor,
    fontSize: String(p.fontSize),
    maxMessages: String(p.maxMessages),
    position: p.position,
  })
  return `http://localhost:${p.port}/?${params}`
})

function copyOverlayUrl() {
  navigator.clipboard.writeText(overlayUrl.value)
}

// -- Keyboard shortcuts recording --
const recordingAction = ref<keyof HotkeySettings | null>(null)

function formatKeyCombo(combo: string): string {
  return combo
    .split('+')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('+')
}

const hotkeysConfig: Record<keyof HotkeySettings, { label: string; description: string }> = {
  newTab: { label: 'Open new tab', description: 'Add a watched channel tab' },
  nextTab: { label: 'Next tab', description: 'Cycle to the next tab' },
  prevTab: { label: 'Previous tab', description: 'Cycle to the previous tab' },
  tabSelector: {
    label: 'Tab selector',
    description: 'Open fuzzy tab search (Ctrl+K always works)',
  },
}

function startRecording(action: keyof HotkeySettings): void {
  recordingAction.value = action
  pause()
  startKeyRecording((combo) => {
    if (combo !== null) {
      local.value.hotkeys[action] = combo
    }
    stopRecording()
  })
}

function stopRecording(): void {
  recordingAction.value = null
  resume()
  stopKeyRecording()
}
</script>

<template>
  <div class="settings-panel">
    <div class="settings-content">
      <!-- Header -->
      <div class="section-header top">
        <div>
          <h2 class="page-title">Settings</h2>
          <p class="page-sub">Customize appearance and overlay options</p>
        </div>
        <button class="btn btn-save" :disabled="saving" @click="save">
          <svg
            v-if="saved"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {{ saved ? 'Saved!' : saving ? 'Saving…' : 'Save changes' }}
        </button>
      </div>

      <!-- Appearance -->
      <section class="settings-section">
        <h3 class="section-title">Appearance</h3>

        <div class="form-row">
          <div class="form-label">
            <span>Theme</span>
          </div>
          <div class="toggle-group">
            <button
              class="toggle-btn"
              :class="{ active: local.theme === 'dark' }"
              @click="local.theme = 'dark'"
            >
              Dark
            </button>
            <button
              class="toggle-btn"
              :class="{ active: local.theme === 'light' }"
              @click="local.theme = 'light'"
            >
              Light
            </button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span>Font</span>
          </div>
          <div class="toggle-group">
            <button
              class="toggle-btn"
              :class="{ active: local.fontFamily === 'inter' }"
              @click="local.fontFamily = 'inter'"
            >
              Inter
            </button>
            <button
              class="toggle-btn"
              :class="{ active: local.fontFamily === 'manrope' }"
              @click="local.fontFamily = 'manrope'"
            >
              Manrope
            </button>
            <button
              class="toggle-btn"
              :class="{ active: local.fontFamily === 'system' }"
              @click="local.fontFamily = 'system'"
            >
              System
            </button>
          </div>
        </div>
      </section>

      <!-- Self-Ping Highlight -->
      <section class="settings-section">
        <h3 class="section-title">Self-Ping Highlight</h3>
        <p class="section-desc">Highlight messages that mention your own nickname</p>

        <div class="form-row">
          <div class="form-label">
            <span>Enable highlights</span>
            <span class="form-hint">Highlight messages mentioning you</span>
          </div>
          <label class="switch">
            <input v-model="local.selfPing!.enabled" type="checkbox" />
            <span class="switch-thumb" />
          </label>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span>Highlight color</span>
          </div>
          <div class="color-row">
            <input
              v-model="local.selfPing!.color"
              class="input-sm"
              placeholder="rgba(167, 139, 250, 0.15)"
            />
            <input v-model="local.selfPing!.color" type="color" class="color-swatch" />
          </div>
        </div>

        <div class="form-row form-row-preview">
          <div class="form-label">
            <span>Preview</span>
            <span class="form-hint">How a pinged message looks</span>
          </div>
          <div
            class="ping-preview"
            :style="local.selfPing!.enabled ? { background: local.selfPing!.color } : {}"
          >
            <span class="ping-preview-author">StreamerName:</span>
            <span class="ping-preview-text">
              Hey <span class="ping-preview-mention">@YourName</span> what do you think?
            </span>
          </div>
        </div>
      </section>

      <!-- Updates -->
      <section class="settings-section">
        <h3 class="section-title">Updates</h3>
        <p class="section-desc">Automatic update settings</p>

        <div class="form-row">
          <div class="form-label">
            <span>Auto-check for updates</span>
            <span class="form-hint">Check on app startup</span>
          </div>
          <label class="switch">
            <input v-model="local.autoCheckUpdates" type="checkbox" />
            <span class="switch-thumb" />
          </label>
        </div>
      </section>

      <!-- OBS Overlay -->
      <section class="settings-section">
        <h3 class="section-title">OBS Overlay</h3>
        <p class="section-desc">Add a Browser Source in OBS with the URL below</p>

        <div class="overlay-url-box">
          <code class="overlay-url">{{ overlayUrl }}</code>
          <button class="btn btn-copy" @click="copyOverlayUrl" title="Copy URL">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy
          </button>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span>Port</span>
          </div>
          <input
            v-model.number="local.overlay.port"
            type="number"
            class="input-sm"
            min="1024"
            max="65535"
          />
        </div>

        <div class="form-row">
          <div class="form-label">
            <span>Background</span>
            <span class="form-hint">Use "transparent" for chroma key</span>
          </div>
          <div class="color-row">
            <input v-model="local.overlay.background" class="input-sm" placeholder="transparent" />
            <input
              v-if="local.overlay.background !== 'transparent'"
              v-model="local.overlay.background"
              type="color"
              class="color-swatch"
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span>Text colour</span>
          </div>
          <div class="color-row">
            <input v-model="local.overlay.textColor" class="input-sm" />
            <input v-model="local.overlay.textColor" type="color" class="color-swatch" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span>Font size</span>
          </div>
          <div class="slider-row">
            <input
              v-model.number="local.overlay.fontSize"
              type="range"
              min="11"
              max="28"
              step="1"
              class="slider"
            />
            <span class="slider-val">{{ local.overlay.fontSize }}px</span>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span>Max messages</span>
          </div>
          <div class="slider-row">
            <input
              v-model.number="local.overlay.maxMessages"
              type="range"
              min="1"
              max="50"
              step="1"
              class="slider"
            />
            <span class="slider-val">{{ local.overlay.maxMessages }}</span>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span>Animation</span>
          </div>
          <div class="toggle-group">
            <button
              v-for="anim in ['slide', 'fade', 'none']"
              :key="anim"
              class="toggle-btn"
              :class="{ active: local.overlay.animation === anim }"
              @click="local.overlay.animation = anim as AppSettings['overlay']['animation']"
            >
              {{ anim }}
            </button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span>Position</span>
          </div>
          <div class="toggle-group">
            <button
              v-for="pos in ['bottom', 'top']"
              :key="pos"
              class="toggle-btn"
              :class="{ active: local.overlay.position === pos }"
              @click="local.overlay.position = pos as AppSettings['overlay']['position']"
            >
              {{ pos }}
            </button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span>Show platform icon</span>
          </div>
          <label class="switch">
            <input v-model="local.overlay.showPlatformIcon" type="checkbox" />
            <span class="switch-thumb" />
          </label>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span>Show avatars</span>
          </div>
          <label class="switch">
            <input v-model="local.overlay.showAvatar" type="checkbox" />
            <span class="switch-thumb" />
          </label>
        </div>
      </section>

      <!-- Keyboard Shortcuts -->
      <section class="settings-section">
        <h3 class="section-title">Keyboard Shortcuts</h3>
        <div v-for="(config, key) in hotkeysConfig" :key="key" class="form-row">
          <div class="form-label">
            <span>{{ config.label }}</span>
            <span class="form-hint">{{ config.description }}</span>
          </div>
          <button
            class="hotkey-badge"
            :class="{ recording: recordingAction === key }"
            @click="startRecording(key as keyof HotkeySettings)"
          >
            <template v-if="recordingAction === key">Press a key…</template>
            <template v-else>
              <kbd>{{ formatKeyCombo(local.hotkeys[key as keyof HotkeySettings]) }}</kbd>
            </template>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-panel {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.settings-content {
  max-width: 640px;
  margin: 0 auto;
  padding: 28px 32px 60px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-header.top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--c-text, #e2e2e8);
  letter-spacing: -0.01em;
}

.page-sub {
  font-size: 13px;
  color: var(--c-text-2, #8b8b99);
  margin-top: 3px;
}

/* Section */
.settings-section {
  background: var(--c-surface, #18181b);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 14px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-bottom: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--c-text-2, #8b8b99);
  margin-bottom: 14px;
}

.section-desc {
  font-size: 12px;
  color: var(--c-text-2, #8b8b99);
  margin-top: -8px;
  margin-bottom: 14px;
}

/* Form rows */
.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--c-border, #2a2a33);
}

.form-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.form-row:first-of-type {
  padding-top: 0;
}

.form-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text, #e2e2e8);
}

.form-hint {
  font-size: 11px;
  color: var(--c-text-2, #8b8b99);
  font-weight: 400;
}

/* Toggle group */
.toggle-group {
  display: flex;
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}

.toggle-btn {
  background: none;
  border: none;
  color: var(--c-text-2, #8b8b99);
  font-size: 12px;
  font-weight: 500;
  padding: 5px 12px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
  font-family: inherit;
  text-transform: capitalize;
}

.toggle-btn + .toggle-btn {
  border-left: 1px solid var(--c-border, #2a2a33);
}

.toggle-btn.active {
  background: rgba(167, 139, 250, 0.2);
  color: #a78bfa;
}

/* Switch */
.switch {
  position: relative;
  display: inline-flex;
  cursor: pointer;
  flex-shrink: 0;
}

.switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-thumb {
  width: 40px;
  height: 22px;
  background: var(--c-border, #2a2a33);
  border-radius: 11px;
  transition: background 0.2s;
  position: relative;
}

.switch-thumb::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.switch input:checked ~ .switch-thumb {
  background: #a78bfa;
}

.switch input:checked ~ .switch-thumb::after {
  transform: translateX(18px);
}

/* Slider */
.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.slider {
  width: 130px;
  accent-color: #a78bfa;
  cursor: pointer;
}

.slider-val {
  font-size: 12px;
  color: var(--c-text-2, #8b8b99);
  width: 36px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Inputs */
.input-sm {
  background: var(--c-surface-2, #1f1f24);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 6px;
  color: var(--c-text, #e2e2e8);
  font-size: 13px;
  padding: 5px 10px;
  outline: none;
  font-family: inherit;
  width: 160px;
  transition: border-color 0.15s;
}

.input-sm:focus {
  border-color: #a78bfa;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-swatch {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  background: none;
  padding: 0;
}

/* Overlay URL box */
.overlay-url-box {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--c-surface-2, #1f1f24);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 16px;
}

.overlay-url {
  flex: 1;
  font-family: 'SF Mono', 'Fira Mono', monospace;
  font-size: 11px;
  color: #a78bfa;
  word-break: break-all;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Buttons */
.btn {
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.15s;
  display: flex;
  align-items: center;
  gap: 6px;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-save {
  background: #a78bfa;
  color: #fff;
  padding: 8px 18px;
  white-space: nowrap;
}
.btn-save:not(:disabled):hover {
  opacity: 0.88;
}

.btn-copy {
  background: rgba(167, 139, 250, 0.12);
  color: #a78bfa;
  border: 1px solid rgba(167, 139, 250, 0.25);
  padding: 5px 10px;
  white-space: nowrap;
  flex-shrink: 0;
  font-size: 12px;
}
.btn-copy:hover {
  background: rgba(167, 139, 250, 0.22);
}

.form-row-preview {
  align-items: flex-start;
  padding-top: 12px;
}

.ping-preview {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  border: 1px solid var(--c-border, #2a2a33);
  min-width: 200px;
  transition: background 0.2s;
}

.ping-preview-author {
  font-weight: 700;
  color: #a78bfa;
  flex-shrink: 0;
}

.ping-preview-text {
  color: var(--c-text, #e2e2e8);
}

.ping-preview-mention {
  color: #a78bfa;
  font-weight: 600;
}

/* Hotkey Badge */
.hotkey-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 100px;
  padding: 4px 10px;
  background: var(--c-surface, #1a1a23);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 6px;
  color: var(--c-text, #e2e2e8);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.hotkey-badge:hover {
  background: rgba(255, 255, 255, 0.05);
}

.hotkey-badge.recording {
  border-color: #a78bfa;
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.1);
}

kbd {
  font-family: monospace;
  font-size: 12px;
}
</style>
