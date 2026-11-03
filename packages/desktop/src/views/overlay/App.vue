<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { platformColor } from '../shared/utils/platform'
import {
  overlayEventSchema,
  parseOverlayAnimation,
  parseOverlayPosition,
  type OverlayChatMessage,
} from './protocol'

// ----------------------------------------------------------------
// Config from URL query params
// ----------------------------------------------------------------

function qp(name: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? fallback
}

const cfg = {
  bg: qp('bg', 'transparent'),
  textColor: qp('textColor', qp('color', '#ffffff')),
  fontSize: Number(qp('fontSize', '14')),
  maxMessages: Number(qp('maxMessages', '20')),
  timeout: Number(qp('timeout', '0')), // Seconds, 0 = never
  showPlatform: qp('showPlatform', '1') !== '0',
  showAvatar: qp('showAvatar', '1') !== '0',
  showBadges: qp('showBadges', '1') !== '0',
  animation: parseOverlayAnimation(qp('animation', 'slide')),
  position: parseOverlayPosition(qp('position', 'bottom')),
  platforms: qp('platforms', ''),
  port: Number(qp('port', '45823')),
}

const allowedPlatforms = cfg.platforms
  ? new Set(cfg.platforms.split(',').map((s) => s.trim()))
  : null

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------

interface DisplayMessage {
  id: string
  payload: OverlayChatMessage
  expireAt?: number
}

const messages = ref<DisplayMessage[]>([])

function addMessage(payload: OverlayChatMessage) {
  if (allowedPlatforms && !allowedPlatforms.has(payload.message.platform)) {
    return
  }

  const dm: DisplayMessage = {
    expireAt: cfg.timeout > 0 ? Date.now() + cfg.timeout * 1000 : undefined,
    id: payload.message.id,
    payload,
  }

  if (cfg.position === 'bottom') {
    messages.value.push(dm)
    if (messages.value.length > cfg.maxMessages) {
      messages.value.splice(0, messages.value.length - cfg.maxMessages)
    }
  } else {
    messages.value.unshift(dm)
    if (messages.value.length > cfg.maxMessages) {
      messages.value.length = cfg.maxMessages
    }
  }
}

function clearMessages() {
  messages.value = []
}

// ----------------------------------------------------------------
// WebSocket connection to overlay-server.ts
// ----------------------------------------------------------------

let stopped = false
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let expireTimer: ReturnType<typeof setInterval> | null = null

function connect() {
  if (stopped) return
  const socket = new WebSocket(`ws://localhost:${cfg.port}`)
  ws = socket

  socket.addEventListener('open', () => {
    console.log('[Overlay] WS connected')
  })

  socket.addEventListener('message', (ev) => {
    try {
      if (stopped || ws !== socket || typeof ev.data !== 'string') return
      const data = overlayEventSchema.parse(JSON.parse(ev.data))
      if (data.type === 'chat_message') {
        addMessage(data.data)
      } else if (data.type === 'clear') {
        clearMessages()
      }
    } catch (error) {
      console.error('[Overlay] Parse error:', error)
    }
  })

  socket.addEventListener('close', () => {
    if (ws !== socket) return
    ws = null
    if (!stopped) reconnectTimer = setTimeout(connect, 3000)
  })

  socket.addEventListener('error', () => {
    socket.close()
  })
}

onMounted(() => {
  connect()

  if (cfg.timeout > 0) {
    expireTimer = setInterval(() => {
      const now = Date.now()
      messages.value = messages.value.filter((dm) => !dm.expireAt || dm.expireAt > now)
    }, 500)
  }
})

onUnmounted(() => {
  stopped = true
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
  }
  if (expireTimer) {
    clearInterval(expireTimer)
  }
  const socket = ws
  ws = null
  socket?.close()
})

// ----------------------------------------------------------------
// CSS vars
// ----------------------------------------------------------------

const cssVars = computed(() => ({
  '--bg': cfg.bg === 'transparent' ? 'transparent' : cfg.bg,
  '--font-family': '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  '--font-size': `${cfg.fontSize}px`,
  '--text-color': cfg.textColor,
}))
</script>

<template>
  <div
    class="overlay"
    :class="[`position-${cfg.position}`, `anim-${cfg.animation}`]"
    :style="cssVars"
  >
    <TransitionGroup name="msg" tag="div" class="messages">
      <div v-for="dm in messages" :key="dm.id" class="message">
        <!-- Platform dot -->
        <span
          v-if="cfg.showPlatform"
          class="platform-dot"
          :style="{ background: platformColor(dm.payload.message.platform) }"
        />

        <!-- Avatar -->
        <img
          v-if="cfg.showAvatar && dm.payload.message.author.avatarUrl"
          class="avatar"
          :src="dm.payload.message.author.avatarUrl"
          :alt="dm.payload.message.author.displayName"
        />

        <!-- Author -->
        <span
          class="author"
          :style="dm.payload.message.author.color ? { color: dm.payload.message.author.color } : {}"
          >{{ dm.payload.message.author.displayName }}</span
        >

        <span class="sep">:</span>

        <span class="text">
          <template
            v-for="(part, index) in dm.payload.parts"
            :key="`${dm.id}-${part.type}-${index}`"
          >
            <img
              v-if="part.type === 'emote' && part.emote"
              class="emote"
              :src="part.emote.imageUrl"
              :alt="part.emote.name"
              :title="part.emote.name"
            />
            <span v-else-if="part.type === 'text' && part.content">{{ part.content }}</span>
          </template>
        </span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: var(--bg, transparent);
  font-family: var(--font-family, sans-serif);
  font-size: var(--font-size, 14px);
  color: var(--text-color, #fff);
  display: flex;
  overflow: hidden;
}

.overlay.position-bottom {
  align-items: flex-end;
}

.overlay.position-top {
  align-items: flex-start;
}

.messages {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
}

.message {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.5);
  padding: 5px 10px;
  border-radius: 6px;
  word-break: break-word;
  line-height: 1.4;
}

.platform-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.avatar {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
}

.author {
  font-weight: 700;
  flex-shrink: 0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

.sep {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.5);
}

.text {
  flex: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  word-break: break-word;
}

.emote {
  height: 1.7em;
  width: auto;
  max-width: 5.2em;
  vertical-align: middle;
  display: inline-block;
  object-fit: contain;
}

/* ---- Slide animation ---- */
.anim-slide .msg-enter-active,
.anim-slide .msg-leave-active {
  transition: all 0.3s ease;
}
.anim-slide .msg-enter-from {
  transform: translateX(-20px);
  opacity: 0;
}
.anim-slide .msg-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

/* ---- Fade animation ---- */
.anim-fade .msg-enter-active,
.anim-fade .msg-leave-active {
  transition: opacity 0.3s ease;
}
.anim-fade .msg-enter-from,
.anim-fade .msg-leave-to {
  opacity: 0;
}

/* ---- No animation ---- */
.anim-none .msg-enter-active,
.anim-none .msg-leave-active {
  transition: none;
}
</style>
