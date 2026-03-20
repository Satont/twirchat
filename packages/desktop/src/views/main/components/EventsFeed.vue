<script setup lang="ts">
import type { NormalizedEvent } from "@twirchat/shared/types";

const props = defineProps<{
  events: NormalizedEvent[];
}>();

function eventIcon(type: NormalizedEvent["type"]): string {
  switch (type) {
    case "follow":
      return "follow";
    case "sub":
      return "sub";
    case "resub":
      return "sub";
    case "gift_sub":
      return "gift";
    case "raid":
      return "raid";
    case "host":
      return "host";
    case "bits":
      return "bits";
    case "superchat":
      return "superchat";
    case "membership":
      return "sub";
    default:
      return "bell";
  }
}

function eventLabel(type: NormalizedEvent["type"]): string {
  switch (type) {
    case "follow":
      return "Follow";
    case "sub":
      return "Subscription";
    case "resub":
      return "Re-subscription";
    case "gift_sub":
      return "Gift sub";
    case "raid":
      return "Raid";
    case "host":
      return "Host";
    case "bits":
      return "Bits";
    case "superchat":
      return "Super Chat";
    case "membership":
      return "Membership";
    default:
      return type;
  }
}

function eventColor(type: NormalizedEvent["type"]): string {
  switch (type) {
    case "follow":
      return "#22c55e";
    case "sub":
      return "#a78bfa";
    case "resub":
      return "#a78bfa";
    case "gift_sub":
      return "#f59e0b";
    case "raid":
      return "#3b82f6";
    case "host":
      return "#06b6d4";
    case "bits":
      return "#f59e0b";
    case "superchat":
      return "#ef4444";
    case "membership":
      return "#a78bfa";
    default:
      return "#8b8b99";
  }
}

function platformColor(platform: string): string {
  switch (platform) {
    case "twitch":
      return "#9146ff";
    case "youtube":
      return "#ff0000";
    case "kick":
      return "#53fc18";
    default:
      return "#888";
  }
}

function formatTime(ts: Date): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function eventDetail(ev: NormalizedEvent): string {
  const d = ev.data as Record<string, unknown>;
  switch (ev.type) {
    case "resub":
      return d.months ? `${d.months} months` : "";
    case "raid":
      return d.viewers ? `${d.viewers} viewers` : "";
    case "bits":
      return d.amount ? `${d.amount} bits` : "";
    case "gift_sub":
      return d.count ? `×${d.count}` : "";
    case "superchat":
      return d.amount ? String(d.amount) : "";
    default:
      return "";
  }
}
</script>

<template>
  <div class="events-panel">
    <div class="panel-header">
      <h2 class="panel-title">Events</h2>
      <span class="event-count" v-if="events.length > 0">{{
        events.length
      }}</span>
    </div>

    <div class="events-list">
      <div v-if="events.length === 0" class="empty-state">
        <div class="empty-icon">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            opacity=".35"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>
        <p class="empty-title">No events yet</p>
        <p class="empty-hint">
          Follows, subs, raids and bits will appear here.
        </p>
      </div>

      <div v-for="ev in events" :key="ev.id" class="event-card">
        <!-- Event type icon -->
        <div
          class="event-type-icon"
          :style="{
            background: eventColor(ev.type) + '22',
            color: eventColor(ev.type),
          }"
        >
          <!-- Follow -->
          <svg
            v-if="eventIcon(ev.type) === 'follow'"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path
              d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <!-- Sub / Membership -->
          <svg
            v-else-if="eventIcon(ev.type) === 'sub'"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polygon
              points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
            />
          </svg>
          <!-- Gift -->
          <svg
            v-else-if="eventIcon(ev.type) === 'gift'"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="20 12 20 22 4 22 4 12" />
            <rect x="2" y="7" width="20" height="5" />
            <line x1="12" y1="22" x2="12" y2="7" />
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
          </svg>
          <!-- Raid -->
          <svg
            v-else-if="eventIcon(ev.type) === 'raid'"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <!-- Host -->
          <svg
            v-else-if="eventIcon(ev.type) === 'host'"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polygon points="10 8 16 12 10 16 10 8" />
          </svg>
          <!-- Bits / Superchat -->
          <svg
            v-else-if="
              eventIcon(ev.type) === 'bits' ||
              eventIcon(ev.type) === 'superchat'
            "
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          <!-- Fallback bell -->
          <svg
            v-else
            width="16"
            height="16"
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
        </div>

        <!-- Event info -->
        <div class="event-info">
          <div class="event-top">
            <span class="event-user">{{ ev.user.displayName }}</span>
            <span
              class="event-type-label"
              :style="{ color: eventColor(ev.type) }"
              >{{ eventLabel(ev.type) }}</span
            >
            <span v-if="eventDetail(ev)" class="event-detail">{{
              eventDetail(ev)
            }}</span>
          </div>
          <div class="event-bottom">
            <span
              class="platform-chip"
              :style="{
                color: platformColor(ev.platform),
                borderColor: platformColor(ev.platform) + '44',
                background: platformColor(ev.platform) + '18',
              }"
              >{{ ev.platform }}</span
            >
            <span class="event-time">{{ formatTime(ev.timestamp) }}</span>
          </div>
        </div>

        <!-- Avatar -->
        <img
          v-if="ev.user.avatarUrl"
          class="event-avatar"
          :src="ev.user.avatarUrl"
          :alt="ev.user.displayName"
        />
        <div v-else class="event-avatar event-avatar-fallback">
          {{ ev.user.displayName[0] }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.events-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--c-border, #2a2a33);
  flex-shrink: 0;
}

.panel-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--c-text-2, #8b8b99);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.event-count {
  font-size: 11px;
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
  border-radius: 10px;
  padding: 1px 7px;
  font-weight: 700;
}

.events-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Empty */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px 32px;
  text-align: center;
}

.empty-icon {
  color: var(--c-text-2, #8b8b99);
  margin-bottom: 4px;
}
.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text, #e2e2e8);
}
.empty-hint {
  font-size: 13px;
  color: var(--c-text-2, #8b8b99);
  max-width: 280px;
  line-height: 1.5;
}

/* Event card */
.event-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--c-surface, #18181b);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 10px;
  padding: 10px 14px;
  transition: background 0.1s;
}

.event-card:hover {
  background: var(--c-surface-2, #1f1f24);
}

.event-type-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.event-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.event-top {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.event-user {
  font-size: 14px;
  font-weight: 700;
  color: var(--c-text, #e2e2e8);
}

.event-type-label {
  font-size: 12px;
  font-weight: 600;
}

.event-detail {
  font-size: 12px;
  color: var(--c-text-2, #8b8b99);
}

.event-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
}

.platform-chip {
  font-size: 10px;
  font-weight: 600;
  text-transform: capitalize;
  border: 1px solid;
  border-radius: 4px;
  padding: 1px 5px;
}

.event-time {
  font-size: 11px;
  color: var(--c-text-2, #8b8b99);
}

.event-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.event-avatar-fallback {
  background: #2a2a33;
  color: var(--c-text-2, #8b8b99);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
}
</style>
