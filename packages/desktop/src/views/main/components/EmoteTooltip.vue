<script setup lang="ts">
import { computed } from "vue";
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
  TooltipArrow,
  TooltipProvider,
} from "reka-ui";
import type { Emote } from "@twirchat/shared/types";

const props = defineProps<{
  emote: Emote;
}>();

const emoteUrl = computed(() => {
  return `https://7tv.app/emotes/${props.emote.id}`;
});

function openEmotePage(): void {
  window.open(emoteUrl.value, "_blank");
}
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipContent
        side="top"
        :side-offset="8"
        class="emote-tooltip"
      >
        <div class="emote-tooltip-content">
          <div class="emote-preview">
            <img 
              :src="emote.imageUrl" 
              :alt="emote.name"
              class="emote-preview-img"
            />
          </div>
          
          <div class="emote-info">
            <div class="emote-name">{{ emote.name }}</div>
            
            <a 
              :href="emoteUrl" 
              target="_blank" 
              class="emote-link"
              @click.prevent="openEmotePage"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              View on 7TV
            </a>
          </div>
        </div>
        
        <TooltipArrow class="emote-tooltip-arrow" />
      </TooltipContent>
    </TooltipRoot>
  </TooltipProvider>
</template>

<style>
.emote-tooltip {
  background: #1e1e30;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 12px;
  z-index: 9999;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  animation-duration: 150ms;
  animation-timing-function: ease-out;
  will-change: transform, opacity;
  min-width: 140px;
}

.emote-tooltip[data-state="delayed-open"][data-side="top"] {
  animation-name: emote-tooltip-slide-down;
}

.emote-tooltip[data-state="delayed-open"][data-side="bottom"] {
  animation-name: emote-tooltip-slide-up;
}

@keyframes emote-tooltip-slide-up {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes emote-tooltip-slide-down {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.emote-tooltip-arrow {
  fill: #1e1e30;
}

.emote-tooltip-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.emote-preview {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 8px;
}

.emote-preview-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.emote-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.emote-name {
  font-size: 14px;
  font-weight: 600;
  color: #e8e8f0;
  text-align: center;
}

.emote-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #8b8b99;
  text-decoration: none;
  margin-top: 4px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}

.emote-link:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e8e8f0;
}
</style>
