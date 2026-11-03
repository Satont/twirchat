import { expect, test } from 'bun:test'

import type { UpdateInfo } from 'velopack'

import { APP_VERSION } from '../src/build-info'
import { createDesktopEvents } from '../src/gpuix/backend/events'
import { createUpdater, type UpdaterRuntime } from '../src/gpuix/backend/updater'

test('build-info falls back to dev without CI --define', () => {
  expect(APP_VERSION).toBe('dev')
})

test('updater is a no-op in dev builds', async () => {
  const updater = createUpdater(createDesktopEvents())

  expect(await updater.check()).toEqual({ updateAvailable: false, currentVersion: 'dev' })
  expect((await updater.download()).success).toBe(false)
})

type ApplyArguments = Parameters<
  NonNullable<ReturnType<UpdaterRuntime['createManager']>>['waitExitThenApplyUpdate']
>

function updateInfo(version = '1.2.0'): UpdateInfo {
  return {
    TargetFullRelease: {
      PackageId: 'dev.twirchat.app',
      Version: version,
      Type: 'Full',
      FileName: `dev.twirchat.app-${version}-linux-x64-full.nupkg`,
      SHA1: 'sha1',
      SHA256: `sha256-${version}`,
      Size: 100,
      NotesMarkdown: '',
      NotesHtml: '',
    },
    DeltasToTarget: [],
    IsDowngrade: false,
  }
}

function createHarness() {
  const events = createDesktopEvents()
  const statuses: string[] = []
  const hashes: Array<string | undefined> = []
  events.on('update_status', (event) => {
    statuses.push(event.status)
    hashes.push(event.hash)
  })
  const checks: Array<UpdateInfo | null> = [updateInfo()]
  const downloads: UpdateInfo[] = []
  const progressCallbacks: Array<(value: number) => void> = []
  const applies: ApplyArguments[] = []
  let skipped: string | null = null
  let exitCount = 0
  let checkCount = 0
  let downloadResult: Promise<void> = Promise.resolve()
  let checkResult: Promise<UpdateInfo | null> | undefined
  let applyFailure = false
  const manager = {
    getAppId: () => 'dev.twirchat.app',
    getCurrentVersion: () => '1.1.0',
    checkForUpdatesAsync: async () => {
      checkCount++
      return checkResult ?? checks.shift() ?? null
    },
    downloadUpdateAsync: async (info: UpdateInfo, progress?: (value: number) => void) => {
      downloads.push(info)
      if (progress) progressCallbacks.push(progress)
      progress?.(50)
      await downloadResult
    },
    waitExitThenApplyUpdate: (...args: ApplyArguments) => {
      if (applyFailure) throw new Error('helper cannot start')
      applies.push(args)
    },
  }
  const runtime: UpdaterRuntime = {
    version: '1.1.0',
    createManager: () => manager,
    prepareApplyManager: async (value) => value,
    getSkippedHash: () => skipped,
    setSkippedHash: (value) => {
      skipped = value
    },
    scheduleExit: () => {
      exitCount++
    },
  }
  return {
    updater: createUpdater(events, runtime),
    statuses,
    hashes,
    checks,
    downloads,
    progressCallbacks,
    applies,
    runtime,
    get skipped() {
      return skipped
    },
    get exitCount() {
      return exitCount
    },
    get checkCount() {
      return checkCount
    },
    setDownloadResult(value: Promise<void>) {
      downloadResult = value
    },
    setCheckResult(value: Promise<UpdateInfo | null>) {
      checkResult = value
    },
    failApply(value: boolean) {
      applyFailure = value
    },
  }
}

test('concurrent checks share one native request', async () => {
  const harness = createHarness()
  const check = Promise.withResolvers<UpdateInfo | null>()
  harness.setCheckResult(check.promise)
  const first = harness.updater.check()
  const second = harness.updater.check()
  await Promise.resolve()
  expect(harness.checkCount).toBe(1)
  check.resolve(updateInfo())
  expect(await first).toEqual(await second)
})

test('skipping a release during its check suppresses the result before download starts', async () => {
  const harness = createHarness()
  const check = Promise.withResolvers<UpdateInfo | null>()
  harness.setCheckResult(check.promise)
  const checking = harness.updater.check()
  await harness.updater.skip('sha256-1.2.0')
  check.resolve(updateInfo())
  expect(await checking).toEqual({ updateAvailable: false, currentVersion: '1.1.0' })
  expect(harness.statuses.at(-1)).toBe('no-update')
  expect((await harness.updater.download()).success).toBe(false)
  expect(harness.downloads).toHaveLength(0)
})

test('parallel downloads share one package writer and preserve their target during other actions', async () => {
  const harness = createHarness()
  const download = Promise.withResolvers<void>()
  harness.setDownloadResult(download.promise)
  await harness.updater.check()
  const first = harness.updater.download()
  const second = harness.updater.download()
  await Promise.resolve()
  expect(harness.downloads).toHaveLength(1)
  harness.checks.push(updateInfo('1.3.0'))
  expect(await harness.updater.check()).toEqual({
    updateAvailable: true,
    version: '1.2.0',
    currentVersion: '1.1.0',
  })
  expect(harness.checkCount).toBe(1)
  await harness.updater.skip('sha256-1.2.0')
  await harness.updater.apply()
  expect(harness.skipped).toBeNull()
  expect(harness.applies).toHaveLength(0)
  download.resolve()
  expect(await first).toEqual({ success: true })
  expect(await second).toEqual({ success: true })
  expect(harness.hashes.at(-1)).toBe('sha256-1.2.0')
  await harness.updater.apply()
  expect(harness.applies[0]?.[0]).toEqual(updateInfo())
  expect(harness.exitCount).toBe(1)
})

test('a download waits for an active check before choosing the target', async () => {
  const harness = createHarness()
  const check = Promise.withResolvers<UpdateInfo | null>()
  harness.setCheckResult(check.promise)
  const checking = harness.updater.check()
  const downloading = harness.updater.download()
  expect(harness.downloads).toHaveLength(0)
  check.resolve(updateInfo('1.3.0'))
  await checking
  expect(await downloading).toEqual({ success: true })
  expect(harness.downloads).toEqual([updateInfo('1.3.0')])
})

test('failed downloads remain retryable without allowing an incomplete package to apply', async () => {
  const harness = createHarness()
  const download = Promise.withResolvers<void>()
  harness.setDownloadResult(download.promise)
  await harness.updater.check()
  const downloading = harness.updater.download()
  download.reject(new Error('network failure'))
  expect(await downloading).toEqual({ success: false, error: 'Error: network failure' })
  await harness.updater.apply()
  expect(harness.applies).toHaveLength(0)
  expect(harness.exitCount).toBe(0)
  harness.setDownloadResult(Promise.resolve())
  expect(await harness.updater.download()).toEqual({ success: true })
  expect(harness.downloads).toHaveLength(2)
})

test('rechecking the same release preserves the ready package and duplicate downloads do no work', async () => {
  const harness = createHarness()
  await harness.updater.check()
  await harness.updater.download()
  harness.checks.push(updateInfo())
  await harness.updater.check()
  expect(harness.statuses.at(-1)).toBe('download-complete')
  expect(await harness.updater.download()).toEqual({ success: true })
  expect(harness.downloads).toHaveLength(1)
  await harness.updater.apply()
  expect(harness.exitCount).toBe(1)
})

test('a new checked release requires a new completed download before apply', async () => {
  const harness = createHarness()
  await harness.updater.check()
  await harness.updater.download()
  harness.checks.push(updateInfo('1.3.0'))
  await harness.updater.check()
  await harness.updater.apply()
  expect(harness.applies).toHaveLength(0)
  await harness.updater.download()
  await harness.updater.apply()
  expect(harness.applies[0]?.[0]).toEqual(updateInfo('1.3.0'))
})

test('apply preparation and helper launch failures report an error without scheduling exit', async () => {
  const harness = createHarness()
  await harness.updater.check()
  await harness.updater.download()
  harness.runtime.prepareApplyManager = async () => {
    throw new Error('copy failed')
  }
  await harness.updater.apply()
  expect(harness.statuses.at(-1)).toBe('update-error')
  expect(harness.exitCount).toBe(0)
  harness.runtime.prepareApplyManager = async (manager) => manager
  harness.failApply(true)
  await harness.updater.apply()
  expect(harness.statuses.at(-1)).toBe('update-error')
  expect(harness.exitCount).toBe(0)
  harness.failApply(false)
  await harness.updater.apply()
  expect(harness.exitCount).toBe(1)
})

test('repeated apply actions share helper preparation, spawn, and exit scheduling', async () => {
  const harness = createHarness()
  const preparation = Promise.withResolvers<void>()
  let preparationCount = 0
  harness.runtime.prepareApplyManager = async (manager) => {
    preparationCount++
    await preparation.promise
    return manager
  }
  await harness.updater.check()
  await harness.updater.download()
  const first = harness.updater.apply()
  const second = harness.updater.apply()
  await Promise.resolve()
  expect(preparationCount).toBe(1)
  expect(harness.exitCount).toBe(0)
  await harness.updater.check()
  await harness.updater.skip('sha256-1.2.0')
  expect(harness.skipped).toBeNull()
  preparation.resolve()
  await Promise.all([first, second])
  await harness.updater.apply()
  expect(harness.applies).toHaveLength(1)
  expect(harness.applies[0]?.slice(1)).toEqual([false, true])
  expect(harness.exitCount).toBe(1)
})

test('late progress cannot replace ready status or interfere with a newer download', async () => {
  const harness = createHarness()
  await harness.updater.check()
  await harness.updater.download()
  const completedStatusCount = harness.statuses.length
  harness.progressCallbacks[0]?.(99)
  expect(harness.statuses).toHaveLength(completedStatusCount)
  expect(harness.statuses.at(-1)).toBe('download-complete')

  harness.checks.push(updateInfo('1.3.0'))
  await harness.updater.check()
  const download = Promise.withResolvers<void>()
  harness.setDownloadResult(download.promise)
  const downloading = harness.updater.download()
  await Promise.resolve()
  const downloadingStatusCount = harness.statuses.length
  harness.progressCallbacks[0]?.(100)
  expect(harness.statuses).toHaveLength(downloadingStatusCount)
  harness.progressCallbacks[1]?.(75)
  expect(harness.statuses).toHaveLength(downloadingStatusCount + 1)
  download.resolve()
  await downloading
  expect(harness.statuses.at(-1)).toBe('download-complete')
  expect(harness.hashes.at(-1)).toBe('sha256-1.3.0')
})
