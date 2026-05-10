import { describe, expect, test } from 'bun:test'

import { resolveOverlayRuntimePaths } from '../src/overlay-server'

describe('resolveOverlayRuntimePaths', () => {
  test('prefers packaged views paths when present', () => {
    const existingPaths = new Set([
      '/app/Resources/app/views/overlay',
      '/app/Resources/app/views/fonts',
    ])

    const result = resolveOverlayRuntimePaths('/app/Resources/app/bun', (path) =>
      existingPaths.has(path),
    )

    expect(result).toEqual({
      overlayDir: '/app/Resources/app/views/overlay',
      fontsDir: '/app/Resources/app/views/fonts',
    })
  })

  test('falls back to development paths when packaged views are absent', () => {
    const existingPaths = new Set([
      '/workspace/packages/desktop/dist/overlay',
      '/workspace/packages/desktop/public/fonts',
    ])

    const result = resolveOverlayRuntimePaths('/workspace/packages/desktop/src', (path) =>
      existingPaths.has(path),
    )

    expect(result).toEqual({
      overlayDir: '/workspace/packages/desktop/dist/overlay',
      fontsDir: '/workspace/packages/desktop/public/fonts',
    })
  })
})
