<script setup lang="ts">
import { computed } from 'vue'
import { Window } from '@wailsio/runtime'
import type { WindowChromePlatform } from '../services/window-chrome'

interface Props {
  platform: WindowChromePlatform
}

const props = defineProps<Props>()

const isWindows = computed(() => props.platform === 'windows')
const isMacOS = computed(() => props.platform === 'macos')

function minimise() {
  void Window.Minimise()
}

function toggleMaximise() {
  void Window.ToggleMaximise()
}

function close() {
  void Window.Close()
}
</script>

<template>
  <header class="app-titlebar" :class="{ macos: isMacOS }">
    <div class="app-titlebar-brand" aria-label="TwirChat">
      <span class="app-titlebar-mark" aria-hidden="true">T</span>
      <span class="app-titlebar-name">TwirChat</span>
    </div>

    <div v-if="isWindows" class="app-titlebar-controls">
      <button class="app-titlebar-control" type="button" title="Minimise" @click="minimise">
        <span aria-hidden="true">−</span>
        <span class="sr-only">Minimise</span>
      </button>
      <button class="app-titlebar-control" type="button" title="Maximise" @click="toggleMaximise">
        <span class="app-titlebar-maximise-glyph" aria-hidden="true" />
        <span class="sr-only">Maximise or restore</span>
      </button>
      <button
        class="app-titlebar-control app-titlebar-close"
        type="button"
        title="Close"
        @click="close"
      >
        <span aria-hidden="true">×</span>
        <span class="sr-only">Close</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-titlebar {
  --wails-draggable: drag;

  align-items: center;
  background: var(--c-nav-bg, #111114);
  border-bottom: 1px solid var(--c-border, rgba(255, 255, 255, 0.06));
  color: var(--c-text-2, #8b8b99);
  display: flex;
  flex: 0 0 32px;
  height: 32px;
  min-height: 32px;
  padding-left: 10px;
  user-select: none;
}

.app-titlebar.macos {
  padding-left: 80px;
}

.app-titlebar-brand {
  align-items: center;
  display: flex;
  gap: 7px;
  min-width: 0;
}

.app-titlebar-mark {
  align-items: center;
  background: linear-gradient(135deg, #c4b5fd, #7c5aea);
  border-radius: 5px;
  color: #17131f;
  display: inline-flex;
  font-size: 10px;
  font-weight: 800;
  height: 16px;
  justify-content: center;
  letter-spacing: -0.04em;
  line-height: 1;
  width: 16px;
}

.app-titlebar-name {
  color: var(--c-text, #e2e2e8);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-titlebar-controls {
  --wails-draggable: no-drag;

  align-self: stretch;
  display: flex;
  margin-left: auto;
}

.app-titlebar-control {
  --wails-draggable: no-drag;

  align-items: center;
  background: transparent;
  border: 0;
  color: var(--c-text-2, #8b8b99);
  cursor: pointer;
  display: inline-flex;
  font-family: inherit;
  font-size: 16px;
  height: 32px;
  justify-content: center;
  line-height: 1;
  transition:
    background 0.12s ease,
    color 0.12s ease;
  width: 46px;
}

.app-titlebar-control:hover {
  background: rgba(255, 255, 255, 0.09);
  color: var(--c-text, #e2e2e8);
}

.app-titlebar-close:hover {
  background: #c42b3a;
  color: #fff;
}

.app-titlebar-maximise-glyph {
  border: 1.5px solid currentColor;
  height: 10px;
  width: 10px;
}

.sr-only {
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}
</style>
