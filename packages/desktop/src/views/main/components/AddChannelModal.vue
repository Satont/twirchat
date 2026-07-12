<script setup lang="ts">
import AddChannelForm from './AddChannelForm.vue'

const props = defineProps<{
  youtubeAuthenticated: boolean
}>()

const emit = defineEmits<{
  confirm: [platform: 'twitch' | 'kick' | 'youtube', channelSlug: string]
  cancel: []
}>()
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('cancel')">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">Add Channel</span>
          <button class="modal-close" @click="emit('cancel')">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <AddChannelForm
          :youtube-authenticated="youtubeAuthenticated"
          :cancelable="true"
          @confirm="(platform, slug) => emit('confirm', platform, slug)"
          @cancel="emit('cancel')"
        />
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
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
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
</style>
