import type { DesktopApi } from '../backend/api'
import { createResourceCache } from './resource-cache'

type UserRequest = Parameters<DesktopApi['getUserCosmetics']>[0]
type PaintRequest = Parameters<DesktopApi['getPaintNameImage']>[0]
let api: Pick<DesktopApi, 'getUserCosmetics' | 'getPaintNameImage'> | null = null
export function initCosmeticCaches(bridge: typeof api): void {
  api = bridge
}

export const userCosmeticsCache = createResourceCache({
  key: (input: UserRequest) =>
    JSON.stringify([
      input.platform,
      input.platformUserId,
      input.username,
      input.preferences?.badges,
      input.preferences?.paints,
      input.preferences?.communityBadges,
    ]),
  load: (input) => {
    if (!api) throw new Error('Cosmetics are not initialized.')
    return api.getUserCosmetics(input)
  },
})

export const namePaintCache = createResourceCache({
  key: (input: PaintRequest) =>
    JSON.stringify([input.name, input.paint, input.fontSize, input.fontFamily]),
  load: (input) => {
    if (!api) throw new Error('Paints are not initialized.')
    return api.getPaintNameImage(input)
  },
  concurrency: 2,
  capacity: 256,
})
