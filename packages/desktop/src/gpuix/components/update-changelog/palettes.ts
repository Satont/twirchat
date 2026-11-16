import type { ReleaseNoteKind } from '../../release-notes'
import type { Theme } from '../../theme'

export interface KindPalette {
  background: string
  text: string
}

export const darkKindPalettes: Record<Exclude<ReleaseNoteKind, 'other'>, KindPalette> = {
  new: { background: 'rgba(34, 197, 94, 0.18)', text: '#86efac' },
  improved: { background: 'rgba(59, 130, 246, 0.18)', text: '#93c5fd' },
  fixed: { background: 'rgba(245, 158, 11, 0.18)', text: '#fcd34d' },
  removed: { background: 'rgba(239, 68, 68, 0.18)', text: '#fca5a5' },
  docs: { background: 'rgba(167, 139, 250, 0.18)', text: '#c4b5fd' },
}

export const lightKindPalettes: Record<Exclude<ReleaseNoteKind, 'other'>, KindPalette> = {
  new: { background: 'rgba(22, 163, 74, 0.12)', text: '#15803d' },
  improved: { background: 'rgba(37, 99, 235, 0.12)', text: '#1d4ed8' },
  fixed: { background: 'rgba(234, 88, 12, 0.12)', text: '#c2410c' },
  removed: { background: 'rgba(220, 38, 38, 0.12)', text: '#b91c1c' },
  docs: { background: 'rgba(124, 58, 237, 0.12)', text: '#6d28d9' },
}

export function getKindPalette(kind: ReleaseNoteKind, theme: Theme): KindPalette {
  if (kind === 'other') return { background: theme.fill, text: theme.text2 }
  return theme.isLight ? lightKindPalettes[kind] : darkKindPalettes[kind]
}
