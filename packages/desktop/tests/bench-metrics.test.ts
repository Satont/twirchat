import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import {
  benchmarkResultSchema,
  drmSnapshot,
  gpuMeasurements,
  parseBenchmarkArguments,
  parseDrmFdinfo,
  percentile,
  selectBenchmarkScenarios,
  verifyBenchmarkReactMode,
} from '../scripts/bench-metrics'

function info(counter: number, client = '4', extra = ''): string {
  return `drm-driver: amdgpu\ndrm-pdev: 0000:03:00.0\ndrm-client-id: ${client}\ndrm-engine-gfx: ${counter} ns\ndrm-resident-vram: 2048 KiB\ndrm-memory-vram: 2048 KiB\n${extra}`
}

describe('process DRM resource metrics', () => {
  test('deduplicates duplicated fdinfo by device and client and ignores deprecated memory aliases', () => {
    const sample = drmSnapshot(
      [info(100), info(200, '4', 'drm-engine-capacity-gfx: 2'), 'pos: 0\nflags: 02'],
      10n,
    )
    expect(sample.clients.size).toBe(1)
    expect([...sample.clients.values()][0]?.engines.gfx).toBe(200n)
    expect([...sample.clients.values()][0]?.residentBytes.vram).toBe(2097152)
    expect([...sample.clients.values()][0]?.capacities.gfx).toBe(2)
    expect(
      parseDrmFdinfo(info(0).replace('drm-resident-vram: 2048 KiB\n', ''))?.residentBytes.vram,
    ).toBe(2097152)
  })
  test('uses nanoseconds, capacity and distinct clients without double-counting descriptors', () => {
    const first = drmSnapshot([info(100), info(100), info(100, '5')], 0n)
    const last = drmSnapshot(
      [info(500000100, '4', 'drm-engine-capacity-gfx: 2'), info(250000100, '5')],
      1000000000n,
    )
    const device = gpuMeasurements(first, last)[0]
    expect(device?.engines.gfx).toBe(50)
    expect(device?.residentBytes.vram).toBe(4194304)
  })
  test('AMDGPU zero engines can appear later, decreasing counters never yield negative usage', () => {
    const empty = drmSnapshot([info(0).replace('drm-engine-gfx: 0 ns\n', '')], 0n)
    const next = drmSnapshot([info(500000000)], 1000000000n)
    expect(gpuMeasurements(empty, next)[0]?.engines.gfx).toBe(50)
    expect(gpuMeasurements(next, drmSnapshot([info(400000000)], 2000000000n))[0]?.engines.gfx).toBe(
      0,
    )
    const decreasing = drmSnapshot([info(400000000)], 2000000000n)
    gpuMeasurements(next, decreasing)
    expect(
      gpuMeasurements(decreasing, drmSnapshot([info(450000000)], 3000000000n))[0]?.engines.gfx,
    ).toBe(0)
  })
  test('does not infer hardware counters from a new client or non-DRM descriptors', () => {
    expect(
      gpuMeasurements(drmSnapshot([], 0n), drmSnapshot([info(100)], 100n))[0]?.engines,
    ).toEqual({})
    expect(parseDrmFdinfo('pos: 0\nflags: 02')).toBeNull()
    expect(gpuMeasurements(drmSnapshot([], 1n), drmSnapshot([], 1n))).toEqual([])
  })
  test('nearest rank percentiles use real observations and handle short samples', () => {
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2)
    expect(percentile([4, 1, 3, 2], 0.95)).toBe(4)
    expect(percentile([], 0.95)).toBe(0)
  })
})

describe('benchmark workload and React mode', () => {
  test('keeps the default matrix and timing while selecting only an explicitly requested case', () => {
    const defaults = parseBenchmarkArguments([])
    expect(defaults).toMatchObject({ mode: 'development', warmup: 3, duration: 12, smoke: false })
    expect(selectBenchmarkScenarios(defaults)).toHaveLength(15)
    expect(selectBenchmarkScenarios(parseBenchmarkArguments(['--smoke']))).toEqual([
      { channels: 10, rate: 1000, panes: 1 },
    ])
    const focused = parseBenchmarkArguments(['--scenario', 'c50-r5000-p4', '--mode', 'production'])
    expect(focused).toMatchObject({ mode: 'production', warmup: 3, duration: 12 })
    expect(selectBenchmarkScenarios(focused)).toEqual([{ channels: 50, rate: 5000, panes: 4 }])
    expect(() => parseBenchmarkArguments(['--scenario', 'c50-r5000-p3'])).toThrow(
      'Unknown benchmark scenario',
    )
    expect(() => parseBenchmarkArguments(['--scenario'])).toThrow('requires a value')
    expect(() => parseBenchmarkArguments(['--mode', 'staging'])).toThrow()
    expect(() => parseBenchmarkArguments(['--smoke', '--scenario', 'c50-r5000-p4'])).toThrow(
      'cannot be combined',
    )
  })

  test('historical results default to development and new results reject an unknown mode', () => {
    const legacy = {
      config: { channels: 50, rate: 5000, panes: 4, warmupSeconds: 3, durationSeconds: 12 },
      wallMs: 12000,
      cpuPercent: 0,
      requestedMessages: 0,
      generatedMessages: 0,
      processedMessages: 0,
      processedAfterDrain: 0,
      achievedRate: 0,
      generatorMissedMessages: 0,
      rssBaselineBytes: 0,
      rssMedianBytes: 0,
      rssPeakBytes: 0,
      heapPeakBytes: 0,
      eventLoopLagP50Ms: 0,
      eventLoopLagP95Ms: 0,
      eventLoopLagMaxMs: 0,
      gpu: [],
      samples: [],
      retainedMessages: 10000,
      nativeWindow: { width: 1200, height: 800 },
      bunVersion: '1.4.4',
      timestamp: '2026-11-03T00:00:00Z',
      compositor: 'weston',
      hardwareGpuCountersAvailable: true,
      paintedTextVerified: true,
      provenance: { gitHead: 'head', dirtyHash: 'dirty', sourceHash: 'source', sourceFiles: 1 },
      termination: 'completed',
    }
    expect(benchmarkResultSchema.parse(legacy).reactMode).toBe('development')
    expect(benchmarkResultSchema.parse(legacy).userTimingMeasureCount).toBeUndefined()
    expect(
      benchmarkResultSchema.parse({ ...legacy, userTimingMeasureCount: 123 })
        .userTimingMeasureCount,
    ).toBe(123)
    expect(() => benchmarkResultSchema.parse({ ...legacy, userTimingMeasureCount: -1 })).toThrow()
    expect(benchmarkResultSchema.parse({ ...legacy, reactMode: 'production' }).reactMode).toBe(
      'production',
    )
    expect(() => benchmarkResultSchema.parse({ ...legacy, reactMode: 'staging' })).toThrow()
  })

  test('refuses mixed runtime, JSX and reconciler evidence', () => {
    const loadedModules = ['react', 'react-jsx-runtime', 'react-reconciler'].map(
      (name) => `/node_modules/${name}/cjs/${name}.production.js`,
    )
    const evidence = {
      requested: 'production',
      nodeEnv: 'production',
      hasCaptureOwnerStack: false,
      loadedModules,
    } satisfies Parameters<typeof verifyBenchmarkReactMode>[0]
    expect(verifyBenchmarkReactMode(evidence)).toBe('production')
    expect(() => verifyBenchmarkReactMode({ ...evidence, nodeEnv: 'development' })).toThrow(
      'runtime',
    )
    expect(() => verifyBenchmarkReactMode({ ...evidence, hasCaptureOwnerStack: true })).toThrow(
      'runtime',
    )
    expect(() =>
      verifyBenchmarkReactMode({ ...evidence, loadedModules: loadedModules.slice(0, 2) }),
    ).toThrow('reconciler')
    expect(() =>
      verifyBenchmarkReactMode({
        ...evidence,
        loadedModules: [...loadedModules, '/react/cjs/react-jsx-dev-runtime.development.js'],
      }),
    ).toThrow('react-jsx-runtime')
  })

  test('verifies the actual Bun-loaded module families in both runtime environments', async () => {
    const desktop = join(import.meta.dir, '..')
    const metrics = join(desktop, 'scripts/bench-metrics.ts')
    const source = `
      const desktop = ${JSON.stringify(desktop)}
      const React = require(Bun.resolveSync('react', desktop))
      require(Bun.resolveSync('react/jsx-runtime', desktop))
      require(Bun.resolveSync('react-reconciler', Bun.resolveSync('@gpuix/react', desktop)))
      const { verifyBenchmarkReactMode, benchmarkReactModeSchema } = await import(${JSON.stringify(metrics)})
      console.log(verifyBenchmarkReactMode({
        requested: benchmarkReactModeSchema.parse(process.env.NODE_ENV),
        nodeEnv: process.env.NODE_ENV,
        hasCaptureOwnerStack: typeof React.captureOwnerStack === 'function',
        loadedModules: Object.keys(require.cache),
      }))
    `
    for (const mode of ['development', 'production']) {
      const child = Bun.spawn([process.execPath, '--eval', source], {
        env: { ...process.env, NODE_ENV: mode },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(stderr).toBe('')
      expect(code).toBe(0)
      expect(stdout.trim()).toBe(mode)
    }
  })
})
