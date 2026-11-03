/**
 * Bundled UI fonts. GPUI resolves `fontFamily` from the OS, so without this
 * Inter/Manrope only render when the user happens to have them installed.
 * The variable TTFs ship in `public/fonts` (dev) or `fonts/` next to the
 * packaged executable — the same files the OBS overlay serves.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { logger } from '@twirchat/shared/logger'

import { resolveOverlayRuntimePaths } from '../overlay-server'

const log = logger('fonts')

const FONT_FILES = ['InterVariable.ttf', join('manrope', 'Manrope-VariableFont_wght.ttf')]

declare global {
  var __twirchatFontRenderers: WeakSet<object> | undefined
}

interface FontRenderer {
  registerFont?: (data: Buffer) => void
}

/**
 * Registers the bundled fonts once per process (the native window — and its
 * font registry — survives `bun --hot` remounts). Must run before the first
 * layout: a family missing at first layout has already fallen back.
 */
export function registerBundledFonts(renderer: FontRenderer): void {
  const registered = (globalThis.__twirchatFontRenderers ??= new WeakSet())
  if (registered.has(renderer) || !renderer.registerFont) return
  registered.add(renderer)

  const { fontsDir } = resolveOverlayRuntimePaths(join(import.meta.dir, '..'))
  if (!fontsDir) {
    log.warn('Bundled fonts directory not found — falling back to system fonts')
    return
  }

  for (const file of FONT_FILES) {
    const path = join(fontsDir, file)
    if (!existsSync(path)) {
      log.warn('Bundled font missing', { path })
      continue
    }
    try {
      renderer.registerFont(readFileSync(path))
    } catch (error) {
      log.warn('Failed to register font', { path, error: String(error) })
    }
  }
}
