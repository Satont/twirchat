<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import {
  moderationActionColor,
  moderationActionForDrag,
  type ModerationDragAction,
} from '../utils/moderation-drag'
import type { ModerationPlatform } from '../services/desktop-api'

const props = defineProps<{
  disabled?: boolean
  message: NormalizedChatMessage
}>()

const emit = defineEmits<{
  moderate: [action: ModerationDragAction]
}>()

const activePointerID = ref<number | null>(null)
const dragStartX = ref(0)
const distance = ref(0)
const isDragging = computed(() => activePointerID.value !== null)
const canModerate = computed(
  () => props.message.platform === 'twitch' || props.message.platform === 'kick',
)
const preview = computed(() => {
  const platform = messageModerationPlatform()
  return platform ? moderationActionForDrag(platform, distance.value) : null
})

function onPointerDown(event: PointerEvent): void {
  if (props.disabled || !canModerate.value || event.button !== 0) return
  activePointerID.value = event.pointerId
  dragStartX.value = event.clientX
  distance.value = 0
  const target = event.currentTarget
  if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerId !== activePointerID.value) return
  distance.value = Math.min(420, Math.max(0, event.clientX - dragStartX.value))
}

function onPointerEnd(event: PointerEvent): void {
  if (event.pointerId !== activePointerID.value) return
  const action = preview.value
  activePointerID.value = null
  distance.value = 0
  if (action) emit('moderate', action)
}

function onPointerCancel(event: PointerEvent): void {
  if (event.pointerId !== activePointerID.value) return
  activePointerID.value = null
  distance.value = 0
}

function messageModerationPlatform(): ModerationPlatform | undefined {
  if (props.message.platform === 'twitch' || props.message.platform === 'kick') {
    return props.message.platform
  }
  return undefined
}
</script>

<template>
  <div
    class="moderation-rail"
    :class="{ dragging: isDragging, disabled }"
    :style="{ '--moderation-color': moderationActionColor(preview?.action ?? null) }"
    role="slider"
    aria-label="Moderate message"
    :aria-valuenow="Math.round(distance)"
    aria-valuemin="0"
    aria-valuemax="420"
    @click.stop
    @pointercancel="onPointerCancel"
    @pointerdown.stop.prevent="onPointerDown"
    @pointermove.stop.prevent="onPointerMove"
    @pointerup.stop.prevent="onPointerEnd"
  >
    <span class="moderation-rail-fill" :style="{ width: `${distance}px` }" />
    <span class="moderation-rail-handle" aria-hidden="true">⠿</span>
    <span v-if="preview" class="moderation-rail-preview">{{ preview.label }}</span>
  </div>
</template>

<style scoped>
.moderation-rail {
  align-items: center;
  cursor: ew-resize;
  display: flex;
  height: 100%;
  left: 0;
  overflow: visible;
  position: absolute;
  top: 0;
  touch-action: none;
  width: 16px;
  z-index: 3;
}

.moderation-rail.disabled {
  cursor: default;
  pointer-events: none;
}

.moderation-rail-fill {
  background: color-mix(in srgb, var(--moderation-color) 18%, transparent);
  border-left: 3px solid var(--moderation-color);
  height: 100%;
  left: 0;
  max-width: 420px;
  pointer-events: none;
  position: absolute;
  top: 0;
  transition: width 80ms ease;
}

.moderation-rail-handle {
  color: var(--c-text-2, #8b8b99);
  font-size: 12px;
  line-height: 1;
  opacity: 0;
  padding-left: 2px;
  transition: opacity 120ms ease;
  user-select: none;
}

.moderation-rail:hover .moderation-rail-handle,
.moderation-rail.dragging .moderation-rail-handle {
  opacity: 0.75;
}

.moderation-rail-preview {
  background: color-mix(in srgb, var(--moderation-color) 92%, #111827);
  border-radius: 4px;
  color: white;
  font-size: 11px;
  font-weight: 700;
  left: 10px;
  padding: 3px 6px;
  pointer-events: none;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
}
</style>
