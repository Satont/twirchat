<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import {
    DialogContent,
    DialogOverlay,
    DialogPortal,
    DialogRoot,
} from "reka-ui";
import type { Platform } from "@twirchat/shared";

import KickIcon from "../../../assets/icons/platforms/kick.svg";
import TwitchIcon from "../../../assets/icons/platforms/twitch.svg";
import YoutubeIcon from "../../../assets/icons/platforms/youtube.svg";
import { platformColor } from "../../shared/utils/platform";
import { useUserCardMetadata } from "../composables/useUserCardMetadata";
import { useAliasStore } from "../stores/useAliasStore";
import UserChatHistoryPanel from "./UserChatHistoryPanel.vue";

interface Props {
    platform: Platform;
    platformUserId: string;
    channelId?: string;
    channelSlug?: string;
    displayName: string;
    username?: string;
    avatarUrl?: string;
    currentAlias?: string;
}

const props = defineProps<Props>();
const open = defineModel<boolean>("open", { required: true });

const aliasStore = useAliasStore();
const aliasValue = ref("");
const aliasInput = ref<HTMLInputElement | null>(null);
const platformRef = toRef(props, "platform");
const platformUserIdRef = toRef(props, "platformUserId");
const usernameRef = toRef(props, "username");
const channelIdRef = toRef(props, "channelId");
const channelSlugRef = toRef(props, "channelSlug");

const { metadata, loading, error, reload, supportedByCard } =
    useUserCardMetadata(
        platformRef,
        platformUserIdRef,
        usernameRef,
        channelIdRef,
        channelSlugRef,
        open,
    );

watch(
    open,
    (isOpen) => {
        if (isOpen) {
            aliasValue.value = props.currentAlias ?? "";
        }
    },
    { immediate: true },
);

const platformIcon = computed(() => {
    if (props.platform === "twitch") return TwitchIcon;
    if (props.platform === "kick") return KickIcon;
    return YoutubeIcon;
});

const titleHandle = computed(() => props.username ?? props.platformUserId);

function formatAbsoluteDate(value: string | null | undefined): string | null {
    if (!value) return null;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toLocaleDateString();
}

function addCalendarMonths(date: Date, months: number): Date {
    const result = new Date(date);
    const day = result.getDate();

    result.setDate(1);
    result.setMonth(result.getMonth() + months);

    const lastDayOfTargetMonth = new Date(
        result.getFullYear(),
        result.getMonth() + 1,
        0,
    ).getDate();
    result.setDate(Math.min(day, lastDayOfTargetMonth));

    return result;
}

function formatDurationPart(value: number, unit: string): string {
    return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

function formatElapsedDuration(
    value: string | null | undefined,
): string | null {
    if (!value) return null;

    const start = new Date(value);
    if (Number.isNaN(start.getTime())) {
        return null;
    }

    const end = new Date();
    if (start > end) {
        return "0 seconds";
    }

    const totalMonths = Math.max(
        0,
        (end.getFullYear() - start.getFullYear()) * 12 +
            end.getMonth() -
            start.getMonth(),
    );

    let monthsSinceStart = totalMonths;
    while (
        monthsSinceStart > 0 &&
        addCalendarMonths(start, monthsSinceStart) > end
    ) {
        monthsSinceStart -= 1;
    }

    const years = Math.floor(monthsSinceStart / 12);
    const months = monthsSinceStart % 12;
    const afterMonths = addCalendarMonths(start, monthsSinceStart);

    let remainingMilliseconds = Math.max(
        0,
        end.getTime() - afterMonths.getTime(),
    );

    const dayInMs = 24 * 60 * 60 * 1000;
    const hourInMs = 60 * 60 * 1000;
    const minuteInMs = 60 * 1000;
    const secondInMs = 1000;

    const days = Math.floor(remainingMilliseconds / dayInMs);
    remainingMilliseconds -= days * dayInMs;

    const hours = Math.floor(remainingMilliseconds / hourInMs);
    remainingMilliseconds -= hours * hourInMs;

    const minutes = Math.floor(remainingMilliseconds / minuteInMs);
    remainingMilliseconds -= minutes * minuteInMs;

    const seconds = Math.floor(remainingMilliseconds / secondInMs);

    const parts = [
        years > 0 ? formatDurationPart(years, "year") : null,
        months > 0 ? formatDurationPart(months, "month") : null,
        days > 0 ? formatDurationPart(days, "day") : null,
        hours > 0 ? formatDurationPart(hours, "hour") : null,
        minutes > 0 ? formatDurationPart(minutes, "minute") : null,
        seconds > 0 ? formatDurationPart(seconds, "second") : null,
    ].filter((part): part is string => part !== null);

    return parts.join(" ") || "0 seconds";
}

const accountAgeText = computed(() => {
    const field = metadata.value?.accountAge;
    if (!field) return null;

    if (field.status === "available") {
        return `Created ${formatAbsoluteDate(field.createdAt) ?? field.createdAt}`;
    }

    return field.message ?? "Unavailable";
});

const followAgeText = computed(() => {
    const field = metadata.value?.followAge;
    if (!field) return null;

    if (field.status === "available") {
        const absoluteDate =
            formatAbsoluteDate(field.followedAt) ?? field.followedAt;
        const elapsedDuration = formatElapsedDuration(field.followedAt);

        return elapsedDuration
            ? `Following since ${absoluteDate} · ${elapsedDuration}`
            : `Following since ${absoluteDate}`;
    }

    return field.message ?? "Unavailable";
});

const subscriptionDurationText = computed(() => {
    const field = metadata.value?.subscriptionDuration;
    if (!field) return null;

    if (field.status === "available") {
        if (field.currentlySubscribed === true) {
            const parts = ["Currently subscribed"];

            if (field.tier) {
                parts.push(`Tier ${field.tier}`);
            }

            if (field.isGift) {
                parts.push(
                    field.gifterDisplayName
                        ? `Gifted by ${field.gifterDisplayName}`
                        : "Gifted sub",
                );
            }

            if (field.message) {
                parts.push(field.message);
            }

            return parts.join(" · ");
        }

        return field.message ?? "Not currently subscribed";
    }

    return field.message ?? "Unavailable";
});

const subAgeText = computed(() => {
    const field = metadata.value?.subAge;
    if (!field) return null;

    if (field.status === "available" && field.months !== null) {
        return `${field.months} month${field.months === 1 ? "" : "s"}`;
    }

    return field.message ?? "Unavailable";
});

function focusInput() {
    aliasInput.value?.focus();
}

async function handleSaveAlias() {
    const val = aliasValue.value.trim();
    if (!val) {
        await aliasStore.removeAlias(props.platform, props.platformUserId);
    } else {
        await aliasStore.setAlias(props.platform, props.platformUserId, val);
    }
    open.value = false;
}

async function handleRemoveAlias() {
    await aliasStore.removeAlias(props.platform, props.platformUserId);
    aliasValue.value = "";
    open.value = false;
}

function initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
}
</script>

<template>
    <DialogRoot v-model:open="open">
        <DialogPortal>
            <DialogOverlay class="dialog-overlay" />
            <DialogContent class="dialog-content" @open-auto-focus="focusInput">
                <div
                    class="user-card-header"
                    :style="{ '--platform-color': platformColor(platform) }"
                >
                    <div class="user-card-avatar-wrap">
                        <img
                            v-if="avatarUrl"
                            :src="avatarUrl"
                            :alt="displayName"
                            class="user-card-avatar"
                            referrerpolicy="no-referrer"
                        />
                        <div
                            v-else
                            class="user-card-avatar user-card-avatar-fallback"
                        >
                            {{ initials(displayName) }}
                        </div>
                    </div>

                    <div class="user-card-header-main">
                        <div class="user-card-title-row">
                            <h3 class="dialog-title">{{ displayName }}</h3>
                            <component
                                :is="platformIcon"
                                class="user-card-platform-icon"
                            />
                        </div>
                        <p class="user-card-subtitle">{{ titleHandle }}</p>
                        <div class="user-card-badges-row">
                            <span class="user-card-pill">{{ platform }}</span>
                            <span
                                v-if="currentAlias"
                                class="user-card-pill user-card-pill-accent"
                            >
                                Alias: {{ currentAlias }}
                            </span>
                        </div>
                    </div>
                </div>

                <div class="user-card-section">
                    <label class="dialog-label" for="user-alias-input"
                        >Display alias</label
                    >
                    <p class="dialog-description">
                        Replaces the displayed name in chat. Leave empty to
                        remove alias.
                    </p>
                    <div class="user-card-alias-row">
                        <input
                            id="user-alias-input"
                            ref="aliasInput"
                            v-model="aliasValue"
                            class="dialog-input"
                            :placeholder="displayName"
                            maxlength="50"
                            @keydown.enter.prevent="handleSaveAlias"
                            @keydown.escape.prevent="open = false"
                        />
                        <button
                            class="dialog-btn-save"
                            @click="handleSaveAlias"
                        >
                            Save
                        </button>
                    </div>
                    <div class="dialog-actions dialog-actions-inline">
                        <button class="dialog-btn-cancel" @click="open = false">
                            Close
                        </button>
                        <button
                            v-if="currentAlias"
                            class="dialog-btn-danger"
                            @click="handleRemoveAlias"
                        >
                            Remove alias
                        </button>
                    </div>
                </div>

                <div class="user-card-section">
                    <div class="user-card-metadata-header">
                        <div>
                            <h4 class="user-card-metadata-title">
                                Account metadata
                            </h4>
                            <p class="dialog-description">
                                Fetched through the backend for this platform.
                            </p>
                        </div>

                        <button
                            v-if="supportedByCard"
                            class="user-card-metadata-refresh"
                            :disabled="loading"
                            @click="void reload()"
                        >
                            Refresh
                        </button>
                    </div>

                    <div
                        v-if="!supportedByCard"
                        class="user-card-metadata-state"
                    >
                        Metadata is not supported for this platform yet.
                    </div>
                    <div v-else-if="loading" class="user-card-metadata-state">
                        Loading metadata…
                    </div>
                    <div
                        v-else-if="error"
                        class="user-card-metadata-state user-card-metadata-state-error"
                    >
                        <span>{{ error }}</span>
                        <button
                            class="user-card-metadata-inline-btn"
                            @click="void reload()"
                        >
                            Retry
                        </button>
                    </div>
                    <dl v-else-if="metadata" class="user-card-metadata-list">
                        <div class="user-card-metadata-item">
                            <dt>Account age</dt>
                            <dd>{{ accountAgeText }}</dd>
                        </div>
                        <div class="user-card-metadata-item">
                            <dt>Follow age</dt>
                            <dd>{{ followAgeText }}</dd>
                        </div>
                        <div class="user-card-metadata-item">
                            <dt>Subscription duration</dt>
                            <dd>{{ subscriptionDurationText }}</dd>
                        </div>
                        <div class="user-card-metadata-item">
                            <dt>Sub age</dt>
                            <dd>{{ subAgeText }}</dd>
                        </div>
                    </dl>
                </div>

                <UserChatHistoryPanel
                    :open="open"
                    :platform="platform"
                    :platform-user-id="platformUserId"
                />
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
    max-width: 760px;
    padding: 20px;
    z-index: 2001;
    max-height: min(85vh, 820px);
    overflow: auto;
}

.dialog-title {
    margin: 0;
    font-size: 1.35em;
    color: var(--c-text, #e2e2e8);
}

.dialog-description {
    margin: 0;
    font-size: 0.9em;
    color: var(--c-text-2, #8b8b99);
}

.user-card-subtitle {
    margin: 0;
    font-size: 0.9em;
    color: rgba(255, 255, 255, 0.75);
}

.dialog-label {
    display: block;
    margin-bottom: 6px;
    font-size: 0.8em;
    font-weight: 700;
    color: var(--c-text, #e2e2e8);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.user-card-header {
    display: flex;
    gap: 16px;
    margin: -20px -20px 18px;
    padding: 20px;
    background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--platform-color) 72%, #101012) 0%,
        #1a1a22 100%
    );
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.user-card-avatar-wrap {
    flex-shrink: 0;
}

.user-card-avatar {
    width: 72px;
    height: 72px;
    border-radius: 18px;
    object-fit: cover;
    background: rgba(255, 255, 255, 0.08);
}

.user-card-avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 24px;
    color: white;
}

.user-card-header-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.user-card-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.user-card-platform-icon {
    width: 18px;
    height: 18px;
    color: rgba(255, 255, 255, 0.95);
}

.user-card-badges-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.user-card-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    padding: 0 10px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.25);
    color: white;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
}

.user-card-pill-accent {
    background: rgba(255, 255, 255, 0.16);
}

.user-card-section {
    margin-bottom: 18px;
}

.user-card-alias-row {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 12px;
}

.user-card-metadata-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
}

.user-card-metadata-title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--c-text, #e2e2e8);
}

.user-card-metadata-refresh,
.user-card-metadata-inline-btn {
    border: none;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--c-text, #e2e2e8);
    cursor: pointer;
    font: inherit;
}

.user-card-metadata-refresh {
    padding: 7px 10px;
    font-size: 12px;
}

.user-card-metadata-inline-btn {
    padding: 6px 10px;
    font-size: 12px;
}

.user-card-metadata-refresh:disabled,
.user-card-metadata-inline-btn:disabled {
    opacity: 0.6;
    cursor: default;
}

.user-card-metadata-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 96px;
    padding: 16px;
    text-align: center;
    font-size: 13px;
    color: var(--c-text-2, #8b8b99);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.16);
}

.user-card-metadata-state-error {
    color: #fca5a5;
    flex-direction: column;
}

.user-card-metadata-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
    margin: 0;
}

.user-card-metadata-item {
    min-width: 0;
    padding: 12px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.16);
}

.user-card-metadata-item dt {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 700;
    color: var(--c-text-2, #8b8b99);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.user-card-metadata-item dd {
    margin: 0;
    font-size: 13px;
    color: var(--c-text, #e2e2e8);
    line-height: 1.45;
    overflow-wrap: anywhere;
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

.dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
}

.dialog-actions-inline {
    margin-top: 12px;
    justify-content: space-between;
}

.dialog-btn-cancel,
.dialog-btn-save,
.dialog-btn-danger {
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    border: none;
    font-weight: 500;
    font-size: 0.9em;
}

.dialog-btn-cancel {
    background: transparent;
    color: var(--c-text, #e2e2e8);
}

.dialog-btn-cancel:hover {
    background: rgba(255, 255, 255, 0.08);
}

.dialog-btn-save {
    background: var(--c-accent, #9147ff);
    color: #fff;
    flex-shrink: 0;
}

.dialog-btn-save:hover {
    opacity: 0.9;
}

.dialog-btn-danger {
    background: rgba(255, 80, 80, 0.14);
    color: #ff9b9b;
}

.dialog-btn-danger:hover {
    background: rgba(255, 80, 80, 0.2);
}
</style>
