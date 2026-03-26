<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import PlatformsPanel from "./components/PlatformsPanel.vue";
import ChatList from "./components/ChatList.vue";
import EventsFeed from "./components/EventsFeed.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import { rpc } from "./main";
import type {
  NormalizedChatMessage,
  NormalizedEvent,
  PlatformStatusInfo,
  Account,
  AppSettings,
} from "@twirchat/shared/types";

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------

const messages = ref<NormalizedChatMessage[]>([]);
const events = ref<NormalizedEvent[]>([]);
const statuses = ref<Map<string, PlatformStatusInfo>>(new Map());
const accounts = ref<Account[]>([]);
const settings = ref<AppSettings | null>(null);
const activeTab = ref<"chat" | "events" | "platforms" | "settings">("chat");
const unreadEvents = ref(0);

const connectedAccountsCount = computed(() => accounts.value.length);

// ----------------------------------------------------------------
// Load initial data
// ----------------------------------------------------------------

async function loadInitialData() {
  try {
    const [accs, setts, statList] = await Promise.all([
      rpc.request.getAccounts(),
      rpc.request.getSettings(),
      rpc.request.getStatuses(),
    ]);
    if (accs !== undefined) accounts.value = accs;
    if (setts !== undefined) settings.value = setts;
    if (statList !== undefined) {
      const map = new Map<string, PlatformStatusInfo>();
      for (const s of statList) map.set(s.platform, s);
      statuses.value = map;
    }
  } catch (err) {
    console.warn("[App] Initial data load failed, retrying in 1s...", err);
    setTimeout(loadInitialData, 1000);
  }
}

onMounted(() => {
  loadInitialData();
});

// ----------------------------------------------------------------
// RPC listeners
// ----------------------------------------------------------------

const unsubscribers: Array<() => void> = [];

onMounted(() => {
  const onChatMessage = (msg: NormalizedChatMessage) => {
    messages.value = [msg, ...messages.value].slice(0, 500);
  };
  const onChatEvent = (ev: NormalizedEvent) => {
    events.value = [ev, ...events.value].slice(0, 200);
    if (activeTab.value !== "events") unreadEvents.value++;
  };
  const onPlatformStatus = (s: PlatformStatusInfo) => {
    statuses.value = new Map(statuses.value).set(s.platform, s);
  };
  const onAuthSuccess = ({ platform, displayName }: { platform: string; username: string; displayName: string }) => {
    console.log(`[Auth] Authenticated as ${displayName} on ${platform}`);
    rpc.request.getAccounts().then((a) => {
      accounts.value = a;
    });
  };
  const onAuthError = ({ platform, error }: { platform: string; error: string }) => {
    console.error(`[Auth] Error on ${platform}: ${error}`);
  };

  rpc.addMessageListener("chat_message", onChatMessage);
  rpc.addMessageListener("chat_event", onChatEvent);
  rpc.addMessageListener("platform_status", onPlatformStatus);
  rpc.addMessageListener("auth_success", onAuthSuccess);
  rpc.addMessageListener("auth_error", onAuthError);

  unsubscribers.push(
    () => rpc.removeMessageListener("chat_message", onChatMessage),
    () => rpc.removeMessageListener("chat_event", onChatEvent),
    () => rpc.removeMessageListener("platform_status", onPlatformStatus),
    () => rpc.removeMessageListener("auth_success", onAuthSuccess),
    () => rpc.removeMessageListener("auth_error", onAuthError),
  );
});

onUnmounted(() => {
  unsubscribers.forEach((unsub) => unsub());
});

function switchTab(tab: typeof activeTab.value) {
  activeTab.value = tab;
  if (tab === "events") unreadEvents.value = 0;
}

function onSettingsSaved(s: AppSettings) {
  settings.value = s;
}

function onSettingsChange(s: AppSettings) {
  settings.value = s;
}
</script>

<template>
  <div class="app" :class="settings?.theme ?? 'dark'">
    <!-- Left icon navigation -->
    <nav class="nav-rail">
      <div class="nav-logo">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect
            x="2"
            y="3"
            width="20"
            height="14"
            rx="3"
            fill="currentColor"
            opacity=".9"
          />
          <path
            d="M7 21h10M12 17v4"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </div>

      <div class="nav-items">
        <button
          class="nav-item"
          :class="{ active: activeTab === 'chat' }"
          title="Chat"
          @click="switchTab('chat')"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
            />
          </svg>
          <span class="nav-label">Chat</span>
        </button>

        <button
          class="nav-item"
          :class="{ active: activeTab === 'events' }"
          title="Events"
          @click="switchTab('events')"
        >
          <div class="nav-item-inner">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span v-if="unreadEvents > 0" class="badge">{{
              unreadEvents > 99 ? "99+" : unreadEvents
            }}</span>
          </div>
          <span class="nav-label">Events</span>
        </button>

        <button
          class="nav-item"
          :class="{ active: activeTab === 'platforms' }"
          title="Platforms"
          @click="switchTab('platforms')"
        >
          <div class="nav-item-inner">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path
                d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
              />
            </svg>
            <span v-if="connectedAccountsCount > 0" class="badge badge-green">
              {{ connectedAccountsCount }}
            </span>
          </div>
          <span class="nav-label">Platforms</span>
        </button>

        <button
          class="nav-item"
          :class="{ active: activeTab === 'settings' }"
          title="Settings"
          @click="switchTab('settings')"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
          <span class="nav-label">Settings</span>
        </button>
      </div>
    </nav>

    <!-- Main content area -->
    <main class="content">
      <ChatList
        v-show="activeTab === 'chat'"
        :messages="messages"
        :settings="settings"
        :accounts="accounts"
        :statuses="statuses"
        @go-to-platforms="switchTab('platforms')"
        @settings-change="onSettingsChange"
      />

      <EventsFeed v-show="activeTab === 'events'" :events="events" />

      <PlatformsPanel
        v-show="activeTab === 'platforms'"
        :accounts="accounts"
        :statuses="statuses"
        @accounts-updated="accounts = $event"
      />

      <SettingsPanel
        v-show="activeTab === 'settings'"
        :settings="settings"
        @saved="onSettingsSaved"
        @change="onSettingsChange"
      />
    </main>
  </div>
</template>

<style>
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #0f0f11;
  color: #e2e2e8;
  height: 100vh;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.22);
}
</style>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #0f0f11;
  color: #e2e2e8;
}

/* Light theme overrides */
.app.light {
  --c-bg: #f4f4f7;
  --c-surface: #ffffff;
  --c-surface-2: #ebebef;
  --c-border: #dddde3;
  --c-text: #18181b;
  --c-text-2: #71717a;
  --c-nav-bg: #18181b;
  --c-nav-text: rgba(255, 255, 255, 0.6);
  --c-nav-active: #fff;
  background: var(--c-bg);
  color: var(--c-text);
}

.app.dark {
  --c-bg: #0f0f11;
  --c-surface: #18181b;
  --c-surface-2: #1f1f24;
  --c-border: #2a2a33;
  --c-text: #e2e2e8;
  --c-text-2: #8b8b99;
  --c-nav-bg: #111114;
  --c-nav-text: rgba(255, 255, 255, 0.45);
  --c-nav-active: #fff;
}

/* ---- Nav rail ---- */
.nav-rail {
  width: 68px;
  flex-shrink: 0;
  background: var(--c-nav-bg, #111114);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0 16px;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  gap: 4px;
}

.nav-logo {
  color: #a78bfa;
  margin-bottom: 12px;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 0 8px;
  flex: 1;
}

.nav-item {
  background: none;
  border: none;
  color: var(--c-nav-text, rgba(255, 255, 255, 0.45));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px 4px;
  border-radius: 10px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
  width: 100%;
  position: relative;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.8);
}

.nav-item.active {
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
}

.nav-item-inner {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.badge {
  position: absolute;
  top: -6px;
  right: -8px;
  background: #ef4444;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  border-radius: 10px;
  padding: 1px 4px;
  min-width: 16px;
  text-align: center;
  line-height: 14px;
}

.badge-green {
  background: #22c55e;
}

/* ---- Content area ---- */
.content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--c-bg, #0f0f11);
}
</style>
