<script setup lang="ts">
import { computed, ref } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'

import KickIcon from '../../../assets/icons/platforms/kick.svg'
import TwitchIcon from '../../../assets/icons/platforms/twitch.svg'
import { platformColor } from '../../shared/utils/platform'
import { useChannelChatters } from '../composables/useChannelChatters'
import type { ChannelChatters, ChattersTarget, ChatterUser } from '../services/desktop-api'
import { chatterRoleLabel } from '../utils/chatters'

interface Props {
  targets: ChattersTarget[]
}

const props = defineProps<Props>()
const open = defineModel<boolean>('open', { required: true })

const targets = computed(() => props.targets)
const { chatters, loading, error, query, visibleResults, reload } = useChannelChatters(
  open,
  targets,
)

const hasQuery = computed(() => query.value.trim().length > 0)
const totalChatting = computed(() =>
  (chatters.value?.results ?? []).reduce((sum, channel) => sum + channel.total, 0),
)

const searchInput = ref<HTMLInputElement | null>(null)

function focusSearch(): void {
  searchInput.value?.focus()
}

function platformIcon(platform: ChannelChatters['platform']) {
  return platform === 'kick' ? KickIcon : TwitchIcon
}

function channelKey(channel: ChannelChatters): string {
  return `${channel.platform}:${channel.channelSlug}`
}

function chatterInitial(user: ChatterUser): string {
  const name = user.displayName || user.username
  return name.charAt(0).toUpperCase()
}

function showLogin(user: ChatterUser): boolean {
  return Boolean(user.username) && user.username.toLowerCase() !== user.displayName.toLowerCase()
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog-content" @open-auto-focus="focusSearch">
        <div class="chatters-header">
          <div class="chatters-header-main">
            <DialogTitle class="dialog-title">Chatters</DialogTitle>
            <p v-if="chatters" class="chatters-subtitle">
              <span class="chatters-total">{{ totalChatting }} chatting</span>
              across {{ chatters.results.length }}
              {{ chatters.results.length === 1 ? 'channel' : 'channels' }}
            </p>
          </div>
        </div>

        <input
          id="chatters-search-input"
          ref="searchInput"
          v-model="query"
          class="dialog-input chatters-search"
          type="search"
          placeholder="Search chatters…"
          @keydown.escape.prevent="open = false"
        />

        <div class="chatters-body">
          <div v-if="loading" class="chatters-state">Loading chatters…</div>

          <div v-else-if="error" class="chatters-state chatters-state-error">
            <span>{{ error }}</span>
            <button class="chatters-retry-btn" @click="void reload()">Retry</button>
          </div>

          <template v-else-if="chatters">
            <div v-if="visibleResults.length === 0" class="chatters-state">
              No active chatters right now.
            </div>

            <section
              v-for="channel in visibleResults"
              :key="channelKey(channel)"
              class="chatters-channel"
              :style="{ '--platform-color': platformColor(channel.platform) }"
            >
              <header class="chatters-channel-header">
                <component :is="platformIcon(channel.platform)" class="chatters-platform-icon" />
                <span class="chatters-channel-slug">{{ channel.channelSlug }}</span>
                <span class="chatters-channel-total">· {{ channel.total }} chatting</span>
              </header>

              <div v-if="channel.error" class="chatters-state chatters-state-error">
                <span>{{ channel.error }}</span>
                <button class="chatters-retry-btn" @click="void reload()">Retry</button>
              </div>

              <div v-else-if="channel.groups.length === 0" class="chatters-state">
                {{ hasQuery ? 'No chatters match your search.' : 'No active chatters right now.' }}
              </div>

              <div v-else class="chatters-groups">
                <section v-for="group in channel.groups" :key="group.role" class="chatters-group">
                  <h4 class="chatters-group-title">
                    {{ chatterRoleLabel(group.role) }}
                    <span class="chatters-group-count">{{ group.users.length }}</span>
                  </h4>
                  <ul class="chatters-user-list">
                    <li
                      v-for="user in group.users"
                      :key="user.userId ?? user.username"
                      class="chatters-user"
                    >
                      <img
                        v-if="user.avatarUrl"
                        :src="user.avatarUrl"
                        :alt="user.displayName"
                        class="chatters-avatar"
                        referrerpolicy="no-referrer"
                      />
                      <span v-else class="chatters-avatar chatters-avatar-fallback">
                        {{ chatterInitial(user) }}
                      </span>
                      <span class="chatters-user-name">{{ user.displayName }}</span>
                      <span v-if="showLogin(user)" class="chatters-user-login">
                        @{{ user.username }}
                      </span>
                    </li>
                  </ul>
                </section>
              </div>
            </section>
          </template>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.dialog-overlay {
  background: rgba(0, 0, 0, 0.6);
  position: fixed;
  inset: 0;
  z-index: 2000;
}

.dialog-content {
  background: var(--c-bg-2, #2a2a35);
  border: 1px solid var(--c-border, #3a3a45);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90vw;
  max-width: 480px;
  padding: 20px;
  z-index: 2001;
  max-height: min(85vh, 720px);
  display: flex;
  flex-direction: column;
}

.dialog-title {
  margin: 0;
  font-size: 1.35em;
  color: var(--c-text, #e2e2e8);
}

.chatters-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: -20px -20px 16px;
  padding: 16px 20px;
  background: linear-gradient(135deg, #23232e 0%, #1a1a22 100%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.chatters-header-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chatters-subtitle {
  margin: 0;
  font-size: 0.9em;
  color: rgba(255, 255, 255, 0.75);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chatters-total {
  font-weight: 600;
}

.dialog-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  background: var(--c-bg, #1e1e24);
  border: 1px solid var(--c-border, #3a3a45);
  color: var(--c-text, #e2e2e8);
  border-radius: 4px;
  font-size: 0.95em;
}

.dialog-input:focus {
  outline: none;
  border-color: var(--c-accent, #9147ff);
}

.chatters-search {
  flex-shrink: 0;
  margin-bottom: 12px;
}

.chatters-body {
  flex: 1;
  min-height: 160px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.chatters-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 160px;
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--c-text-2, #8b8b99);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.16);
}

.chatters-channel .chatters-state {
  min-height: 56px;
}

.chatters-state-error {
  color: #fca5a5;
  flex-direction: column;
}

.chatters-retry-btn {
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--c-text, #e2e2e8);
  cursor: pointer;
  font: inherit;
  padding: 6px 10px;
  font-size: 12px;
}

.chatters-retry-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}

.chatters-channel {
  display: flex;
  flex-direction: column;
}

.chatters-channel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.chatters-platform-icon {
  width: 16px;
  height: 16px;
  color: var(--platform-color, #9146ff);
  flex-shrink: 0;
}

.chatters-channel-slug {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text, #e2e2e8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chatters-channel-total {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-2, #8b8b99);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.chatters-groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chatters-group-title {
  margin: 0 0 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  color: var(--c-text-2, #8b8b99);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.chatters-group-count {
  font-variant-numeric: tabular-nums;
  background: rgba(255, 255, 255, 0.07);
  border-radius: 999px;
  padding: 1px 8px;
}

.chatters-user-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chatters-user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
}

.chatters-user:hover {
  background: rgba(255, 255, 255, 0.05);
}

.chatters-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.chatters-avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--platform-color, #9146ff);
}

.chatters-user-name {
  font-size: 13px;
  color: var(--c-text, #e2e2e8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chatters-user-login {
  font-size: 11px;
  color: var(--c-text-2, #8b8b99);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
