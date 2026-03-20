<script setup lang="ts">
import type { Account, PlatformStatusInfo } from "@chatrix/shared/types";
import { rpc } from "../main";

const props = defineProps<{
  accounts: Account[];
  statuses: Map<string, PlatformStatusInfo>;
  activeTab: "chat" | "events" | "settings";
}>();

const emit = defineEmits<{
  "tab-change": [tab: "chat" | "events" | "settings"];
}>();

function platformColor(platform: string): string {
  switch (platform) {
    case "twitch": return "#9146ff";
    case "youtube": return "#ff0000";
    case "kick": return "#53fc18";
    default: return "#888";
  }
}

function statusIcon(status?: string): string {
  switch (status) {
    case "connected": return "●";
    case "connecting": return "◌";
    case "error": return "✕";
    default: return "○";
  }
}

function statusColor(status?: string): string {
  switch (status) {
    case "connected": return "#4caf50";
    case "connecting": return "#ff9800";
    case "error": return "#f44336";
    default: return "#666";
  }
}

async function startAuth(platform: "twitch" | "youtube" | "kick") {
  await rpc.send.authStart({ platform });
}

async function logout(platform: "twitch" | "youtube" | "kick") {
  await rpc.send.authLogout({ platform });
}
</script>

<template>
  <aside class="sidebar">
    <!-- Logo -->
    <div class="logo">Chatrix</div>

    <!-- Navigation -->
    <nav class="nav">
      <button
        class="nav-btn"
        :class="{ active: activeTab === 'chat' }"
        @click="emit('tab-change', 'chat')"
      >
        💬 Chat
      </button>
      <button
        class="nav-btn"
        :class="{ active: activeTab === 'events' }"
        @click="emit('tab-change', 'events')"
      >
        🔔 Events
      </button>
      <button
        class="nav-btn"
        :class="{ active: activeTab === 'settings' }"
        @click="emit('tab-change', 'settings')"
      >
        ⚙️ Settings
      </button>
    </nav>

    <!-- Accounts / Platform status -->
    <div class="accounts">
      <div class="section-label">Platforms</div>

      <div
        v-for="platform in (['twitch', 'youtube', 'kick'] as const)"
        :key="platform"
        class="platform-row"
      >
        <span
          class="platform-icon"
          :style="{ color: platformColor(platform) }"
        >{{ platform[0].toUpperCase() }}</span>

        <div class="platform-info">
          <span class="platform-name">{{ platform }}</span>
          <span
            class="platform-status"
            :style="{ color: statusColor(statuses.get(platform)?.status) }"
          >
            {{ statusIcon(statuses.get(platform)?.status) }}
            {{ statuses.get(platform)?.status ?? 'disconnected' }}
          </span>
        </div>

        <div class="platform-actions">
          <template v-if="accounts.find(a => a.platform === platform)">
            <button class="btn-small btn-danger" @click="logout(platform)">
              Logout
            </button>
          </template>
          <template v-else>
            <button class="btn-small btn-primary" @click="startAuth(platform)">
              Connect
            </button>
          </template>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: #111;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #333;
  overflow: hidden;
}

.logo {
  padding: 16px;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  border-bottom: 1px solid #333;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
}

.nav-btn {
  background: none;
  border: none;
  color: #aaa;
  text-align: left;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.nav-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.nav-btn.active {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-weight: 600;
}

.accounts {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  border-top: 1px solid #333;
  margin-top: 8px;
}

.section-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: #666;
  letter-spacing: 0.08em;
  padding: 4px 4px 8px;
}

.platform-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-radius: 6px;
}

.platform-icon {
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
  width: 20px;
  text-align: center;
}

.platform-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.platform-name {
  font-size: 12px;
  font-weight: 600;
  color: #ddd;
  text-transform: capitalize;
}

.platform-status {
  font-size: 10px;
  text-transform: capitalize;
}

.platform-actions {
  flex-shrink: 0;
}

.btn-small {
  font-size: 10px;
  padding: 3px 7px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-weight: 600;
  transition: opacity 0.15s;
}

.btn-small:hover {
  opacity: 0.85;
}

.btn-primary {
  background: #9146ff;
  color: #fff;
}

.btn-danger {
  background: #c0392b;
  color: #fff;
}
</style>
