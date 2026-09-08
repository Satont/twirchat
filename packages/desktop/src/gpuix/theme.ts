/**
 * Design tokens — exact port of the CSS custom properties from the Vue app
 * (src/views/main/App.vue) into a JS theme object, since GPUIX has no CSS.
 */

export interface Theme {
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
  isLight: boolean
}

export const darkTheme: Theme = {
  bg: '#0f0f11',
  surface: '#18181b',
  surface2: '#1f1f24',
  border: '#2a2a33',
  text: '#e2e2e8',
  text2: '#8b8b99',
  navBg: '#111114',
  navText: 'rgba(255, 255, 255, 0.45)',
  navActive: '#ffffff',
  navHover: 'rgba(255, 255, 255, 0.06)',
  navActiveBg: 'rgba(167, 139, 250, 0.15)',
  scrollbar: 'rgba(255, 255, 255, 0.12)',
  isLight: false,
}

export const lightTheme: Theme = {
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
  isLight: true,
}

/** Brand / accent palette (theme-independent) */
export const accent = {
  /** violet-400, primary accent */
  primary: '#a78bfa',
  /** deeper violet for solid buttons */
  deep: '#7c3aed',
  deepHover: '#6d28d9',
  /** tints */
  tint06: 'rgba(167, 139, 250, 0.06)',
  tint10: 'rgba(167, 139, 250, 0.10)',
  tint12: 'rgba(167, 139, 250, 0.12)',
  tint15: 'rgba(167, 139, 250, 0.15)',
  tint20: 'rgba(167, 139, 250, 0.20)',
  tint25: 'rgba(167, 139, 250, 0.25)',
  tint45: 'rgba(167, 139, 250, 0.45)',
} as const

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
} as const

/** Event type → color (from EventsFeed.vue) */
export const eventColors: Record<string, string> = {
  follow: '#22c55e',
  sub: '#a78bfa',
  resub: '#a78bfa',
  membership: '#a78bfa',
  gift_sub: '#f59e0b',
  bits: '#f59e0b',
  raid: '#3b82f6',
  host: '#06b6d4',
  superchat: '#ef4444',
}

/** Elevated surfaces */
export const elevated = {
  tooltip: '#1e1e30',
  popover: '#1a1a22',
  dialog: '#2a2a35',
  dialogBorder: '#3a3a45',
  backdrop: 'rgba(0, 0, 0, 0.6)',
} as const

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

/**
 * Resolve the font family name for GPUIX. GPUI resolves fonts from the OS,
 * so we pass the family name and let the system resolve / fall back.
 */
export function fontFamily(setting: 'inter' | 'manrope' | 'system'): string | undefined {
  if (setting === 'inter') return 'Inter'
  if (setting === 'manrope') return 'Manrope'
  return undefined
}
