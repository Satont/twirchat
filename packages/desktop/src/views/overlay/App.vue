<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { NormalizedChatMessage, NormalizedEvent } from '@twirchat/shared/types'
import { platformColor } from '../shared/utils/platform'

// ----------------------------------------------------------------
// Config from URL query params
// ----------------------------------------------------------------

function qp(name: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? fallback
}

const cfg = {
  bg: qp('bg', 'transparent'),
  textColor: qp('textColor', '#ffffff'),
  fontSize: Number(qp('fontSize', '14')),
  maxMessages: Number(qp('maxMessages', '20')),
  timeout: Number(qp('timeout', '0')), // Seconds, 0 = never
  showPlatform: qp('showPlatform', '1') !== '0',
  showAvatar: qp('showAvatar', '1') !== '0',
  showBadges: qp('showBadges', '1') !== '0',
  animation: qp('animation', 'slide') as 'slide' | 'fade' | 'none',
  position: qp('position', 'bottom') as 'bottom' | 'top',
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
  msg: NormalizedChatMessage
  expireAt?: number
}

const messages = ref<DisplayMessage[]>([])

function addMessage(msg: NormalizedChatMessage) {
  if (allowedPlatforms && !allowedPlatforms.has(msg.platform)) {
    return
  }

  const dm: DisplayMessage = {
    expireAt: cfg.timeout > 0 ? Date.now() + cfg.timeout * 1000 : undefined,
    id: msg.id,
    msg,
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

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let expireTimer: ReturnType<typeof setInterval> | null = null

function connect() {
  ws = new WebSocket(`ws://localhost:${cfg.port}`)

  ws.addEventListener('open', () => {
    console.log('[Overlay] WS connected')
  })

  ws.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data as string)
      if (data.type === 'chat_message') {
        addMessage(data.data as NormalizedChatMessage)
      } else if (data.type === 'clear') {
        clearMessages()
      }
    } catch (error) {
      console.error('[Overlay] Parse error:', error)
    }
  })

  ws.addEventListener('close', () => {
    ws = null
    reconnectTimer = setTimeout(connect, 3000)
  })

  ws.addEventListener('error', () => {
    ws?.close()
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
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
  }
  if (expireTimer) {
    clearInterval(expireTimer)
  }
  ws?.close()
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
          :style="{ background: platformColor(dm.msg.platform) }"
        />

        <!-- Avatar -->
        <img
          v-if="cfg.showAvatar && dm.msg.author.avatarUrl"
          class="avatar"
          :src="dm.msg.author.avatarUrl"
          :alt="dm.msg.author.displayName"
        />

        <!-- Author -->
        <span class="author" :style="dm.msg.author.color ? { color: dm.msg.author.color } : {}">{{
          dm.msg.author.displayName
        }}</span>

        <span class="sep">:</span>

        <!-- Text -->
        <span class="text">{{ dm.msg.text }}</span>
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
