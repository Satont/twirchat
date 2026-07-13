<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

withDefaults(
  defineProps<{
    side?: 'top' | 'bottom' | 'left' | 'right'
    sideOffset?: number
    delayDuration?: number
  }>(),
  {
    delayDuration: 200,
    side: 'bottom',
    sideOffset: 8,
  },
)
</script>

<template>
  <TooltipProvider :delay-duration="delayDuration">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipContent :side="side" :side-offset="sideOffset" class="twirchat-tooltip">
        <slot name="content" />
        <TooltipArrow class="twirchat-tooltip-arrow" />
      </TooltipContent>
    </TooltipRoot>
  </TooltipProvider>
</template>

<!-- All styles are global: TooltipContent is portalled outside the component tree -->
<style>
.twirchat-tooltip {
  background: #1e1e30;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 10px 12px;
  min-width: 190px;
  max-width: 270px;
  z-index: 9999;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  animation-duration: 150ms;
  animation-timing-function: ease-out;
  will-change: transform, opacity;
  font-size: 13px;
  color: #e8e8f0;
}

.twirchat-tooltip[data-state='delayed-open'][data-side='top'] {
  animation-name: twirchat-tooltip-slide-down;
}
.twirchat-tooltip[data-state='delayed-open'][data-side='bottom'] {
  animation-name: twirchat-tooltip-slide-up;
}
.twirchat-tooltip[data-state='delayed-open'][data-side='left'] {
  animation-name: twirchat-tooltip-slide-right;
}
.twirchat-tooltip[data-state='delayed-open'][data-side='right'] {
  animation-name: twirchat-tooltip-slide-left;
}

.twirchat-tooltip-arrow {
  fill: #1e1e30;
}

@keyframes twirchat-tooltip-slide-up {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes twirchat-tooltip-slide-down {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes twirchat-tooltip-slide-right {
  from {
    opacity: 0;
    transform: translateX(-4px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
@keyframes twirchat-tooltip-slide-left {
  from {
    opacity: 0;
    transform: translateX(4px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* Slot content styles (also global for the same portal reason) */
.chip-tooltip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.chip-tooltip-platform {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.chip-tooltip-status {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #888;
}
.chip-tooltip-status.live {
  color: #4ade80;
}

.chip-tooltip-title {
  font-size: 13px;
  color: #e8e8f0;
  line-height: 1.4;
  margin-bottom: 4px;
  word-break: break-word;
}
.chip-tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #999;
  margin-top: 3px;
}
.chip-tooltip-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.6;
  flex-shrink: 0;
}
</style>
