import { setLogSink } from '@twirchat/shared/logger'
import type { LogEntry } from '@twirchat/shared/logger'

import { createDiagnosticFileWriter, diagnosticLogDirectory } from './diagnostic-log-files'

const platforms = new Set(['twitch', 'youtube', 'kick', 'vkplay'])
const reasons = new Set([
  'missing_refresh_token',
  'invalid_refresh_token',
  'reauthorize',
  'transient',
])
const numericFields = ['count', 'failed', 'port', 'retryAt', 'retryCount', 'status']

let writer: ReturnType<typeof createDiagnosticFileWriter> | undefined

export function formatDiagnosticLog({ level, module, msg, ts, meta }: LogEntry): string {
  // External error text and other free-form metadata stay in the console output.
  const fields: Record<string, boolean | number | string> = {}
  if (meta) {
    const { manually, platform, reason, version } = meta
    if (typeof manually === 'boolean') fields.manually = manually
    if (typeof platform === 'string' && platforms.has(platform)) fields.platform = platform
    if (typeof reason === 'string' && reasons.has(reason)) fields.reason = reason
    if (
      typeof version === 'string' &&
      version.length <= 64 &&
      /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/iu.test(version)
    )
      fields.version = version
    for (const key of numericFields) {
      const value = meta[key]
      if (typeof value === 'number' && Number.isSafeInteger(value)) fields[key] = value
    }
  }
  return JSON.stringify({ level, module, msg, ts, ...fields }) + '\n'
}

export function installDiagnosticLogging(): void {
  const file = createDiagnosticFileWriter(diagnosticLogDirectory())
  writer = file
  setLogSink((entry) => file.enqueue(formatDiagnosticLog(entry)))
}

export async function flushDiagnosticLogs(): Promise<void> {
  if (!writer) return
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      writer.flush(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 1000)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

const exit = () => process.exit(0)

export function exitAfterFlushingDiagnosticLogs(): void {
  void flushDiagnosticLogs().then(exit, exit)
}
