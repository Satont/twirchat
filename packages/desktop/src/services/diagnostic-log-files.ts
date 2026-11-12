import { constants } from 'node:fs'
import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, posix, win32 } from 'node:path'

export function diagnosticLogDirectory(
  platform = process.platform,
  env = process.env,
  home = homedir(),
): string {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA
    const base =
      localAppData && win32.isAbsolute(localAppData)
        ? localAppData
        : win32.join(home, 'AppData', 'Local')
    return win32.join(base, 'TwirChat', 'logs')
  }
  if (platform === 'darwin') return posix.join(home, 'Library', 'Logs', 'TwirChat')

  const stateHome = env.XDG_STATE_HOME
  const base =
    stateHome && posix.isAbsolute(stateHome) ? stateHome : posix.join(home, '.local', 'state')
  return posix.join(base, 'twirchat', 'logs')
}

interface LogLimits {
  maxFileBytes: number
  maxFiles: number
}

interface Entry {
  line: string
  bytes: number
}

interface Segment {
  path: string
  bytes: number
}

const defaultLimits: LogLimits = { maxFileBytes: 5 * 1024 * 1024, maxFiles: 5 }
const maxBufferedBytes = 1024 * 1024
const maxBufferedEntries = 4096
const segmentName = /^twirchat-\d{13}-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.log$/u
const appendFlags = constants.O_WRONLY | constants.O_APPEND
let lastSegmentTime = 0

function fileErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

async function pruneSegments(directory: string, maxFiles: number): Promise<void> {
  const segments = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && segmentName.test(entry.name))
    .map((entry) => entry.name)
    .toSorted()
  const expired = segments.slice(0, Math.max(0, segments.length - maxFiles))
  await Promise.all(
    expired.map(async (name) => {
      try {
        await unlink(join(directory, name))
      } catch (error) {
        if (fileErrorCode(error) !== 'ENOENT') throw error
      }
    }),
  )
}

export function createDiagnosticFileWriter(directory: string, limits = defaultLimits) {
  let segment: Segment | undefined
  let queue: Entry[] = []
  let bufferedBytes = 0
  let bufferedEntries = 0
  let active: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let reportedFailure = false

  function reportFailure(error: unknown): void {
    if (reportedFailure) return
    reportedFailure = true
    process.stderr.write(
      `[diagnostic-logs] File write failed (${fileErrorCode(error) ?? 'unknown'}).\n`,
    )
  }

  async function writeChunk(lines: string[], bytes: number): Promise<void> {
    const text = lines.join('')
    if (segment && segment.bytes + bytes <= limits.maxFileBytes) {
      try {
        await appendFile(segment.path, text, { flag: appendFlags })
        segment.bytes += bytes
        return
      } catch (error) {
        // Another instance may have pruned this segment. Start a new one in that case.
        if (fileErrorCode(error) !== 'ENOENT') throw error
      }
    }

    await mkdir(directory, { recursive: true, mode: 0o700 })
    lastSegmentTime = Math.max(Date.now(), lastSegmentTime + 1)
    const path = join(directory, `twirchat-${lastSegmentTime}-${crypto.randomUUID()}.log`)
    await appendFile(path, text, { flag: 'ax', mode: 0o600 })
    segment = { path, bytes }
    await pruneSegments(directory, limits.maxFiles)
  }

  async function drain(): Promise<void> {
    while (queue.length) {
      const batch = queue
      queue = []
      const batchBytes = batch.reduce((total, entry) => total + entry.bytes, 0)
      try {
        let lines: string[] = []
        let bytes = 0
        let capacity = limits.maxFileBytes - (segment?.bytes ?? 0)
        for (const entry of batch) {
          if (bytes + entry.bytes > capacity) {
            // eslint-disable-next-line no-await-in-loop -- Rotation depends on the previous write.
            if (lines.length) await writeChunk(lines, bytes)
            lines = []
            bytes = 0
            capacity = limits.maxFileBytes
          }
          lines.push(entry.line)
          bytes += entry.bytes
        }
        // eslint-disable-next-line no-await-in-loop -- Batches must be written in order.
        await writeChunk(lines, bytes)
        reportedFailure = false
      } catch (error) {
        segment = undefined
        reportFailure(error)
      } finally {
        bufferedEntries -= batch.length
        bufferedBytes -= batchBytes
      }
    }
  }

  async function flush(): Promise<void> {
    clearTimeout(timer)
    timer = undefined
    while (active || queue.length) {
      active ??= drain().finally(() => {
        active = undefined
      })
      // eslint-disable-next-line no-await-in-loop -- Wait for the shared drain before checking for more work.
      await active
    }
  }

  return {
    enqueue(line: string): void {
      if (bufferedEntries >= maxBufferedEntries) return
      const bytes = Buffer.byteLength(line)
      if (bytes > limits.maxFileBytes || bufferedBytes + bytes > maxBufferedBytes) return
      queue.push({ line, bytes })
      bufferedBytes += bytes
      bufferedEntries++
      if (active || timer) return
      timer = setTimeout(() => {
        flush().catch(reportFailure)
      }, 100)
      timer.unref()
    },
    flush,
  }
}
