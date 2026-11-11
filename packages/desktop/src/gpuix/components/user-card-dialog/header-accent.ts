import type { UserCosmetics } from '@desktop/services/cosmetics'

import type { UserCardHeaderAccent } from './types'

function paintAccent(cosmetics: UserCosmetics | null): UserCardHeaderAccent | undefined {
  const paint = cosmetics?.paint
  if (!paint) return undefined
  for (const layer of paint.layers) {
    if (layer.type === 'color') return { from: layer.color, to: layer.color }
    if (layer.type === 'linear' || layer.type === 'radial') {
      const first = layer.stops.at(0)?.color
      const last = layer.stops.at(-1)?.color
      if (first && last) return { from: first, to: last }
    }
  }
  return undefined
}

export function userCardHeaderAccent(
  profileColor: string | undefined,
  targetColor: string | undefined,
  cosmetics: UserCosmetics | null,
  paintsEnabled: boolean,
): UserCardHeaderAccent | undefined {
  const paint = paintsEnabled ? paintAccent(cosmetics) : undefined
  if (paint) return paint
  const color = profileColor ?? targetColor
  return color ? { from: color, to: color } : undefined
}
