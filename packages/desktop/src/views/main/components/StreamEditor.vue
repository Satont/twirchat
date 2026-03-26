<script setup lang="ts">
/**
 * StreamEditor — shows stream status and lets the user edit title + category
 * for a connected Twitch or Kick account.
 *
 * Props:
 *   platform  — "twitch" | "kick"
 *   channelId — the numeric broadcaster ID (Twitch) or channel slug (Kick)
 *
 * On mount it polls for the current status. The user can then edit and save.
 */
import { ref, onMounted, onUnmounted } from "vue";
import type { CategorySearchResult } from "@twirchat/shared/protocol";
import { rpc } from "../main";

const props = defineProps<{
  platform: "twitch" | "kick";
  channelId: string;
}>();

// ---------------------------------------------------------------
// Stream status state
// ---------------------------------------------------------------
const isLive = ref(false);
const title = ref("");
const categoryId = ref<string | undefined>(undefined);
const categoryName = ref<string | undefined>(undefined);
const viewerCount = ref<number | undefined>(undefined);
const loadError = ref<string | null>(null);
const loading = ref(false);

// ---------------------------------------------------------------
// Edit state
// ---------------------------------------------------------------
const editing = ref(false);
const editTitle = ref("");
const editCategoryId = ref<string | undefined>(undefined);
const editCategoryName = ref<string | undefined>(undefined);
const saving = ref(false);
const saveError = ref<string | null>(null);
const saveSuccess = ref(false);

// ---------------------------------------------------------------
// Category search
// ---------------------------------------------------------------
const categoryQuery = ref("");
const categoryResults = ref<CategorySearchResult[]>([]);
const searchLoading = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

function onCategoryInput() {
  if (searchTimer) clearTimeout(searchTimer);
  if (!categoryQuery.value.trim()) {
    categoryResults.value = [];
    return;
  }
  searchTimer = setTimeout(async () => {
    searchLoading.value = true;
    try {
      const res = await rpc.request.searchCategories({
        platform: props.platform,
        query: categoryQuery.value,
      });
      categoryResults.value = res.categories;
    } catch {
      categoryResults.value = [];
    } finally {
      searchLoading.value = false;
    }
  }, 350);
}

function selectCategory(cat: CategorySearchResult) {
  editCategoryId.value = cat.id;
  editCategoryName.value = cat.name;
  categoryQuery.value = cat.name;
  categoryResults.value = [];
}

// ---------------------------------------------------------------
// Load current status
// ---------------------------------------------------------------
async function loadStatus() {
  loading.value = true;
  loadError.value = null;
  try {
    const s = await rpc.request.getStreamStatus({
      platform: props.platform,
      channelId: props.channelId,
    });
    isLive.value = s.isLive;
    title.value = s.title;
    categoryId.value = s.categoryId;
    categoryName.value = s.categoryName;
    viewerCount.value = s.viewerCount;
  } catch (e) {
    loadError.value = String(e);
  } finally {
    loading.value = false;
  }
}

// Poll every 60 seconds
let pollTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  void loadStatus();
  pollTimer = setInterval(() => void loadStatus(), 60_000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (searchTimer) clearTimeout(searchTimer);
});

// ---------------------------------------------------------------
// Edit / Save
// ---------------------------------------------------------------
function startEdit() {
  editTitle.value = title.value;
  editCategoryId.value = categoryId.value;
  editCategoryName.value = categoryName.value;
  categoryQuery.value = categoryName.value ?? "";
  categoryResults.value = [];
  saveError.value = null;
  saveSuccess.value = false;
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

async function save() {
  saving.value = true;
  saveError.value = null;
  try {
    await rpc.request.updateStream({
      platform: props.platform,
      channelId: props.channelId,
      title: editTitle.value,
      categoryId: editCategoryId.value,
    });
    // Reflect changes locally immediately
    title.value = editTitle.value;
    categoryId.value = editCategoryId.value;
    categoryName.value = editCategoryName.value;
    saveSuccess.value = true;
    setTimeout(() => {
      saveSuccess.value = false;
      editing.value = false;
    }, 1500);
  } catch (e) {
    saveError.value = String(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="stream-editor">
    <!-- Loading / error -->
    <div v-if="loading && !title" class="se-placeholder">Loading stream info…</div>
    <div v-else-if="loadError" class="se-placeholder se-error">{{ loadError }}</div>

    <!-- Status display (not editing) -->
    <template v-else-if="!editing">
      <div class="se-status-row">
        <span class="se-live-badge" :class="{ live: isLive }">
          {{ isLive ? 'LIVE' : 'OFFLINE' }}
        </span>
        <span v-if="isLive && viewerCount !== undefined" class="se-viewers">
          {{ viewerCount.toLocaleString() }} viewers
        </span>
        <button class="se-edit-btn" title="Edit stream info" @click="startEdit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Edit
        </button>
      </div>
      <div v-if="title" class="se-title">{{ title }}</div>
      <div v-if="categoryName" class="se-category">{{ categoryName }}</div>
    </template>

    <!-- Edit form -->
    <template v-else>
      <div class="se-form">
        <label class="se-label">Title</label>
        <input
          v-model="editTitle"
          class="se-input"
          maxlength="140"
          placeholder="Stream title…"
        />

        <label class="se-label">Category / Game</label>
        <div class="se-search-wrap">
          <input
            v-model="categoryQuery"
            class="se-input"
            placeholder="Search categories…"
            @input="onCategoryInput"
          />
          <div v-if="searchLoading" class="se-search-hint">Searching…</div>
          <ul v-else-if="categoryResults.length > 0" class="se-dropdown">
            <li
              v-for="cat in categoryResults"
              :key="cat.id"
              class="se-dropdown-item"
              @mousedown.prevent="selectCategory(cat)"
            >
              <img
                v-if="cat.thumbnailUrl"
                class="se-cat-thumb"
                :src="cat.thumbnailUrl"
                :alt="cat.name"
              />
              <span>{{ cat.name }}</span>
            </li>
          </ul>
        </div>

        <div v-if="saveError" class="se-save-error">{{ saveError }}</div>

        <div class="se-actions">
          <button class="se-btn se-btn-ghost" :disabled="saving" @click="cancelEdit">
            Cancel
          </button>
          <button class="se-btn se-btn-primary" :disabled="saving" @click="save">
            <svg v-if="saveSuccess" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            {{ saveSuccess ? 'Saved!' : saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stream-editor {
  padding: 12px 20px 14px;
  border-top: 1px solid var(--c-border, #2a2a33);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.se-placeholder {
  font-size: 12px;
  color: var(--c-text-2, #8b8b99);
}

.se-error {
  color: #ef4444;
}

/* Status row */
.se-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.se-live-badge {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--c-surface-2, #1f1f24);
  color: var(--c-text-2, #8b8b99);
  border: 1px solid var(--c-border, #2a2a33);
}

.se-live-badge.live {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.35);
}

.se-viewers {
  font-size: 12px;
  color: var(--c-text-2, #8b8b99);
}

.se-edit-btn {
  margin-left: auto;
  background: rgba(167, 139, 250, 0.1);
  color: #a78bfa;
  border: 1px solid rgba(167, 139, 250, 0.2);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: inherit;
  transition: background 0.15s;
}
.se-edit-btn:hover {
  background: rgba(167, 139, 250, 0.2);
}

.se-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text, #e2e2e8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.se-category {
  font-size: 12px;
  color: var(--c-text-2, #8b8b99);
}

/* Edit form */
.se-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.se-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--c-text-2, #8b8b99);
  margin-top: 4px;
}

.se-input {
  background: var(--c-surface-2, #1f1f24);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 7px;
  color: var(--c-text, #e2e2e8);
  font-size: 13px;
  padding: 7px 10px;
  outline: none;
  font-family: inherit;
  width: 100%;
  transition: border-color 0.15s;
}
.se-input:focus {
  border-color: #a78bfa;
}

/* Category search */
.se-search-wrap {
  position: relative;
}

.se-search-hint {
  font-size: 12px;
  color: var(--c-text-2, #8b8b99);
  padding: 4px 2px;
}

.se-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--c-surface, #18181b);
  border: 1px solid var(--c-border, #2a2a33);
  border-radius: 8px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 100;
  list-style: none;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.se-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--c-text, #e2e2e8);
  cursor: pointer;
  transition: background 0.12s;
}
.se-dropdown-item:hover {
  background: rgba(167, 139, 250, 0.12);
}

.se-cat-thumb {
  width: 26px;
  height: 36px;
  object-fit: cover;
  border-radius: 3px;
  flex-shrink: 0;
}

/* Save error */
.se-save-error {
  font-size: 12px;
  color: #ef4444;
}

/* Actions */
.se-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}

.se-btn {
  border: none;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 16px;
  cursor: pointer;
  font-family: inherit;
  display: flex;
  align-items: center;
  gap: 5px;
  transition: opacity 0.15s, background 0.15s;
}
.se-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.se-btn-primary {
  background: #a78bfa;
  color: #fff;
}
.se-btn-primary:not(:disabled):hover {
  opacity: 0.88;
}

.se-btn-ghost {
  background: rgba(255, 255, 255, 0.06);
  color: var(--c-text-2, #8b8b99);
  border: 1px solid var(--c-border, #2a2a33);
}
.se-btn-ghost:hover {
  background: rgba(255, 255, 255, 0.1);
}
</style>
