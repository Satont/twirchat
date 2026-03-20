<script setup lang="ts">
import { ref, computed } from "vue";
import type {
  Account,
  PlatformStatusInfo,
  Platform,
} from "@twirchat/shared/types";
import { rpc } from "../main";

const props = defineProps<{
  accounts: Account[];
  statuses: Map<string, PlatformStatusInfo>;
}>();

const emit = defineEmits<{
  "accounts-updated": [accounts: Account[]];
}>();

// Per-platform channel input state
const channelInputs = ref<Record<string, string>>({
  twitch: "",
  youtube: "",
  kick: "",
});
const joiningChannel = ref<Record<string, boolean>>({});
const authLoading = ref<Record<string, boolean>>({});
const joinedChannels = ref<Record<string, string[]>>({
  twitch: [],
  youtube: [],
  kick: [],
});

const platforms: Platform[] = ["twitch", "youtube", "kick"];

function account(platform: Platform): Account | undefined {
  return props.accounts.find((a) => a.platform === platform);
}

function status(platform: Platform): PlatformStatusInfo | undefined {
  return props.statuses.get(platform);
}

function platformMeta(platform: Platform) {
  switch (platform) {
    case "twitch":
      return { label: "Twitch", color: "#9146ff", textColor: "#fff" };
    case "youtube":
      return { label: "YouTube", color: "#ff0000", textColor: "#fff" };
    case "kick":
      return { label: "Kick", color: "#53fc18", textColor: "#000" };
  }
}

function statusLabel(s?: PlatformStatusInfo): string {
  if (!s) return "Not connected";
  switch (s.status) {
    case "connected":
      return s.mode === "authenticated" ? "Connected" : "Connected (anonymous)";
    case "connecting":
      return "Connecting…";
    case "error":
      return s.error ?? "Error";
    default:
      return "Disconnected";
  }
}

function statusClass(s?: PlatformStatusInfo): string {
  if (!s) return "dot-off";
  switch (s.status) {
    case "connected":
      return "dot-on";
    case "connecting":
      return "dot-wait";
    case "error":
      return "dot-err";
    default:
      return "dot-off";
  }
}

async function startAuth(platform: Platform) {
  authLoading.value[platform] = true;
  try {
    await rpc.send.authStart({ platform });
  } finally {
    authLoading.value[platform] = false;
  }
}

async function logout(platform: Platform) {
  await rpc.send.authLogout({ platform });
  const updated = await rpc.send.getAccounts();
  emit("accounts-updated", updated);
}

async function joinChannel(platform: Platform) {
  const slug = channelInputs.value[platform].trim();
  if (!slug) return;
  joiningChannel.value[platform] = true;
  try {
    await rpc.send.joinChannel({ platform, channelSlug: slug });
    if (!joinedChannels.value[platform].includes(slug)) {
      joinedChannels.value[platform] = [
        ...joinedChannels.value[platform],
        slug,
      ];
    }
    channelInputs.value[platform] = "";
  } finally {
    joiningChannel.value[platform] = false;
  }
}

async function leaveChannel(platform: Platform, slug: string) {
  await rpc.send.leaveChannel({ platform, channelSlug: slug });
  joinedChannels.value[platform] = joinedChannels.value[platform].filter(
    (c) => c !== slug,
  );
}

function onInputKeydown(e: KeyboardEvent, platform: Platform) {
  if (e.key === "Enter") joinChannel(platform);
}
</script>

<template>
  <div class="platforms-panel">
    <div class="panel-header">
      <h2 class="panel-title">Platforms</h2>
      <p class="panel-subtitle">
        Connect your streaming accounts and join channels
      </p>
    </div>

    <div class="platforms-list">
      <div v-for="platform in platforms" :key="platform" class="platform-card">
        <!-- Card header -->
        <div class="card-header">
          <div
            class="platform-logo"
            :style="{ background: platformMeta(platform).color }"
          >
            <!-- Twitch -->
            <svg
              v-if="platform === 'twitch'"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="white"
            >
              <path
                d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"
              />
            </svg>
            <!-- YouTube -->
            <svg
              v-else-if="platform === 'youtube'"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="white"
            >
              <path
                d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
              />
            </svg>
            <!-- Kick -->
            <svg
              v-else-if="platform === 'kick'"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="black"
            >
              <path d="M2 2h4v8l6-8h5l-7 9 7 11h-5l-6-9v9H2z" />
            </svg>
          </div>

          <div class="card-title-area">
            <div class="card-platform-name">
              {{ platformMeta(platform).label }}
            </div>
            <div class="card-status">
              <span class="status-dot" :class="statusClass(status(platform))" />
              <span class="status-text">{{
                statusLabel(status(platform))
              }}</span>
            </div>
          </div>

          <!-- Auth actions -->
          <div class="card-auth">
            <template v-if="account(platform)">
              <div class="account-info">
                <img
                  v-if="account(platform)?.avatarUrl"
                  class="account-avatar"
                  :src="account(platform)?.avatarUrl"
                  :alt="account(platform)?.displayName"
                />
                <span class="account-name">{{
                  account(platform)?.displayName
                }}</span>
              </div>
              <button class="btn btn-ghost btn-sm" @click="logout(platform)">
                Disconnect
              </button>
            </template>
            <template v-else>
              <button
                class="btn btn-primary btn-sm"
                :style="{
                  '--btn-color': platformMeta(platform).color,
                  '--btn-text': platformMeta(platform).textColor,
                }"
                :disabled="authLoading[platform]"
                @click="startAuth(platform)"
              >
                {{ authLoading[platform] ? "Opening…" : "Connect account" }}
              </button>
            </template>
          </div>
        </div>

        <!-- Channel join section -->
        <div class="card-channels">
          <div class="channel-input-row">
            <div class="input-wrapper">
              <span class="input-prefix">#</span>
              <input
                v-model="channelInputs[platform]"
                class="channel-input"
                :placeholder="
                  platform === 'youtube'
                    ? 'Channel ID or handle'
                    : 'channel name'
                "
                @keydown="onInputKeydown($event, platform)"
              />
            </div>
            <button
              class="btn btn-join"
              :disabled="
                !channelInputs[platform].trim() || joiningChannel[platform]
              "
              @click="joinChannel(platform)"
            >
              {{ joiningChannel[platform] ? "…" : "Join" }}
            </button>
          </div>

          <!-- Joined channels chips -->
          <div
            v-if="joinedChannels[platform].length > 0"
            class="joined-channels"
          >
            <div
              v-for="ch in joinedChannels[platform]"
              :key="ch"
              class="channel-chip"
            >
              <span class="chip-hash">#</span>{{ ch }}
              <button
                class="chip-remove"
                title="Leave channel"
                @click="leaveChannel(platform, ch)"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="currentColor"
                >
                  <path
                    d="M1 1l8 8M9 1l-8 8"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
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

.card-auth {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.account-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.account-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  object-fit: cover;
}

.account-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text, #e2e2e8);
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-sm {
  padding: 6px 14px;
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
</style>
