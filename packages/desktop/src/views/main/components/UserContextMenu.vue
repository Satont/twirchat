<script setup lang="ts">
import { ref } from 'vue'
import type { Platform } from '@twirchat/shared/types'

import UserCardDialog from './UserCardDialog.vue'

interface Props {
  platform: Platform
  platformUserId: string
  channelId?: string
  channelSlug?: string
  displayName: string
  username?: string
  avatarUrl?: string
  currentAlias?: string
}

const props = defineProps<Props>()

const dialogOpen = ref(false)

function openDialog() {
  dialogOpen.value = true
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault()
  openDialog()
}
</script>

<template>
  <span class="user-card-trigger" @contextmenu="onContextMenu">
    <slot />
  </span>

  <UserCardDialog
    v-model:open="dialogOpen"
    :platform="platform"
    :platform-user-id="platformUserId"
    :channel-id="channelId"
    :channel-slug="channelSlug"
    :display-name="displayName"
    :username="username"
    :avatar-url="avatarUrl"
    :current-alias="currentAlias"
  />
</template>

<style scoped>
.user-card-trigger {
  display: inline;
}
</style>
