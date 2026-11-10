/**
 * Velopack auto-updater for the Bun/GPUIX build.
 *
 * Release contract:
 *   package id  dev.twirchat.app
 *   channels    linux-x64 / win-x64 / osx-x64 / osx-arm64 (baked into the package manifest at
 *               `vpk pack -c <channel>`; UpdateManager reads it from there)
 *   feed        GitHub Releases `releases.<channel>.json` on Satont/twirchat
 *
 * Dev builds (APP_VERSION === 'dev') and unpackaged runs are a no-op.
 */

import { dirname, join } from 'node:path'

import { logger } from '@twirchat/shared/logger'
import { GithubSource, UpdateManager } from 'velopack'
import type { UpdateInfo } from 'velopack'

import { APP_VERSION } from '../../build-info'
import { getDbPath } from '../../runtime-config'
import { getDb } from '../../store/db'
import { t } from '../i18n'
import { prepareLinuxUpdateLocator } from '../linux-update-runtime'
import type { DesktopEvents } from './events'

const log = logger('updater')

const GITHUB_REPO_URL = 'https://github.com/Satont/twirchat'
const AUTO_CHECK_INTERVAL_MS = 10 * 60 * 1000
const SKIPPED_UPDATE_KEY = 'gpuix_ui_skipped_update_sha256'

export interface CheckForUpdateResult {
  updateAvailable: boolean
  version?: string
  currentVersion: string
}

export interface Updater {
  check(): Promise<CheckForUpdateResult>
  startAutoChecks(isEnabled: () => boolean, intervalMs?: number): () => void
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

type UpdaterManager = Pick<
  UpdateManager,
  | 'getAppId'
  | 'getCurrentVersion'
  | 'checkForUpdatesAsync'
  | 'downloadUpdateAsync'
  | 'waitExitThenApplyUpdate'
>

type DownloadResult = Awaited<ReturnType<Updater['download']>>

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'available' | 'ready'; info: UpdateInfo }
  | { kind: 'downloading'; info: UpdateInfo; result: Promise<DownloadResult> }
  | { kind: 'applying'; info: UpdateInfo; result: Promise<void> }

export interface UpdaterRuntime {
  version: string
  createManager(): UpdaterManager | null
  prepareApplyManager(manager: UpdaterManager): Promise<UpdaterManager>
  getSkippedHash(): string | null
  setSkippedHash(hash: string): void
  scheduleExit(): void
}

const defaultRuntime: UpdaterRuntime = {
  version: APP_VERSION,
  createManager: () => new UpdateManager(new GithubSource(GITHUB_REPO_URL)),
  prepareApplyManager: async (manager) => {
    if (process.platform !== 'linux') return manager
    const appImage = process.env.APPIMAGE
    if (!appImage) throw new Error(t('runtime.updater.appImageRequired'))
    const locator = await prepareLinuxUpdateLocator({
      appImage,
      currentBinaryDir: dirname(process.execPath),
      runtimeDirectory: join(dirname(getDbPath()), 'update-runtime'),
      packagesDirectory: join('/var/tmp/velopack', manager.getAppId(), 'packages'),
    })
    return new UpdateManager(new GithubSource(GITHUB_REPO_URL), undefined, locator)
  },
  getSkippedHash,
  setSkippedHash,
  scheduleExit: () => setTimeout(() => process.exit(0), 300),
}

export function createUpdater(events: DesktopEvents, runtime = defaultRuntime): Updater {
  let manager: UpdaterManager | null | undefined
  let state: UpdateState = { kind: 'idle' }
  let checking: { result: Promise<CheckForUpdateResult>; visibility: { manual: boolean } } | null =
    null

  const getManager = (): UpdaterManager | null => {
    if (runtime.version === 'dev') return null
    if (manager === undefined) {
      try {
        manager = runtime.createManager()
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

  const currentResult = (currentVersion: string): CheckForUpdateResult =>
    state.kind === 'idle'
      ? { updateAvailable: false, currentVersion }
      : { updateAvailable: true, version: state.info.TargetFullRelease.Version, currentVersion }

  const check = (manual: boolean): Promise<CheckForUpdateResult> => {
    const mgr = getManager()
    const currentVersion = mgr?.getCurrentVersion() ?? runtime.version
    if (!mgr) return Promise.resolve({ updateAvailable: false, currentVersion })
    if (state.kind === 'downloading' || state.kind === 'applying')
      return Promise.resolve(currentResult(currentVersion))
    if (checking) {
      if (manual) checking.visibility.manual = true
      return checking.result
    }

    const visibility = { manual }
    const result = Promise.resolve().then(async () => {
      if (visibility.manual) emit('checking', t('runtime.updater.checking'))
      try {
        const info = await mgr.checkForUpdatesAsync()
        if (!info || runtime.getSkippedHash() === info.TargetFullRelease.SHA256) {
          const hadAvailableUpdate = state.kind === 'available'
          state = { kind: 'idle' }
          if (visibility.manual) emit('no-update', t('runtime.updater.upToDate'))
          else if (hadAvailableUpdate) emit('idle', '')
          return { updateAvailable: false, currentVersion }
        }
        const target = info.TargetFullRelease
        const ready =
          state.kind === 'ready' && state.info.TargetFullRelease.SHA256 === target.SHA256
        state = { kind: ready ? 'ready' : 'available', info }
        if (visibility.manual)
          emit(
            ready ? 'download-complete' : 'update-available',
            ready
              ? t('runtime.updater.downloaded')
              : t('runtime.updater.available', { version: target.Version }),
            { hash: target.SHA256 },
          )
        return { updateAvailable: true, version: target.Version, currentVersion }
      } catch (error) {
        if (visibility.manual)
          emit('update-error', t('runtime.updater.checkFailed', { error: String(error) }))
        else log.warn('Automatic update check failed', { error: String(error) })
        return { updateAvailable: false, currentVersion }
      } finally {
        checking = null
      }
    })
    checking = { result, visibility }
    return result
  }

  const updater: Updater = {
    check: () => check(true),

    startAutoChecks(isEnabled, intervalMs = AUTO_CHECK_INTERVAL_MS) {
      if (runtime.version === 'dev' || manager === null) return () => {}
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const run = async () => {
        if (
          state.kind !== 'ready' &&
          state.kind !== 'downloading' &&
          state.kind !== 'applying' &&
          isEnabled()
        ) {
          const result = await check(false)
          if (!stopped && result.updateAvailable && isEnabled()) await updater.download()
        }
      }
      const tick = () => {
        void run()
          .finally(() => {
            if (!stopped && manager !== null) {
              timer = setTimeout(tick, intervalMs)
              timer.unref()
            }
          })
          .catch((error) => log.warn('Automatic update failed', { error: String(error) }))
      }
      tick()
      return () => {
        stopped = true
        if (timer) clearTimeout(timer)
      }
    },

    async download() {
      if (checking) await checking.result
      if (state.kind === 'downloading') return state.result
      if (state.kind === 'ready' || state.kind === 'applying') return { success: true }
      const mgr = getManager()
      if (!mgr || state.kind !== 'available')
        return { success: false, error: t('runtime.updater.noUpdateToDownload') }
      const info = state.info
      const hash = info.TargetFullRelease.SHA256
      const result = Promise.resolve().then(async (): Promise<DownloadResult> => {
        emit('downloading', t('runtime.updater.downloading'), { progress: 0, hash })
        try {
          await mgr.downloadUpdateAsync(info, (perc) => {
            if (state.kind === 'downloading' && state.info === info && state.result === result)
              emit('downloading', t('runtime.updater.downloading'), { progress: perc, hash })
          })
          state = { kind: 'ready', info }
          emit('download-complete', t('runtime.updater.downloaded'), { hash })
          return { success: true }
        } catch (error) {
          state = { kind: 'available', info }
          emit('update-error', t('runtime.updater.downloadFailed', { error: String(error) }))
          return { success: false, error: String(error) }
        }
      })
      state = { kind: 'downloading', info, result }
      return result
    },

    async apply() {
      if (state.kind === 'applying') return state.result
      if (checking || state.kind !== 'ready') return
      const mgr = getManager()
      if (!mgr) return
      const info = state.info
      const result = Promise.resolve().then(async (): Promise<void> => {
        try {
          const applyManager = await runtime.prepareApplyManager(mgr)
          emit('applying', t('runtime.updater.applying'))
          // Updater waits for this process to exit (up to 60s), applies, restarts.
          applyManager.waitExitThenApplyUpdate(info, false, true)
          runtime.scheduleExit()
        } catch (error) {
          state = { kind: 'ready', info }
          emit('update-error', t('runtime.updater.installFailed', { error: String(error) }))
        }
      })
      state = { kind: 'applying', info, result }
      return result
    },

    async skip(hash) {
      if (state.kind === 'downloading' || state.kind === 'applying') return
      runtime.setSkippedHash(hash)
      if (state.kind !== 'idle' && state.info.TargetFullRelease.SHA256 === hash)
        state = { kind: 'idle' }
    },
  }
  return updater
}
