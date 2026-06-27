<script setup lang="ts">
import type { NormalizedChatMessage } from "@twirchat/shared";

import { platformColor } from "../../shared/utils/platform";

defineProps<{
    message: NormalizedChatMessage;
}>();

function formatTimestamp(timestamp: Date): string {
    return new Date(timestamp).toLocaleString([], {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
    });
}
</script>

<template>
    <article class="history-message">
        <span
            class="history-message-stripe"
            :style="{ background: platformColor(message.platform) }"
        />

        <div class="history-message-main">
            <div class="history-message-meta">
                <span class="history-message-time">{{
                    formatTimestamp(message.timestamp)
                }}</span>
                <span class="history-message-channel">{{
                    message.channelId
                }}</span>
                <span
                    class="history-message-type"
                    :class="`type-${message.type}`"
                    >{{ message.type }}</span
                >
            </div>

            <div class="history-message-body">
                <span
                    class="history-message-author"
                    :style="
                        message.author.color
                            ? { color: message.author.color }
                            : {}
                    "
                >
                    {{ message.author.displayName }}
                </span>
                <span class="history-message-text">{{ message.text }}</span>
            </div>
        </div>
    </article>
</template>

<style scoped>
.history-message {
    display: grid;
    grid-template-columns: 3px minmax(0, 1fr);
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.history-message-stripe {
    border-radius: 999px;
    min-height: 100%;
}

.history-message-main {
    min-width: 0;
}

.history-message-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 4px;
    font-size: 11px;
    color: var(--c-text-2, #8b8b99);
}

.history-message-channel,
.history-message-type {
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
}

.type-action {
    color: #7dd3fc;
}

.type-system {
    color: #fbbf24;
}

.history-message-body {
    display: flex;
    gap: 6px;
    min-width: 0;
    line-height: 1.4;
    font-size: 13px;
}

.history-message-author {
    flex-shrink: 0;
    font-weight: 700;
}

.history-message-text {
    color: var(--c-text, #e2e2e8);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
</style>
