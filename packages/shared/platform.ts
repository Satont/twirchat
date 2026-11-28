function definePlatforms<const Names extends readonly string[]>(names: Names): Readonly<Names> {
  return Object.freeze(names)
}

export const PLATFORMS = definePlatforms(['twitch', 'kick', 'youtube', 'vkplay'])
export type Platform = (typeof PLATFORMS)[number]
