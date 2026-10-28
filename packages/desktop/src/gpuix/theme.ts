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

function parseHex(color: string): [number, number, number] | null {
  let value = color.trim().replace('#', '')
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (!/^[0-9a-f]{6}$/i.test(value)) return null
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const readableCache = new Map<string, string>()

/**
 * User-chosen colors (Twitch/Kick name colors, mentions) mixed toward white
 * on dark backgrounds or black on light ones until they reach 4.5:1 — like
 * Chatterino, so #0000ff on dark or #ffff66 on light stays legible. Hue is
 * kept; already-readable colors pass through untouched.
 */
export function readableOn(color: string, background: string): string {
  const key = `${color}|${background}`
  const cached = readableCache.get(key)
  if (cached) return cached

  const fg = parseHex(color)
  const bg = parseHex(background)
  let result = color
  if (fg && bg && contrast(fg, bg) < 4.5) {
    const target = luminance(bg) < 0.5 ? 255 : 0
    for (let step = 1; step <= 10; step++) {
      const t = step / 10
      const mixed = fg.map((c) => Math.round(c + (target - c) * t)) as [number, number, number]
      result = `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
      if (contrast(mixed, bg) >= 4.5) break
    }
  }
  readableCache.set(key, result)
  return result
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
