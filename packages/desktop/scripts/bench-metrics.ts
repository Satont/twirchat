import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

export interface DrmClient {
  driver: string
  device: string
  clientId: string
  engines: Record<string, bigint>
  capacities: Record<string, number>
  residentBytes: Record<string, number>
}
export interface DrmSnapshot {
  atNs: bigint
  clients: Map<string, DrmClient>
}
export interface GpuMeasurement {
  device: string
  driver: string
  engines: Record<string, number>
  residentBytes: Record<string, number>
}

export const benchmarkProvenanceSchema = z.object({
  gitHead: z.string(),
  dirtyHash: z.string(),
  sourceHash: z.string(),
  sourceFiles: z.number().int(),
})
export type BenchmarkProvenance = z.infer<typeof benchmarkProvenanceSchema>

async function gitOutput(repository: string, arguments_: string[]): Promise<string> {
  const child = Bun.spawn(['git', ...arguments_], {
    cwd: repository,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`Could not read benchmark source provenance: ${stderr}`)
  return stdout
}

export async function readBenchmarkProvenance(repository: string): Promise<BenchmarkProvenance> {
  const [head, diff, untracked] = await Promise.all([
    gitOutput(repository, ['rev-parse', 'HEAD']),
    gitOutput(repository, ['diff', '--binary', 'HEAD']),
    gitOutput(repository, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  const dirty = createHash('sha256').update(diff)
  for (const path of untracked.split('\0').filter(Boolean).sort()) {
    dirty
      .update(path)
      .update('\0')
      .update(Buffer.from(await Bun.file(join(repository, path)).arrayBuffer()))
  }
  const files = new Set<string>([
    'package.json',
    'bun.lock',
    'packages/desktop/package.json',
    'packages/desktop/scripts/bench-chat-case.tsx',
    'packages/desktop/scripts/bench-metrics.ts',
    'packages/desktop/scripts/qa-gui.ts',
    'packages/desktop/scripts/qa-weston.ts',
  ])
  for (const pattern of [
    'packages/desktop/src/**/*.{ts,tsx,js,json,vue,css}',
    'packages/shared/**/*.{ts,json,proto}',
    'packages/desktop/native/gpuix/**/*.{json,patch}',
    'packages/desktop/public/fonts/*',
    'packages/desktop/dist/native/*',
  ]) {
    for await (const path of new Bun.Glob(pattern).scan({ cwd: repository, onlyFiles: true })) {
      if (!path.includes('/node_modules/')) files.add(path)
    }
  }
  const source = createHash('sha256')
  for (const path of [...files].sort())
    source
      .update(path)
      .update('\0')
      .update(Buffer.from(await Bun.file(join(repository, path)).arrayBuffer()))
  return {
    gitHead: head.trim(),
    dirtyHash: dirty.digest('hex'),
    sourceHash: source.digest('hex'),
    sourceFiles: files.size,
  }
}

export function parseDrmFdinfo(text: string): DrmClient | null {
  const fields = new Map(
    text.split('\n').flatMap((line) => {
      const separator = line.indexOf(':')
      return separator < 0 ? [] : [[line.slice(0, separator), line.slice(separator + 1).trim()]]
    }),
  )
  const driver = fields.get('drm-driver')
  const device = fields.get('drm-pdev')
  const clientId = fields.get('drm-client-id')
  if (!driver || !device || !clientId) return null
  const engines: Record<string, bigint> = {}
  const capacities: Record<string, number> = {}
  const residentBytes: Record<string, number> = {}
  for (const [key, value] of fields) {
    const engine = key.match(/^drm-engine-(.+)$/)?.[1]
    const capacity = key.match(/^drm-engine-capacity-(.+)$/)?.[1]
    const memory = key.match(/^drm-(?:resident|memory)-(.+)$/)?.[1]
    if (capacity && /^\d+$/.test(value)) capacities[capacity] = Math.max(1, Number(value))
    else if (engine && /^\d+ ns$/.test(value)) engines[engine] = BigInt(value.split(' ')[0] ?? '0')
    if (memory && (key.startsWith('drm-resident-') || !fields.has(`drm-resident-${memory}`))) {
      const amount = value.match(/^(\d+) (KiB|MiB|GiB|B)$/)
      if (amount) {
        const multiplier = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[amount[2] ?? '']
        if (multiplier) residentBytes[memory] = Number(amount[1]) * multiplier
      }
    }
  }
  return { driver, device, clientId, engines, capacities, residentBytes }
}

export function drmSnapshot(sources: string[], atNs: bigint): DrmSnapshot {
  const clients = new Map<string, DrmClient>()
  for (const source of sources) {
    const client = parseDrmFdinfo(source)
    if (!client) continue
    const key = `${client.device}/${client.clientId}`
    const previous = clients.get(key)
    if (previous) {
      for (const [engine, capacity] of Object.entries(client.capacities))
        previous.capacities[engine] = Math.max(previous.capacities[engine] ?? 1, capacity)
      for (const [engine, counter] of Object.entries(client.engines))
        if ((previous.engines[engine] ?? 0n) < counter) previous.engines[engine] = counter
      for (const [region, bytes] of Object.entries(client.residentBytes))
        previous.residentBytes[region] = Math.max(previous.residentBytes[region] ?? 0, bytes)
    } else clients.set(key, client)
  }
  return { atNs, clients }
}

export function readDrmSnapshot(): DrmSnapshot {
  const sources: string[] = []
  for (const name of readdirSync('/proc/self/fdinfo')) {
    try {
      sources.push(readFileSync(`/proc/self/fdinfo/${name}`, 'utf8'))
    } catch {
      // The native renderer may close descriptors while they are being sampled.
    }
  }
  return drmSnapshot(sources, process.hrtime.bigint())
}

export function gpuMeasurements(previous: DrmSnapshot, next: DrmSnapshot): GpuMeasurement[] {
  const elapsed = Number(next.atNs - previous.atNs)
  if (elapsed <= 0) return []
  const devices = new Map<string, GpuMeasurement>()
  for (const [key, client] of next.clients) {
    let device = devices.get(client.device)
    if (!device) {
      device = { device: client.device, driver: client.driver, engines: {}, residentBytes: {} }
      devices.set(client.device, device)
    }
    for (const [region, bytes] of Object.entries(client.residentBytes))
      device.residentBytes[region] = (device.residentBytes[region] ?? 0) + bytes
    const prior = previous.clients.get(key)
    if (!prior) continue
    for (const [engine, counter] of Object.entries(client.engines)) {
      const before = prior.engines[engine] ?? (client.driver === 'amdgpu' ? 0n : undefined)
      if (before === undefined) continue
      const stable = counter < before ? before : counter
      client.engines[engine] = stable
      const capacity = client.capacities[engine] ?? 1
      device.engines[engine] =
        (device.engines[engine] ?? 0) + (Number(stable - before) / elapsed / capacity) * 100
    }
  }
  return [...devices.values()]
}

export function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0
  const sorted = values.toSorted((a, b) => a - b)
  return (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? 0
  )
}

export const benchmarkCaseSchema = z.object({
  channels: z.number().int().min(1).max(100),
  rate: z.number().int().min(0).max(20000),
  panes: z.number().int().min(1).max(4),
  warmupSeconds: z.number().min(1).max(15),
  durationSeconds: z.number().min(2).max(30),
})
export type BenchmarkCase = z.infer<typeof benchmarkCaseSchema>
export const resourceSampleSchema = z.object({
  elapsedMs: z.number(),
  rssBytes: z.number(),
  heapBytes: z.number(),
  processed: z.number(),
  gpu: z.array(
    z.object({
      device: z.string(),
      driver: z.string(),
      engines: z.record(z.string(), z.number()),
      residentBytes: z.record(z.string(), z.number()),
    }),
  ),
})
export type ResourceSample = z.infer<typeof resourceSampleSchema>
export const benchmarkResultSchema = z.object({
  config: benchmarkCaseSchema,
  wallMs: z.number(),
  cpuPercent: z.number(),
  requestedMessages: z.number(),
  generatedMessages: z.number(),
  processedMessages: z.number(),
  processedAfterDrain: z.number(),
  achievedRate: z.number(),
  generatorMissedMessages: z.number(),
  rssBaselineBytes: z.number(),
  rssMedianBytes: z.number(),
  rssPeakBytes: z.number(),
  heapPeakBytes: z.number(),
  eventLoopLagP50Ms: z.number(),
  eventLoopLagP95Ms: z.number(),
  eventLoopLagMaxMs: z.number(),
  gpu: resourceSampleSchema.shape.gpu,
  samples: z.array(resourceSampleSchema),
  retainedMessages: z.number(),
  nativeWindow: z.object({ width: z.number(), height: z.number() }),
  bunVersion: z.string(),
  timestamp: z.string(),
  compositor: z.enum(['xvfb', 'weston']),
  hardwareGpuCountersAvailable: z.boolean(),
  paintedTextVerified: z.literal(true),
  provenance: benchmarkProvenanceSchema,
  termination: z.enum(['completed', 'rss-limit']),
})
export type BenchmarkResult = z.infer<typeof benchmarkResultSchema>
