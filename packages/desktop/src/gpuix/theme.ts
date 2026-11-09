import type { AppSettings, CustomPalette, ThemeMode, ThemePreset } from '@twirchat/shared/types'

import { normalizePaletteColor } from '../shared/theme-palette'
import { OPENCODE_THEME_PRESETS, type ThemePresetPalette } from './theme-presets'

export { normalizePaletteColor } from '../shared/theme-palette'

const BLACK = '#000000'
const WHITE = '#ffffff'

const legacyAccent = {
  primary: '#a78bfa',
  deep: '#7c3aed',
  deepHover: '#6d28d9',
  onPrimary: BLACK,
  onDeep: WHITE,
  tint06: 'rgba(167, 139, 250, 0.06)',
  tint10: 'rgba(167, 139, 250, 0.10)',
  tint12: 'rgba(167, 139, 250, 0.12)',
  tint15: 'rgba(167, 139, 250, 0.15)',
  tint20: 'rgba(167, 139, 250, 0.20)',
  tint25: 'rgba(167, 139, 250, 0.25)',
  tint45: 'rgba(167, 139, 250, 0.45)',
}

export interface Theme {
  accent: typeof legacyAccent
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  text2: string
  navBg: string
  navText: string
  navActive: string
  /** hover fill on nav items */
  navHover: string
  /** active nav item background tint */
  navActiveBg: string
  /** subtle scrollbar-ish white tint */
  scrollbar: string
  /** hairline between chat messages */
  divider: string
  /** chat row hover fill */
  rowHover: string
  /** link text — accent tuned for ≥4.5:1 on `bg` */
  link: string
  /** modal dialog surface + its border */
  dialog: string
  dialogBorder: string
  /** popovers / dropdown menus */
  popover: string
  /** subtle neutral fill (chips, inline wells) and its hover step */
  fill: string
  fillHover: string
  /** low-contrast outline for chips and wells */
  hairline: string
  /** semantic TEXT colors, ≥4.5:1 on dialog/bg surfaces of this theme */
  dangerText: string
  successText: string
  warningText: string
  isLight: boolean
}

export const darkTheme: Theme = {
  accent: legacyAccent,
  bg: '#17161c',
  surface: '#1c1b22',
  surface2: '#25242d',
  border: '#2f2d39',
  text: '#ecebf1',
  text2: '#9896a8',
  navBg: '#121116',
  navText: 'rgba(255, 255, 255, 0.45)',
  navActive: '#ffffff',
  navHover: 'rgba(255, 255, 255, 0.06)',
  navActiveBg: 'rgba(167, 139, 250, 0.15)',
  scrollbar: 'rgba(255, 255, 255, 0.12)',
  divider: 'rgba(255, 255, 255, 0.045)',
  rowHover: 'rgba(255, 255, 255, 0.035)',
  link: '#a78bfa',
  dialog: '#211f28',
  dialogBorder: '#34323f',
  popover: '#1f1e26',
  fill: 'rgba(255, 255, 255, 0.05)',
  fillHover: 'rgba(255, 255, 255, 0.09)',
  hairline: 'rgba(255, 255, 255, 0.1)',
  dangerText: '#fca5a5',
  successText: '#86efac',
  warningText: '#fcd34d',
  isLight: false,
}

export const lightTheme: Theme = {
  accent: legacyAccent,
  bg: '#f0eff4',
  surface: '#faf9fc',
  surface2: '#e8e7ed',
  border: '#d8d6e0',
  text: '#1c1b22',
  text2: '#6b6878',
  navBg: '#faf9fc',
  navText: 'rgba(28, 27, 34, 0.45)',
  navActive: '#7c5aea',
  navHover: 'rgba(28, 27, 34, 0.06)',
  navActiveBg: 'rgba(124, 90, 234, 0.12)',
  scrollbar: 'rgba(28, 27, 34, 0.14)',
  divider: 'rgba(28, 27, 34, 0.06)',
  rowHover: 'rgba(28, 27, 34, 0.035)',
  link: '#6d28d9',
  dialog: '#ffffff',
  dialogBorder: '#d8d6e0',
  popover: '#ffffff',
  fill: 'rgba(28, 27, 34, 0.045)',
  fillHover: 'rgba(28, 27, 34, 0.08)',
  hairline: 'rgba(28, 27, 34, 0.12)',
  dangerText: '#b91c1c',
  successText: '#15803d',
  warningText: '#a16207',
  isLight: true,
}

/** Platform brand colors (see src/views/shared/utils/platform.ts) */
export const platformColors: Record<string, string> = {
  twitch: '#9146ff',
  youtube: '#ff0000',
  kick: '#53fc18',
}

export function platformColor(platform: string): string {
  return platformColors[platform] ?? '#888888'
}

/** Semantic colors */
export const semantic = {
  success: '#22c55e',
  successSoft: '#4ade80',
  successSofter: '#86efac',
  error: '#ef4444',
  errorText: '#f87171',
  errorSoft: '#fca5a5',
  warning: '#f59e0b',
  warningSoft: '#fbbf24',
  info: '#3b82f6',
  cyan: '#06b6d4',
  sevenTv: '#6441a5',
  renamed: '#818cf8',
}

/** Elevated surfaces */
export const elevated = {
  tooltip: '#1e1e30',
  popover: '#1a1a22',
  dialog: '#2a2a35',
  dialogBorder: '#3a3a45',
  backdrop: 'rgba(0, 0, 0, 0.6)',
}

/** Default self-ping highlight */
export const DEFAULT_SELF_PING_COLOR = 'rgba(167, 139, 250, 0.15)'

/** `#rrggbb`/`#rgb` → `rgba(r, g, b, alpha)` — replaces CSS color-mix tints. */
export function withAlpha(hex: string, alpha: number): string {
  let value = hex.replace('#', '')
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function parseHex(color: string): [number, number, number] | null {
  const value = normalizePaletteColor(color)
  return value === null ? null : hexChannels(value)
}

function hexChannels(value: string): [number, number, number] {
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ]
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function mixChannels(
  from: [number, number, number],
  to: [number, number, number],
  ratio: number,
): [number, number, number] {
  return [
    Math.round(from[0] + (to[0] - from[0]) * ratio),
    Math.round(from[1] + (to[1] - from[1]) * ratio),
    Math.round(from[2] + (to[2] - from[2]) * ratio),
  ]
}

function mixHex(from: string, to: string, ratio: number): string {
  return toHex(mixChannels(hexChannels(from), hexChannels(to), ratio))
}

function linearChannel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b)
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function contrastForeground(backgroundLuminance: number): string {
  return contrast(0, backgroundLuminance) >= contrast(1, backgroundLuminance) ? BLACK : WHITE
}

function mixUntilReadable(
  foreground: [number, number, number],
  backgroundLuminance: number,
  target: string,
): string {
  const targetChannels = hexChannels(target)
  const direction = target === WHITE ? 1 : -1
  for (let step = 1; step < 10; step++) {
    const mixed = mixChannels(foreground, targetChannels, step / 10)
    const mixedLuminance = luminance(mixed)
    if (
      direction * (mixedLuminance - backgroundLuminance) > 0 &&
      contrast(mixedLuminance, backgroundLuminance) >= 4.5
    ) {
      return toHex(mixed)
    }
  }
  return target
}

const READABLE_CACHE_CAPACITY = 4096
// Rotate generations to keep the cache bounded without scanning deleted entries.
let readableCache = new Map<string, string>()
let previousReadableCache = new Map<string, string>()

/**
 * User-chosen colors (Twitch/Kick name colors, mentions) mixed toward white
 * on dark backgrounds or black on light ones until they reach 4.5:1 — like
 * Chatterino, so #0000ff on dark or #ffff66 on light stays legible. Hue is
 * kept; already-readable colors pass through untouched.
 */
export function readableOn(color: string, background: string): string {
  const key = `${color}|${background}`
  const cached = readableCache.get(key) ?? previousReadableCache.get(key)
  if (cached !== undefined) return cached

  const fg = parseHex(color)
  const bg = parseHex(background)
  let result = color
  if (fg && bg) {
    const bgLuminance = luminance(bg)
    if (contrast(luminance(fg), bgLuminance) < 4.5) {
      result = mixUntilReadable(fg, bgLuminance, contrastForeground(bgLuminance))
    }
  }
  if (readableCache.size >= READABLE_CACHE_CAPACITY) {
    previousReadableCache = readableCache
    readableCache = new Map()
  }
  readableCache.set(key, result)
  return result
}

interface ThemePresetDefinition {
  readonly id: ThemePreset
  readonly label: string
  readonly palette: ThemePresetPalette
  readonly lightPalette?: ThemePresetPalette
}

export const DEFAULT_CUSTOM_PALETTE: CustomPalette = {
  background: darkTheme.bg,
  surface: darkTheme.surface,
  text: darkTheme.text,
  muted: darkTheme.text2,
  accent: darkTheme.accent.primary,
}

export const THEME_PRESETS: readonly ThemePresetDefinition[] = [
  { id: 'dark', label: 'Dark', palette: DEFAULT_CUSTOM_PALETTE },
  {
    id: 'light',
    label: 'Light',
    palette: {
      background: lightTheme.bg,
      surface: lightTheme.surface,
      text: lightTheme.text,
      muted: lightTheme.text2,
      accent: lightTheme.navActive,
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    palette: {
      background: '#0f1322',
      surface: '#181e32',
      text: '#ecedf8',
      muted: '#9ca6c3',
      accent: '#a5a8ff',
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    palette: {
      background: '#101c26',
      surface: '#172936',
      text: '#e2f0f8',
      muted: '#92b1c2',
      accent: '#55cbe2',
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    palette: {
      background: '#131e19',
      surface: '#1b2a22',
      text: '#e4f0e8',
      muted: '#9cb5a4',
      accent: '#80c9a2',
    },
  },
  {
    id: 'ember',
    label: 'Ember',
    palette: {
      background: '#241916',
      surface: '#30211e',
      text: '#f8ece5',
      muted: '#c6a79a',
      accent: '#ff9d70',
    },
  },
  {
    id: 'rose',
    label: 'Rose',
    palette: {
      background: '#f7eef1',
      surface: '#fff8fa',
      text: '#382331',
      muted: '#795b6d',
      accent: '#a13263',
    },
  },
  {
    id: 'paper',
    label: 'Paper',
    palette: {
      background: '#f3eee2',
      surface: '#fdf9ef',
      text: '#30281e',
      muted: '#6c6153',
      accent: '#8e512b',
    },
  },
  ...OPENCODE_THEME_PRESETS,
]

function deriveTheme(palette: ThemePresetPalette): Theme {
  const { background: bg, accent: baseAccent } = palette
  const neutral = contrastForeground(luminance(hexChannels(bg)))
  const isLight = neutral === BLACK
  // Keep each surface compatible with the canvas's foreground polarity.
  const surface = readableOn(palette.surface, neutral)
  const surface2 = readableOn(mixHex(surface, neutral, 0.06), neutral)
  const navBg = isLight ? surface : mixHex(bg, BLACK, 0.15)
  const dialog = readableOn(
    isLight ? mixHex(surface, WHITE, 0.35) : mixHex(surface, WHITE, 0.035),
    neutral,
  )
  const luminances = [bg, surface, surface2, navBg, dialog].map((color) =>
    luminance(hexChannels(color)),
  )
  const limitingBackground = isLight ? Math.min(...luminances) : Math.max(...luminances)
  const foreground = (color: string): string => {
    const channels = hexChannels(color)
    const lightness = luminance(channels)
    if (
      (isLight ? lightness < limitingBackground : lightness > limitingBackground) &&
      contrast(lightness, limitingBackground) >= 4.5
    ) {
      return color
    }
    return mixUntilReadable(channels, limitingBackground, neutral)
  }
  const primary = foreground(baseAccent)
  const deep = mixHex(primary, surface, 0.15)
  const onDeep = contrastForeground(luminance(hexChannels(deep)))
  const accent = {
    primary,
    deep,
    deepHover: mixHex(deep, onDeep === WHITE ? BLACK : WHITE, 0.12),
    onPrimary: contrastForeground(luminance(hexChannels(primary))),
    onDeep,
    tint06: withAlpha(baseAccent, 0.06),
    tint10: withAlpha(baseAccent, 0.1),
    tint12: withAlpha(baseAccent, 0.12),
    tint15: withAlpha(baseAccent, 0.15),
    tint20: withAlpha(baseAccent, 0.2),
    tint25: withAlpha(baseAccent, 0.25),
    tint45: withAlpha(baseAccent, 0.45),
  }
  const muted = foreground(palette.muted)
  const semanticBase = isLight ? lightTheme : darkTheme
  return {
    accent,
    bg,
    surface,
    surface2,
    border: mixHex(surface, neutral, 0.13),
    text: foreground(palette.text),
    text2: muted,
    navBg,
    navText: muted,
    navActive: primary,
    navHover: withAlpha(neutral, 0.06),
    navActiveBg: accent.tint15,
    scrollbar: withAlpha(neutral, 0.14),
    divider: withAlpha(neutral, 0.06),
    rowHover: withAlpha(neutral, 0.035),
    link: primary,
    dialog,
    dialogBorder: mixHex(dialog, neutral, 0.14),
    popover: dialog,
    fill: withAlpha(neutral, 0.05),
    fillHover: withAlpha(neutral, 0.09),
    hairline: withAlpha(neutral, 0.12),
    dangerText: foreground(palette.danger ?? semanticBase.dangerText),
    successText: foreground(palette.success ?? semanticBase.successText),
    warningText: foreground(palette.warning ?? semanticBase.warningText),
    isLight,
  }
}

interface PresetThemeVariants {
  readonly dark: Theme
  readonly light: Theme
}

type ThemeResolutionSettings = Pick<AppSettings, 'theme' | 'customPalette'> &
  Partial<Pick<AppSettings, 'themeMode'>>

const presetThemes = new Map<ThemePreset, PresetThemeVariants>()
const presetDefinitions = new Map<ThemePreset, ThemePresetDefinition>()
for (const preset of THEME_PRESETS) {
  const dark =
    preset.id === 'dark'
      ? darkTheme
      : preset.id === 'light'
        ? lightTheme
        : deriveTheme(preset.palette)
  const light = preset.lightPalette ? deriveTheme(preset.lightPalette) : dark
  presetThemes.set(preset.id, { dark, light })
  presetDefinitions.set(preset.id, preset)
}

export function resolvePresetPalette(
  id: AppSettings['theme'],
  mode: ThemeMode,
): CustomPalette | undefined {
  if (id === 'custom') return undefined
  const preset = presetDefinitions.get(id)
  if (!preset) return undefined
  const palette = mode === 'light' ? (preset.lightPalette ?? preset.palette) : preset.palette
  return {
    background: palette.background,
    surface: palette.surface,
    text: palette.text,
    muted: palette.muted,
    accent: palette.accent,
  }
}

let lastCustomTheme: { palette: CustomPalette; theme: Theme } | undefined

export function resolveTheme(settings: ThemeResolutionSettings | null): Theme {
  if (!settings) return darkTheme
  if (settings.theme !== 'custom') {
    const variants = presetThemes.get(settings.theme)
    return variants?.[settings.themeMode ?? 'dark'] ?? darkTheme
  }
  const palette = settings.customPalette
  if (!palette) return darkTheme
  const previous = lastCustomTheme?.palette
  if (
    lastCustomTheme &&
    previous?.background === palette.background &&
    previous.surface === palette.surface &&
    previous.text === palette.text &&
    previous.muted === palette.muted &&
    previous.accent === palette.accent
  ) {
    return lastCustomTheme.theme
  }
  const theme = deriveTheme(palette)
  lastCustomTheme = { palette, theme }
  return theme
}

/**
 * Resolve the font family name for GPUIX. GPUI resolves fonts from the OS,
 * so we pass the family name and let the system resolve / fall back.
 */
export function fontFamily(setting: 'inter' | 'manrope' | 'system'): string | undefined {
  if (setting === 'inter') return 'Inter'
  if (setting === 'manrope') return 'Manrope'
  return undefined
}
