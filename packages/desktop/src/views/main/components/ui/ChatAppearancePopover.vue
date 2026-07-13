<script setup lang="ts">
import { computed } from 'vue'
import { PopoverArrow, PopoverContent, PopoverRoot, PopoverTrigger } from 'reka-ui'
import type { AppSettings } from '@twirchat/shared/types'

const props = defineProps<{
  settings: AppSettings
}>()

const emit = defineEmits<{
  change: [settings: AppSettings]
}>()

function patch(partial: Partial<AppSettings>) {
  emit('change', { ...props.settings, ...partial })
}

const fontSize = computed({
  get: () => props.settings.fontSize,
  set: (v: number) => patch({ fontSize: v }),
})
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <button class="appearance-btn" title="Chat appearance">
        <!-- gear icon -->
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
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </button>
    </PopoverTrigger>

    <PopoverContent side="bottom" :side-offset="8" align="end" class="appearance-popover">
      <PopoverArrow class="appearance-popover-arrow" />

      <!-- Font size -->
      <div class="ap-section">
        <div class="ap-label">
          <span>Font size</span>
          <span class="ap-value">{{ fontSize }}px</span>
        </div>
        <input
          v-model.number="fontSize"
          type="range"
          min="11"
          max="22"
          step="1"
          class="ap-slider"
        />
        <div class="ap-slider-ticks">
          <span>11</span>
          <span>22</span>
        </div>
      </div>

      <!-- Chat display toggles -->
      <div class="ap-section">
        <div class="ap-label"><span>Display</span></div>
        <div class="ap-toggles">
          <label class="ap-toggle-row">
            <span class="ap-toggle-name">Color stripe</span>
            <span class="ap-switch">
              <input
                type="checkbox"
                :checked="settings.showPlatformColorStripe"
                @change="
                  patch({ showPlatformColorStripe: ($event.target as HTMLInputElement).checked })
                "
              />
              <span class="ap-switch-thumb" />
            </span>
          </label>
          <label class="ap-toggle-row">
            <span class="ap-toggle-name">Platform icon</span>
            <span class="ap-switch">
              <input
                type="checkbox"
                :checked="settings.showPlatformIcon"
                @change="patch({ showPlatformIcon: ($event.target as HTMLInputElement).checked })"
              />
              <span class="ap-switch-thumb" />
            </span>
          </label>
          <label class="ap-toggle-row">
            <span class="ap-toggle-name">Avatars</span>
            <span class="ap-switch">
              <input
                type="checkbox"
                :checked="settings.showAvatars"
                @change="patch({ showAvatars: ($event.target as HTMLInputElement).checked })"
              />
              <span class="ap-switch-thumb" />
            </span>
          </label>
          <label class="ap-toggle-row">
            <span class="ap-toggle-name">Badges</span>
            <span class="ap-switch">
              <input
                type="checkbox"
                :checked="settings.showBadges"
                @change="patch({ showBadges: ($event.target as HTMLInputElement).checked })"
              />
              <span class="ap-switch-thumb" />
            </span>
          </label>
          <label class="ap-toggle-row">
            <span class="ap-toggle-name">Timestamp</span>
            <span class="ap-switch">
              <input
                type="checkbox"
                :checked="settings.showTimestamp"
                @change="patch({ showTimestamp: ($event.target as HTMLInputElement).checked })"
              />
              <span class="ap-switch-thumb" />
            </span>
          </label>
        </div>
      </div>

      <!-- Chat layout -->
      <div class="ap-section">
        <div class="ap-label"><span>Layout</span></div>
        <div class="ap-themes">
          <button
            class="ap-theme-btn"
            :class="{ active: settings.chatTheme === 'modern' }"
            @click="patch({ chatTheme: 'modern' })"
          >
            <!-- Modern preview: avatar + two rows -->
            <div class="theme-preview modern-preview">
              <div class="tp-row">
                <div class="tp-avatar" />
                <div class="tp-lines">
                  <div class="tp-line tp-name" />
                  <div class="tp-line tp-text" />
                </div>
              </div>
              <div class="tp-row">
                <div class="tp-avatar" />
                <div class="tp-lines">
                  <div class="tp-line tp-name" />
                  <div class="tp-line tp-text" />
                </div>
              </div>
            </div>
            <span class="ap-theme-label">Modern</span>
          </button>

          <button
            class="ap-theme-btn"
            :class="{ active: settings.chatTheme === 'compact' }"
            @click="patch({ chatTheme: 'compact' })"
          >
            <!-- Compact preview: name: text inline -->
            <div class="theme-preview compact-preview">
              <div class="cp-row">
                <div class="cp-name" />
                <div class="cp-sep" />
                <div class="cp-text" />
              </div>
              <div class="cp-row">
                <div class="cp-name" />
                <div class="cp-sep" />
                <div class="cp-text cp-text-long" />
              </div>
              <div class="cp-row">
                <div class="cp-name cp-name-short" />
                <div class="cp-sep" />
                <div class="cp-text" />
              </div>
            </div>
            <span class="ap-theme-label">Compact</span>
          </button>
        </div>
      </div>
    </PopoverContent>
  </PopoverRoot>
</template>

<!-- Global styles — PopoverContent is portalled outside the component tree -->
<style>
.appearance-popover {
  background: #1a1a22;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 16px;
  width: 240px;
  z-index: 9999;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
  animation: ap-fade-in 120ms ease-out;
}

@keyframes ap-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.appearance-popover-arrow {
  fill: #1a1a22;
}

.ap-section {
  margin-bottom: 16px;
}
.ap-section:last-child {
  margin-bottom: 0;
}

.ap-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: #8b8b99;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 10px;
}
.ap-value {
  font-variant-numeric: tabular-nums;
  color: #e2e2e8;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
}

/* Slider */
.ap-slider {
  width: 100%;
  accent-color: #a78bfa;
  cursor: pointer;
  height: 4px;
  appearance: none;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  outline: none;
}
.ap-slider::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #a78bfa;
  cursor: pointer;
  box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.25);
}
.ap-slider-ticks {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #555566;
  margin-top: 4px;
}

/* Display toggles */
.ap-toggles {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ap-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
}

.ap-toggle-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.ap-toggle-row:first-child {
  padding-top: 0;
}

.ap-toggle-name {
  font-size: 13px;
  color: #d0d0da;
  font-weight: 400;
}

.ap-switch {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.ap-switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.ap-switch-thumb {
  width: 34px;
  height: 19px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  transition: background 0.2s;
  position: relative;
}

.ap-switch-thumb::after {
  content: '';
  position: absolute;
  top: 2.5px;
  left: 2.5px;
  width: 14px;
  height: 14px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 50%;
  transition:
    transform 0.2s,
    background 0.2s;
}

.ap-switch input:checked ~ .ap-switch-thumb {
  background: #a78bfa;
}

.ap-switch input:checked ~ .ap-switch-thumb::after {
  transform: translateX(15px);
  background: #fff;
}

/* Theme buttons */
.ap-themes {
  display: flex;
  gap: 10px;
}

.ap-theme-btn {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 8px 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.ap-theme-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.15);
}
.ap-theme-btn.active {
  border-color: #a78bfa;
  background: rgba(167, 139, 250, 0.1);
}

.ap-theme-label {
  font-size: 11px;
  font-weight: 500;
  color: #aaa;
}
.ap-theme-btn.active .ap-theme-label {
  color: #a78bfa;
}

/* Modern preview */
.theme-preview {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.tp-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.tp-avatar {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  flex-shrink: 0;
  margin-top: 1px;
}
.tp-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tp-line {
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
}
.tp-name {
  width: 40%;
  background: rgba(167, 139, 250, 0.5);
}
.tp-text {
  width: 85%;
}

/* Compact preview */
.cp-row {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-bottom: 4px;
}
.cp-name {
  width: 28%;
  height: 3px;
  border-radius: 2px;
  background: rgba(167, 139, 250, 0.5);
  flex-shrink: 0;
}
.cp-name-short {
  width: 18%;
}
.cp-sep {
  width: 3px;
  height: 3px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.2);
  flex-shrink: 0;
}
.cp-text {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  width: 60%;
}
.cp-text-long {
  width: 90%;
}
</style>

<style scoped>
.appearance-btn {
  background: none;
  border: none;
  color: #8b8b99;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.15s,
    background 0.15s;
  flex-shrink: 0;
}
.appearance-btn:hover {
  color: #e2e2e8;
  background: rgba(255, 255, 255, 0.07);
}
</style>
