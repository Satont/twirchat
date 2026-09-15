/**
 * Velopack auto-updater for the Bun/GPUIX build.
 *
 * Release contract (unchanged since the Wails/Rust builds, so installed
 * clients keep updating through the same feeds):
 *   package id  dev.twirchat.app
 *   channels    linux / win / osx (baked into the package manifest at
 *               `vpk pack -c <channel>`; UpdateManager reads it from there)
 *   feed        GitHub Releases `releases.<channel>.json` on Satont/twirchat
 *
 * Dev builds (APP_VERSION === 'dev') and unpackaged runs are a no-op.
 */

import { GithubSource, UpdateManager, VelopackApp } from 'velopack'
import type { UpdateInfo, VelopackAsset } from 'velopack'

import { logger } from '@twirchat/shared/logger'

import { APP_VERSION } from '../../build-info'
import { getDb } from '../../store/db'
import type { DesktopEvents } from './events'

const log = logger('updater')

const GITHUB_REPO_URL = 'https://github.com/Satont/twirchat'
const SKIPPED_UPDATE_KEY = 'gpuix_ui_skipped_update_sha256'

export interface CheckForUpdateResult {
  updateAvailable: boolean
  version?: string
  currentVersion: string
}

export interface Updater {
  check(): Promise<CheckForUpdateResult>
  download(): Promise<{ success: boolean; error?: string }>
  apply(): Promise<void>
  skip(hash: string): Promise<void>
}

function getSkippedHash(): string | null {
  const row = getDb()
    .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
    .get(SKIPPED_UPDATE_KEY)
  return row?.value ?? null
}

function setSkippedHash(hash: string): void {
  getDb().run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [SKIPPED_UPDATE_KEY, hash],
  )
}

/**
 * Velopack process bootstrap — must run before anything else at startup.
 * Handles install/update/restart hooks and may re-exec or exit the process.
 */
export function runVelopackStartup(): void {
  if (APP_VERSION === 'dev') return
  try {
    VelopackApp.build()
      .setAutoApplyOnStartup(true)
      .setLogger((level, msg) => log.debug('velopack', { level, msg }))
      .run()
  } catch (error) {
    log.warn('velopack startup failed', { error: String(error) })
  }
}

export function createUpdater(events: DesktopEvents): Updater {
  let manager: UpdateManager | null | undefined
  let pending: UpdateInfo | null = null
  let downloaded = false

  const getManager = (): UpdateManager | null => {
    if (APP_VERSION === 'dev') return null
    if (manager === undefined) {
      try {
        manager = new UpdateManager(new GithubSource(GITHUB_REPO_URL))
      } catch (error) {
        // Not an installed/packaged app (no Velopack locator) — no updates.
        log.warn('update manager unavailable', { error: String(error) })
        manager = null
      }
    }
    return manager
  }

  const emit = (status: string, message: string, extra?: { progress?: number; hash?: string }) => {
    events.emit('update_status', { status, message, ...extra })
  }

  return {
    async check() {
      const mgr = getManager()
      const currentVersion = mgr?.getCurrentVersion() ?? APP_VERSION
      if (!mgr) return { updateAvailable: false, currentVersion }

      emit('checking', 'Checking for updates')
      try {
        const info = await mgr.checkForUpdatesAsync()
        if (!info) {
          pending = null
          emit('no-update', 'You are up to date')
          return { updateAvailable: false, currentVersion }
        }
        const target = info.TargetFullRelease
        if (getSkippedHash() === target.SHA256) {
          pending = null
          emit('no-update', 'You are up to date')
          return { updateAvailable: false, currentVersion }
        }
        pending = info
        downloaded = false
        emit('update-available', `Update ${target.Version} is available`, {
          hash: target.SHA256,
        })
        return { updateAvailable: true, version: target.Version, currentVersion }
      } catch (error) {
        emit('update-error', `Update check failed: ${String(error)}`)
        return { updateAvailable: false, currentVersion }
      }
    },

    async download() {
      const mgr = getManager()
      if (!mgr || !pending) return { success: false, error: 'No checked update to download' }
      try {
        await mgr.downloadUpdateAsync(pending, (perc) =>
          emit('downloading', 'Downloading update', { progress: perc }),
        )
        downloaded = true
        emit('download-complete', 'Update downloaded — restart to apply', {
          hash: pending.TargetFullRelease.SHA256,
        })
        return { success: true }
      } catch (error) {
        emit('update-error', `Update download failed: ${String(error)}`)
        return { success: false, error: String(error) }
      }
    },

    async apply() {
      const mgr = getManager()
      if (!mgr) return
      const target: UpdateInfo | VelopackAsset | null =
        downloaded && pending ? pending : mgr.getUpdatePendingRestart()
      if (!target) return
      emit('applying', 'Restarting to apply update')
      // Updater waits for this process to exit (up to 60s), applies, restarts.
      mgr.waitExitThenApplyUpdate(target, false, true)
      setTimeout(() => process.exit(0), 300)
    },

    async skip(hash) {
      setSkippedHash(hash)
      if (pending?.TargetFullRelease.SHA256 === hash) pending = null
    },
  }
}
