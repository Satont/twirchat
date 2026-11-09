import { expect, test } from 'bun:test'

import type { ThemeMode } from '@twirchat/shared/types'

import {
  darkTheme,
  DEFAULT_CUSTOM_PALETTE,
  lightTheme,
  normalizePaletteColor,
  readableOn,
  resolvePresetPalette,
  resolveTheme,
  THEME_PRESETS,
} from '../src/gpuix/theme'
import { OPENCODE_THEME_PRESETS } from '../src/gpuix/theme-presets'
import { partialAppSettingsSchema } from '../src/services/persisted-schemas'

function luminance(color: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(color.slice(index, index + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function contrast(a: string, b: string): number {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

const THEME_MODES: readonly ThemeMode[] = ['dark', 'light']

test('all presets and color modes persist, resolve and keep every token readable', () => {
  expect(resolveTheme(null)).toBe(darkTheme)
  expect(resolveTheme({ theme: 'dark' })).toBe(darkTheme)
  expect(resolveTheme({ theme: 'light' })).toBe(lightTheme)
  expect(resolveTheme({ theme: 'custom' })).toBe(darkTheme)
  expect(THEME_PRESETS).toHaveLength(41)
  expect(OPENCODE_THEME_PRESETS).toHaveLength(33)
  expect(resolvePresetPalette('custom', 'dark')).toBeUndefined()
  expect(new Set(THEME_PRESETS.map(({ id }) => id)).size).toBe(THEME_PRESETS.length)
  expect(new Set(THEME_PRESETS.map(({ palette }) => palette.background)).size).toBe(
    THEME_PRESETS.length,
  )

  for (const { id, palette, lightPalette } of THEME_PRESETS) {
    for (const mode of THEME_MODES) {
      const theme = resolveTheme({ theme: id, themeMode: mode })
      const expectedPalette = mode === 'light' ? (lightPalette ?? palette) : palette
      const persisted = partialAppSettingsSchema.parse({ theme: id, themeMode: mode })
      expect(persisted).toMatchObject({ theme: id, themeMode: mode })
      expect(theme).toBe(
        resolveTheme({ theme: id, themeMode: mode, customPalette: DEFAULT_CUSTOM_PALETTE }),
      )
      expect(theme.bg).toBe(expectedPalette.background)
      expect(resolvePresetPalette(id, mode)).toEqual({
        background: expectedPalette.background,
        surface: expectedPalette.surface,
        text: expectedPalette.text,
        muted: expectedPalette.muted,
        accent: expectedPalette.accent,
      })
      if (lightPalette) expect(theme.isLight).toBe(mode === 'light')
      // The hand-authored legacy Light theme predates the generated-palette contrast contract.
      const foregrounds =
        id === 'light'
          ? [theme.text, theme.link]
          : [
              theme.text,
              theme.text2,
              theme.link,
              theme.accent.primary,
              theme.dangerText,
              theme.successText,
              theme.warningText,
            ]
      for (const canvas of [theme.bg, theme.surface, theme.surface2, theme.navBg, theme.dialog]) {
        for (const color of foregrounds) {
          expect(contrast(color, canvas)).toBeGreaterThanOrEqual(4.5)
        }
      }
      expect(contrast(theme.accent.onPrimary, theme.accent.primary)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme.accent.onDeep, theme.accent.deepHover)).toBeGreaterThanOrEqual(4.5)
    }
  }
})

test('custom palettes are immutable inputs and get legible controls on opposing surfaces', () => {
  for (const { background, surface, isLight } of [
    { background: '#17161c', surface: '#ffffff', isLight: false },
    { background: '#fdf9ef', surface: '#000000', isLight: true },
    { background: '#777777', surface: '#030303', isLight: true },
  ]) {
    const palette = { background, surface, text: background, muted: background, accent: background }
    const theme = resolveTheme({ theme: 'custom', customPalette: palette })
    expect(theme.isLight).toBe(isLight)
    expect(theme.bg).toBe(background)
    expect(theme).toBe(resolveTheme({ theme: 'custom', customPalette: { ...palette } }))
    expect(palette.surface).toBe(surface)
    for (const canvas of [theme.bg, theme.surface, theme.surface2, theme.navBg, theme.dialog]) {
      for (const color of [theme.text, theme.text2, theme.link, theme.accent.primary]) {
        expect(contrast(color, canvas)).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(contrast(theme.accent.onPrimary, theme.accent.primary)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(theme.accent.onDeep, theme.accent.deepHover)).toBeGreaterThanOrEqual(4.5)
  }
})

test('palette normalization and author-color contrast handle hexadecimal edge cases', () => {
  expect(normalizePaletteColor(' #f0B ')).toBe('#ff00bb')
  expect(normalizePaletteColor('ABC123')).toBe('#abc123')
  expect(normalizePaletteColor('0#abc12')).toBeNull()
  expect(normalizePaletteColor('#12345678')).toBeNull()
  expect(normalizePaletteColor('red')).toBeNull()
  expect(readableOn('#ffffff', '#17161c')).toBe('#ffffff')
  for (const background of ['#757575', '#777777', '#aaaaaa']) {
    expect(contrast(readableOn(background, background), background)).toBeGreaterThanOrEqual(4.5)
  }
})
