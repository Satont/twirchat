<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Account, Platform, PlatformStatusInfo } from '@twirchat/shared/types'
import { invoke } from '@tauri-apps/api/core'
import StreamEditor from './StreamEditor.vue'
import { useTauriEvent } from '../composables/useTauriEvent'
import { platformColor } from '../../shared/utils/platform'
import TwitchIcon from '../../../assets/icons/platforms/twitch.svg'
import YoutubeIcon from '../../../assets/icons/platforms/youtube.svg'
import KickIcon from '../../../assets/icons/platforms/kick.svg'

const props = defineProps<{
  accounts: Account[]
  statuses: Map<string, PlatformStatusInfo>
}>()

const emit = defineEmits<{
  'accounts-updated': [accounts: Account[]]
}>()

// ----------------------------------------------------------------
// Per-platform channel input state
// ----------------------------------------------------------------

const channelInputs = ref<Record<string, string>>({
  kick: '',
  twitch: '',
  youtube: '',
})
const joiningChannel = ref<Record<string, boolean>>({})
const authLoading = ref<Record<string, boolean>>({})
const joinedChannels = ref<Record<string, string[]>>({
  kick: [],
  twitch: [],
  youtube: [],
})

// ----------------------------------------------------------------
// Toast notifications
// ----------------------------------------------------------------

interface Toast {
  id: number
  platform: Platform
  type: 'success' | 'error'
  message: string
}

let toastId = 0
const toasts = ref<Toast[]>([])

function addToast(platform: Platform, type: Toast['type'], message: string) {
  const id = ++toastId
  toasts.value.push({ id, message, platform, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 4000)
}

// ----------------------------------------------------------------
// RPC listeners
// ----------------------------------------------------------------

useTauriEvent<{ platform: string; username: string; displayName: string }>('auth:success', async ({ platform, displayName }) => {
  const updated = (await invoke<Account[]>('get_accounts')) as Account[]
  emit('accounts-updated', updated)
  addToast(platform as Platform, 'success', `Connected as ${displayName}`)
})
useTauriEvent<{ platform: string; error: string }>('auth:error', ({ platform, error }) => {
  addToast(platform as Platform, 'error', error)
})

onMounted(async () => {
  // Load persisted channels from the backend
  try {
    const saved = (await invoke<Record<Platform, string[]>>('get_channels')) as Partial<Record<Platform, string[]>>
    if (saved) {
      for (const platform of ['twitch', 'youtube', 'kick'] as Platform[]) {
        const slugs = saved[platform]
        if (slugs && slugs.length > 0) {
          joinedChannels.value[platform] = slugs
        }
      }
    }
  } catch (error) {
    console.warn('[PlatformsPanel] Failed to load persisted channels:', error)
  }
})

// ----------------------------------------------------------------
// Platform metadata
// ----------------------------------------------------------------

const platforms: Platform[] = ['twitch', 'youtube', 'kick']

function account(platform: Platform): Account | undefined {
  return props.accounts.find((a) => a.platform === platform)
}

function status(platform: Platform): PlatformStatusInfo | undefined {
  return props.statuses.get(platform)
}

function statusLabel(s?: PlatformStatusInfo): string {
  if (!s) {
    return 'Not connected'
  }
  switch (s.status) {
    case 'connected': {
      return s.mode === 'authenticated' ? 'Connected' : 'Connected (anonymous)'
    }
    case 'connecting': {
      return 'Connecting…'
    }
    case 'error': {
      return s.error ?? 'Error'
    }
    default: {
      return 'Disconnected'
    }
  }
}

function statusClass(s?: PlatformStatusInfo): string {
  if (!s) {
    return 'dot-off'
  }
  switch (s.status) {
    case 'connected': {
      return 'dot-on'
    }
    case 'connecting': {
      return 'dot-wait'
    }
    case 'error': {
      return 'dot-err'
    }
    default: {
      return 'dot-off'
    }
  }
}

function avatarInitials(name: string): string {
  return name.charAt(0).toUpperCase()
}

// ----------------------------------------------------------------
// Actions
// ----------------------------------------------------------------

async function startAuth(platform: Platform) {
  authLoading.value[platform] = true
  try {
    await invoke('auth_start', { platform })
  } finally {
    authLoading.value[platform] = false
  }
}

async function logout(platform: Platform) {
  await invoke('auth_logout', { platform })
  const updated = (await invoke<Account[]>('get_accounts')) as Account[]
  emit('accounts-updated', updated)
}

async function joinChannel(platform: Platform) {
  const slug = (channelInputs.value[platform] ?? '').trim()
  if (!slug) {
    return
  }
  joiningChannel.value[platform] = true
  try {
    await invoke('join_channel', { platform, channel_slug: slug })
    if (!(joinedChannels.value[platform] ?? []).includes(slug)) {
      joinedChannels.value[platform] = [...(joinedChannels.value[platform] ?? []), slug]
    }
    channelInputs.value[platform] = ''
  } catch (error) {
    console.error(`[PlatformsPanel] joinChannel failed for ${platform}:`, error)
    addToast(
      platform,
      'error',
      `Failed to join channel: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    joiningChannel.value[platform] = false
  }
}

async function leaveChannel(platform: Platform, slug: string) {
  await invoke('leave_channel', { platform, channel_slug: slug })
  joinedChannels.value[platform] = (joinedChannels.value[platform] ?? []).filter((c) => c !== slug)
}

function onInputKeydown(e: KeyboardEvent, platform: Platform) {
  if (e.key === 'Enter') {
    joinChannel(platform)
  }
}
</script>

<template>
  <div class="platforms-panel">
    <div class="panel-header">
      <h2 class="panel-title">Platforms</h2>
      <p class="panel-subtitle">Connect your streaming accounts and join channels</p>
    </div>

    <div class="platforms-list">
      <div v-for="platform in platforms" :key="platform" class="platform-card">
        <!-- Card header -->
        <div class="card-header">
          <div class="platform-logo" :style="{ background: platformColor(platform) }">
            <component
              :is="
                platform === 'twitch' ? TwitchIcon : platform === 'youtube' ? YoutubeIcon : KickIcon
              "
              width="20"
              height="20"
              :fill="platform === 'kick' ? 'black' : 'white'"
            />
          </div>

          <div class="card-title-area">
            <div class="card-platform-name">
              {{ platform === 'twitch' ? 'Twitch' : platform === 'youtube' ? 'YouTube' : 'Kick' }}
            </div>
            <div class="card-status">
              <span class="status-dot" :class="statusClass(status(platform))" />
              <span class="status-text">{{ statusLabel(status(platform)) }}</span>
            </div>
          </div>

          <!-- Auth actions -->
          <div class="card-auth">
            <Transition name="account-slide">
              <div v-if="account(platform)" class="account-info">
                <div
                  class="account-avatar"
                  :style="{ '--platform-color': platformColor(platform) }"
                >
                  <img
                    v-if="account(platform)?.avatarUrl"
                    :src="account(platform)?.avatarUrl"
                    :alt="account(platform)?.displayName"
                    class="avatar-img"
                  />
                  <span v-else class="avatar-fallback">
                    {{ avatarInitials(account(platform)?.displayName ?? '?') }}
                  </span>
                </div>
                <div class="account-details">
                  <span class="account-name">{{ account(platform)?.displayName }}</span>
                  <span class="account-username">@{{ account(platform)?.username }}</span>
                </div>
                <button class="btn btn-ghost btn-sm" @click="logout(platform)">Disconnect</button>
              </div>

              <button
                v-else
                class="btn btn-primary btn-sm"
                :style="{
                  '--btn-color': platformColor(platform),
                  '--btn-text': platform === 'kick' ? '#000' : '#fff',
                }"
                :disabled="authLoading[platform]"
                @click="startAuth(platform)"
              >
                <svg
                  v-if="authLoading[platform]"
                  class="spinner"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <path
                    d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                    stroke-linecap="round"
                  />
                </svg>
                {{ authLoading[platform] ? 'Opening…' : 'Connect account' }}
              </button>
            </Transition>
          </div>
        </div>

        <!-- Channel join section -->
        <div class="card-channels">
          <!-- Show input only for Twitch or when not authenticated for YouTube/Kick -->
          <div v-if="platform === 'twitch' || !account(platform)" class="channel-input-row">
            <div class="input-wrapper">
              <span class="input-prefix">#</span>
              <input
                v-model="channelInputs[platform]"
                class="channel-input"
                :placeholder="platform === 'youtube' ? 'Channel ID or handle' : 'channel name'"
                @keydown="onInputKeydown($event, platform)"
              />
            </div>
            <button
              class="btn btn-join"
              :disabled="!(channelInputs[platform] ?? '').trim() || joiningChannel[platform]"
              @click="joinChannel(platform)"
            >
              {{ joiningChannel[platform] ? '…' : 'Join' }}
            </button>
          </div>

          <!-- Show auto-connected message for YouTube/Kick when authenticated -->
          <div
            v-else-if="account(platform) && (platform === 'youtube' || platform === 'kick')"
            class="auto-connected-info"
          >
            <span class="auto-connected-text">Connected to your channel</span>
          </div>
        </div>

        <!-- Stream editor: shown for Twitch/Kick when account is connected -->
        <StreamEditor
          v-if="account(platform) && (platform === 'twitch' || platform === 'kick')"
          :platform="platform"
          :channel-id="account(platform)!.platformUserId"
        />
      </div>
    </div>

    <!-- Toast notifications -->
    <Teleport to="body">
      <div class="toast-container">
        <TransitionGroup name="toast">
          <div
            v-for="toast in toasts"
            :key="toast.id"
            class="toast"
            :class="toast.type === 'success' ? 'toast-success' : 'toast-error'"
          >
            <div class="toast-icon">
              <svg
                v-if="toast.type === 'success'"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <svg
                v-else
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div class="toast-body">
              <span class="toast-platform">{{ toast.platform }}</span>
              <span class="toast-message">{{ toast.message }}</span>
            </div>
          </div>
        </TransitionGroup>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.platforms-panel {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.panel-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.panel-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--c-text, #e2e2e8);
  letter-spacing: -0.01em;
}

.panel-subtitle {
  font-size: 13px;
  color: var(--c-text-2, #8b8b99);
}

.platforms-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.platform-card {
  background: var(--c-surface, #18181b);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 14px;
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--c-border, #2a2a33);
}

.platform-logo {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.card-title-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.card-platform-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--c-text, #e2e2e8);
}

.card-status {
  display: flex;
  align-items: center;
  gap: 5px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-on {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
}
.dot-wait {
  background: #f59e0b;
}
.dot-err {
  background: #ef4444;
}
.dot-off {
  background: #4b5563;
}

.status-text {
  font-size: 12px;
  color: var(--c-text-2, #8b8b99);
}

/* Auth area */
.card-auth {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  min-width: 160px;
  justify-content: flex-end;
}

.account-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Avatar */
.account-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--platform-color, #a78bfa);
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--platform-color, #a78bfa);
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar-fallback {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  line-height: 1;
  mix-blend-mode: normal;
}

.account-details {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.account-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text, #e2e2e8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 110px;
}

.account-username {
  font-size: 11px;
  color: var(--c-text-2, #8b8b99);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 110px;
}

/* Transition for account connecting */
.account-slide-enter-active,
.account-slide-leave-active {
  transition: all 0.25s ease;
}
.account-slide-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.account-slide-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

/* Channels section */
.card-channels {
  padding: 14px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.channel-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.input-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--c-surface-2, #1f1f24);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.15s;
}
.input-wrapper:focus-within {
  border-color: #a78bfa;
}

.input-prefix {
  padding: 0 4px 0 12px;
  font-size: 14px;
  color: var(--c-text-2, #8b8b99);
  user-select: none;
}

.channel-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--c-text, #e2e2e8);
  font-size: 14px;
  padding: 8px 12px 8px 2px;
  font-family: inherit;
}
.channel-input::placeholder {
  color: var(--c-text-2, #8b8b99);
  opacity: 0.6;
}

.joined-channels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.channel-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: rgba(167, 139, 250, 0.12);
  color: #a78bfa;
  border: 1px solid rgba(167, 139, 250, 0.25);
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  padding: 3px 6px 3px 8px;
}

.chip-hash {
  opacity: 0.6;
}

.chip-remove {
  background: none;
  border: none;
  color: rgba(167, 139, 250, 0.6);
  cursor: pointer;
  padding: 0 2px;
  display: flex;
  align-items: center;
  border-radius: 50%;
  transition: color 0.15s;
}
.chip-remove:hover {
  color: #ef4444;
}

/* Buttons */
.btn {
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    opacity 0.15s,
    background 0.15s;
  font-family: inherit;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-sm {
  padding: 7px 14px;
}

.btn-primary {
  background: var(--btn-color, #a78bfa);
  color: var(--btn-text, #fff);
}
.btn-primary:not(:disabled):hover {
  opacity: 0.88;
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.06);
  color: var(--c-text-2, #8b8b99);
  border: 1px solid var(--c-border, #2a2a33);
}
.btn-ghost:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
}

.btn-join {
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
  border: 1px solid rgba(167, 139, 250, 0.3);
  padding: 8px 18px;
}
.btn-join:not(:disabled):hover {
  background: rgba(167, 139, 250, 0.25);
}

/* Auto-connected info */
.auto-connected-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.auto-connected-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.25);
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 8px 4px 10px;
}

.auto-connected-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
  padding: 1px 5px;
  border-radius: 10px;
  margin-left: 2px;
}

.auto-connected-text {
  font-size: 13px;
  color: var(--c-text-2, #8b8b99);
}

/* Spinner */
.spinner {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Toasts */
.toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 9999;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  min-width: 220px;
  max-width: 320px;
  backdrop-filter: blur(10px);
  pointer-events: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.toast-success {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #86efac;
}

.toast-error {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.toast-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.toast-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.toast-platform {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.7;
}

.toast-message {
  font-size: 13px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast-enter-active {
  transition: all 0.25s ease;
}
.toast-leave-active {
  transition: all 0.2s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
