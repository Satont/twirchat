import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { cpus, release, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { z } from 'zod'

import {
  benchmarkCaseSchema,
  benchmarkResultSchema,
  benchmarkScenarioName,
  parseBenchmarkArguments,
  readBenchmarkProvenance,
  selectBenchmarkScenarios,
  type BenchmarkResult,
} from './bench-metrics'

const options = parseBenchmarkArguments(process.argv.slice(2))
const directory = options.output
  ? resolve(options.output)
  : await mkdtemp(join(tmpdir(), 'twirchat-benchmark-'))
await mkdir(directory, { recursive: true })
const repository = resolve(import.meta.dir, '../../..')
const provenance = await readBenchmarkProvenance(repository)
await Bun.write(join(directory, 'provenance.json'), JSON.stringify(provenance, null, 2))
async function assertSourceUnchanged(): Promise<void> {
  const current = await readBenchmarkProvenance(repository)
  if (current.gitHead !== provenance.gitHead || current.sourceHash !== provenance.sourceHash)
    throw new Error('Benchmark inputs changed. Use a frozen checkout and a new output directory.')
}
const selected = selectBenchmarkScenarios(options)
const results: BenchmarkResult[] = options.resume
  ? z
      .object({ results: z.array(benchmarkResultSchema) })
      .parse(await Bun.file(join(directory, 'results.json')).json()).results
  : []
if (
  results.some(
    (result) =>
      result.config.warmupSeconds !== options.warmup ||
      result.config.durationSeconds !== options.duration ||
      result.compositor !== options.compositor ||
      result.reactMode !== options.mode ||
      result.provenance.gitHead !== provenance.gitHead ||
      result.provenance.sourceHash !== provenance.sourceHash,
  )
)
  throw new Error('Resume requires the original duration, warmup, compositor and source inputs.')
console.log(`Benchmark artifacts: ${directory}`)
function gfx(result: BenchmarkResult): number | null {
  const values = result.gpu.flatMap((device) =>
    typeof device.engines.gfx === 'number' ? [device.engines.gfx] : [],
  )
  return values.length ? Math.max(...values) : null
}
function gpuMemory(result: BenchmarkResult, region: string): number | null {
  const values = result.gpu.flatMap((device) =>
    typeof device.residentBytes[region] === 'number' ? [device.residentBytes[region]] : [],
  )
  return values.length ? values.reduce((total, value) => total + value, 0) / 1024 ** 2 : null
}
function gfxDevice(result: BenchmarkResult): string | null {
  return (
    result.gpu
      .filter((device) => typeof device.engines.gfx === 'number')
      .toSorted((a, b) => (b.engines.gfx ?? 0) - (a.engines.gfx ?? 0))[0]?.device ?? null
  )
}
function row(result: BenchmarkResult): Array<number | string | null> {
  return [
    result.reactMode,
    result.config.channels,
    result.config.panes,
    result.config.rate,
    result.config.rate / result.config.channels,
    result.achievedRate,
    result.cpuPercent,
    gfx(result),
    gfxDevice(result),
    result.rssMedianBytes / 1024 ** 2,
    result.rssPeakBytes / 1024 ** 2,
    (result.rssPeakBytes - result.rssBaselineBytes) / 1024 ** 2,
    gpuMemory(result, 'vram'),
    gpuMemory(result, 'gtt'),
    result.eventLoopLagP95Ms,
    result.generatedMessages,
    result.processedMessages,
    result.processedAfterDrain,
    result.generatorMissedMessages,
    result.termination,
    result.userTimingMeasureCount ?? null,
  ]
}
const headers = [
  'react_mode',
  'channels',
  'visible_panes',
  'target_total_msg_s',
  'target_msg_s_per_channel',
  'processed_msg_s',
  'cpu_percent_one_core',
  'gpu_gfx_max_device_percent',
  'gpu_gfx_pci_device',
  'rss_median_mib',
  'rss_peak_mib',
  'rss_growth_mib',
  'gpu_vram_mib',
  'gpu_gtt_mib',
  'event_loop_lag_p95_ms',
  'generated_messages',
  'processed_messages',
  'processed_after_drain',
  'generator_missed_messages',
  'termination',
  'user_timing_measure_entries',
]
for (const [index, scenario] of selected.entries()) {
  const config = benchmarkCaseSchema.parse({
    ...scenario,
    warmupSeconds: options.warmup,
    durationSeconds: options.duration,
  })
  if (
    results.some(
      (result) =>
        result.config.channels === config.channels &&
        result.config.rate === config.rate &&
        result.config.panes === config.panes,
    )
  )
    continue
  const name = benchmarkScenarioName(config)
  const artifacts = join(directory, name)
  await assertSourceUnchanged()
  const child = Bun.spawn(
    [
      process.execPath,
      'scripts/qa-gui.ts',
      '--node-env',
      options.mode,
      '--compositor',
      options.compositor,
      '--keep',
      '--timeout',
      String(Math.ceil(config.warmupSeconds + config.durationSeconds + 30)),
      '--artifacts',
      artifacts,
      '--',
      process.execPath,
      'scripts/bench-chat-case.tsx',
      JSON.stringify(config),
      JSON.stringify(provenance),
      options.mode,
    ],
    {
      cwd: join(import.meta.dir, '..'),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  await Bun.write(join(directory, `${name}.log`), `${stdout}\n${stderr}`)
  const session = stdout.match(/GUI QA isolated session: (.+)/u)?.[1]
  if (!session?.startsWith(`${artifacts}/twirchat-gui-qa-`))
    throw new Error(`Benchmark ${name} did not report its private session.`)
  await Promise.all(
    ['runtime', 'profile', 'framebuffer', 'home', 'cache', 'config'].map((part) =>
      rm(join(session, part), { recursive: true, force: true }),
    ),
  )
  if (code !== 0) throw new Error(`Benchmark ${name} failed; see ${join(directory, `${name}.log`)}`)
  await assertSourceUnchanged()
  const result = benchmarkResultSchema.parse(
    await Bun.file(join(session, 'benchmark-result.json')).json(),
  )
  if (result.reactMode !== options.mode)
    throw new Error(
      `Benchmark ${name} loaded ${result.reactMode} instead of ${options.mode} React.`,
    )
  results.push(result)
  const csv = [
    'elapsed_ms,rss_bytes,heap_bytes,processed,gpu_json',
    ...result.samples.map((sample) =>
      [
        sample.elapsedMs,
        sample.rssBytes,
        sample.heapBytes,
        sample.processed,
        `"${JSON.stringify(sample.gpu).replaceAll('"', '""')}"`,
      ].join(','),
    ),
  ].join('\n')
  await Bun.write(join(artifacts, 'samples.csv'), `${csv}\n`)
  await Bun.write(
    join(directory, 'results.json'),
    JSON.stringify(
      {
        environment: {
          cpu: cpus()[0]?.model ?? 'unknown',
          logicalCpus: cpus().length,
          kernel: release(),
          bun: Bun.version,
          reactMode: options.mode,
          timestamp: new Date().toISOString(),
        },
        provenance,
        results,
      },
      null,
      2,
    ),
  )
  await Bun.write(
    join(directory, 'results.csv'),
    `${headers.join(',')}\n${results
      .map((entry) =>
        row(entry)
          .map((value) =>
            value === null ? '' : typeof value === 'number' ? value.toFixed(3) : value,
          )
          .join(','),
      )
      .join('\n')}\n`,
  )
  console.log(
    `[${index + 1}/${selected.length}] ${name}: ${result.achievedRate.toFixed(0)} msg/s, CPU ${result.cpuPercent.toFixed(1)}%, GPU ${gfx(result)?.toFixed(1) ?? 'n/a'}%, RSS peak ${(result.rssPeakBytes / 1024 ** 2).toFixed(1)} MiB, ${result.termination} (${(result.wallMs / 1000).toFixed(1)}s)`,
  )
}
const report = [
  '# TwirChat native chat resource benchmark',
  '',
  `CPU: ${cpus()[0]?.model ?? 'unknown'} (${cpus().length} logical CPUs). Linux ${release()}; Bun ${Bun.version}.`,
  `React mode: ${options.mode}, verified against the loaded React, JSX runtime and reconciler modules. This runs native application source, not a compiled release binary. Compare algorithm changes only within the same mode.`,
  `Source commit ${provenance.gitHead}; dirty tree SHA-256 ${provenance.dirtyHash}; runtime inputs SHA-256 ${provenance.sourceHash} (${provenance.sourceFiles} files). Input hashes are verified before and after every case.`,
  `GPU clients: ${[...new Set(results.flatMap((result) => result.gpu.map((device) => `${device.driver} ${device.device}`)))].join(', ') || 'No DRM hardware counters available; GPU unavailable.'}`,
  '',
  `Each scenario uses a fresh Bun process, private profile and isolated ${options.compositor} display, 1200×800 window. Channels hold 200 messages before warmup. Total message rate is distributed evenly across channels; only the specified panes are visible. Text-only compact chat; avatars and provider cosmetics disabled. No forced GC.`,
  '',
  `Warmup ${options.warmup}s; measurement ${options.duration}s; drain 2s. CPU 100% = one logical core. RAM is process RSS, including native allocations. GPU is per-process DRM graphics-engine time (capacity-normalized), showing the busiest device; its PCI ID is in CSV. GPU is not overall device utilization. n/a means unavailable. DRM VRAM/GTT columns sum resident process allocations across devices; GTT is GPU-mapped system memory and may overlap RSS/shared buffers, so these columns must not be added to RSS as a physical-memory total.`,
  '',
  'This measures DesktopEvents → real batched stores, similarity path and native ChatView rendering. Process CPU also includes the in-process synthetic message generator and metrics sampler; the isolated display compositor is a separate process. It excludes platform network sockets, protocol parsing, provider enrichment and SQLite chat logging. The host is shared with normal work; clocks and scheduling are not isolated. A generator that falls behind skips excess work instead of accumulating unbounded catch-up; both offered and processed counts are retained in JSON/CSV. React commits are not presented as FPS.',
  '',
  'The process RSS safety bound is 2 GiB. A case reaching it stops gracefully and records its actual shorter measurement duration; such rows are marked STOPPED and are not full-duration throughput results.',
  'User Timing measure entries are counted once after CPU, RSS and GPU measurement ends. This diagnostic does not clear entries or change instrumentation. Counts include warmup and are recorded in JSON/CSV.',
  '',
  '| Channels | Panes | Target total msg/s | Actual msg/s | CPU % | GPU gfx max-device % | RSS median MiB | RSS peak MiB | VRAM sum MiB | Lag p95 ms | Outcome |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|',
  ...results.map(
    (result) =>
      `| ${result.config.channels} | ${result.config.panes} | ${result.config.rate} | ${result.achievedRate.toFixed(1)} | ${result.cpuPercent.toFixed(1)} | ${gfx(result)?.toFixed(1) ?? 'n/a'} | ${(result.rssMedianBytes / 1024 ** 2).toFixed(1)} | ${(result.rssPeakBytes / 1024 ** 2).toFixed(1)} | ${gpuMemory(result, 'vram')?.toFixed(1) ?? 'n/a'} | ${result.eventLoopLagP95Ms.toFixed(1)} | ${result.termination === 'completed' ? 'completed' : `STOPPED 2 GiB (${(result.wallMs / 1000).toFixed(1)}s)`} |`,
  ),
  '',
  'Raw per-case JSON, 250ms samples and runtime logs are beside this report. Xvfb runs also include screenshots. Private profile/runtime/framebuffer files are removed after cases; all test processes and displays are closed.',
  '',
  'GPU methodology: [Linux DRM usage statistics](https://docs.kernel.org/gpu/drm-usage-stats.html). DRM clients are deduplicated by PCI device/client ID; deprecated memory aliases are not added to resident counters.',
  '',
]
await Bun.write(join(directory, 'report.md'), report.join('\n'))
console.log(`Report: ${join(directory, 'report.md')}`)
