import { describe, expect, test } from 'bun:test'

import { drmSnapshot, gpuMeasurements, parseDrmFdinfo, percentile } from '../scripts/bench-metrics'

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
