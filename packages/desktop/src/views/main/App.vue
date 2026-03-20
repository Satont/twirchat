<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import Sidebar from "./components/Sidebar.vue";
import ChatList from "./components/ChatList.vue";
import { rpc } from "./main";
import type { NormalizedChatMessage, NormalizedEvent, PlatformStatusInfo, Account, AppSettings } from "@chatrix/shared/types";

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------

const messages = ref<NormalizedChatMessage[]>([]);
const events = ref<NormalizedEvent[]>([]);
const statuses = ref<Map<string, PlatformStatusInfo>>(new Map());
const accounts = ref<Account[]>([]);
const settings = ref<AppSettings | null>(null);
const activeTab = ref<"chat" | "events" | "settings">("chat");

// ----------------------------------------------------------------
// Load initial data
// ----------------------------------------------------------------

onMounted(async () => {
  [accounts.value, settings.value] = await Promise.all([
    rpc.send.getAccounts(),
    rpc.send.getSettings(),
  ]);
});

// ----------------------------------------------------------------
// Listen for incoming messages from Bun
// ----------------------------------------------------------------

const unsubscribers: Array<() => void> = [];

onMounted(() => {
  unsubscribers.push(
    rpc.on.chat_message((msg) => {
      messages.value = [msg, ...messages.value].slice(0, 500);
    }),
    rpc.on.chat_event((ev) => {
      events.value = [ev, ...events.value].slice(0, 200);
    }),
    rpc.on.platform_status((s) => {
      statuses.value = new Map(statuses.value).set(s.platform, s);
    }),
    rpc.on.auth_url(({ platform, url }) => {
      console.log(`[Auth] Opening OAuth for ${platform}: ${url}`);
    }),
    rpc.on.auth_success(({ platform, displayName }) => {
      console.log(`[Auth] Authenticated as ${displayName} on ${platform}`);
      rpc.send.getAccounts().then((a) => {
        accounts.value = a;
      });
    }),
    rpc.on.auth_error(({ platform, error }) => {
      console.error(`[Auth] Error on ${platform}: ${error}`);
    }),
  );
});

onUnmounted(() => {
  unsubscribers.forEach((unsub) => unsub());
});
</script>

<template>
  <div class="app" :class="settings?.theme ?? 'dark'">
    <Sidebar
      :accounts="accounts"
      :statuses="statuses"
      :active-tab="activeTab"
      @tab-change="activeTab = $event"
    />

    <main class="content">
      <ChatList
        v-if="activeTab === 'chat'"
        :messages="messages"
        :settings="settings"
      />

      <section v-else-if="activeTab === 'events'" class="events-panel">
        <div v-for="ev in events" :key="ev.id" class="event-item">
          <span class="event-platform">{{ ev.platform }}</span>
          <span class="event-type">{{ ev.type }}</span>
          <span class="event-user">{{ ev.user.displayName }}</span>
        </div>
        <p v-if="events.length === 0" class="empty-state">No events yet.</p>
      </section>

      <section v-else-if="activeTab === 'settings'" class="settings-panel">
        <p class="empty-state">Settings panel — coming soon.</p>
      </section>
    </main>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #1a1a1a;
  color: #e0e0e0;
  height: 100vh;
  overflow: hidden;
}
</style>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.app.light {
  --bg: #f5f5f5;
  --bg-secondary: #e0e0e0;
  --text: #1a1a1a;
  --text-secondary: #555;
  --border: #ccc;
}

.app.dark {
  --bg: #1a1a1a;
  --bg-secondary: #2a2a2a;
  --text: #e0e0e0;
  --text-secondary: #aaa;
  --border: #333;
}

.content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg, #1a1a1a);
  color: var(--text, #e0e0e0);
}

.events-panel,
.settings-panel {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.event-item {
  display: flex;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--border, #333);
  font-size: 13px;
}

.event-platform {
  font-weight: 600;
  text-transform: capitalize;
  color: var(--text-secondary, #aaa);
}

.event-type {
  color: #9b59b6;
  font-weight: 600;
}

.empty-state {
  color: var(--text-secondary, #aaa);
  text-align: center;
  padding: 40px;
  font-size: 14px;
}
</style>
