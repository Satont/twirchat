import { describe, expect, test } from 'bun:test'

import { userCardHeaderAccent } from '../src/gpuix/components/user-card-dialog/header-accent'
import type { UserCosmetics } from '../src/services/cosmetics'

function cosmetics(overrides: Partial<UserCosmetics> = {}): UserCosmetics {
  return {
    badges: [],
    inventoryBadges: [],
    lookupStatus: 'available',
    ...overrides,
  }
}

describe('userCardHeaderAccent', () => {
  test('uses a single paint color when paints are enabled', () => {
    expect(
      userCardHeaderAccent(
        '#ff0000',
        '#00ff00',
        cosmetics({
          paint: {
            id: 'paint',
            name: 'Paint',
            layers: [{ type: 'color', color: '#123456', opacity: 1 }],
            shadows: [],
          },
        }),
        true,
      ),
    ).toEqual({ from: '#123456', to: '#123456' })
  })

  test('uses the first and last stop of a paint gradient', () => {
    expect(
      userCardHeaderAccent(
        undefined,
        undefined,
        cosmetics({
          paint: {
            id: 'paint',
            name: 'Paint',
            layers: [
              {
                type: 'linear',
                angle: 90,
                repeating: false,
                opacity: 1,
                stops: [
                  { at: 0, color: '#112233' },
                  { at: 1, color: '#445566' },
                ],
              },
            ],
            shadows: [],
          },
        }),
        true,
      ),
    ).toEqual({ from: '#112233', to: '#445566' })
  })

  test('ignores paint when paints are disabled and prefers the profile color', () => {
    expect(
      userCardHeaderAccent(
        '#abcdef',
        '#00ff00',
        cosmetics({
          paint: {
            id: 'paint',
            name: 'Paint',
            layers: [{ type: 'color', color: '#123456', opacity: 1 }],
            shadows: [],
          },
        }),
        false,
      ),
    ).toEqual({ from: '#abcdef', to: '#abcdef' })
  })

  test('falls back to the message color and then to the theme', () => {
    expect(userCardHeaderAccent(undefined, '#00ff00', null, true)).toEqual({
      from: '#00ff00',
      to: '#00ff00',
    })
    expect(userCardHeaderAccent(undefined, undefined, null, true)).toBeUndefined()
  })
})
