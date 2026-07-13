import { rpc } from '../main'
import type {
  LegacyChatLayout,
  WatchedChannelsLayout,
  LayoutNode,
  PanelNode,
} from '@twirchat/shared/types'

// Migration marker stored in localStorage (browser side is OK for this)
const MIGRATION_KEY = 'layout_migration_v1_to_v2_done'

/**
 * Check if migration has already been performed
 */
export function hasMigrationBeenPerformed(): boolean {
  // localStorage is available in the browser context (views/main/)
  if (typeof localStorage === 'undefined') return true // Skip if not in browser
  return localStorage.getItem(MIGRATION_KEY) === 'true'
}

/**
 * Mark migration as completed
 */
export function markMigrationCompleted(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(MIGRATION_KEY, 'true')
}

/**
 * Migrate legacy flat layout to hierarchical tree layout
 */
export function migrateLegacyLayout(legacy: LegacyChatLayout): WatchedChannelsLayout {
  // If combined mode, create single main panel
  if (legacy.mode === 'combined') {
    return {
      version: 2,
      root: {
        type: 'panel',
        id: crypto.randomUUID(),
        content: { type: 'main' },
        flex: 100,
      },
      meta: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        migratedFrom: 'legacy',
      },
    }
  }

  // If split mode, convert splits to tree
  const panels: PanelNode[] = legacy.splits.map((split) => ({
    type: 'panel',
    id: split.id,
    content:
      split.type === 'channel' && split.channelId
        ? { type: 'watched', channelId: split.channelId }
        : split.type === 'combined'
          ? { type: 'main' }
          : { type: 'empty' },
    flex: split.size,
  }))

  // If only one panel, return it directly
  if (panels.length === 1) {
    return {
      version: 2,
      root: panels[0]!,
      meta: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        migratedFrom: 'legacy',
      },
    }
  }

  // Create horizontal split for multiple panels
  const root: LayoutNode = {
    type: 'split',
    id: crypto.randomUUID(),
    direction: 'horizontal',
    children: panels,
    flex: 100,
  }

  return {
    version: 2,
    root,
    meta: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      migratedFrom: 'legacy',
    },
  }
}

/**
 * Attempt to migrate layout from old format
 * Returns true if migration was performed
 *
 * NOTE: Legacy layout was never stored in localStorage - it used SQLite.
 * This migration checks if a v2 layout already exists in SQLite and marks
 * migration as complete if found. It does not attempt to migrate v1 layouts
 * since they were never actually persisted.
 */
export async function attemptMigration(): Promise<boolean> {
  if (hasMigrationBeenPerformed()) {
    return false
  }

  // Check if layout exists in v2 format (indicates user already has new system)
  try {
    const existing = await rpc.request.getWatchedChannelsLayout?.({ tabId: '' })
    if (
      existing &&
      typeof existing === 'object' &&
      'version' in existing &&
      existing.version === 2
    ) {
      markMigrationCompleted()
      return false
    }
  } catch {
    // RPC might not be available yet
  }

  markMigrationCompleted()
  return false
}
