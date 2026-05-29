export interface SevenTvEmoteInput {
  alias: string
  animated: boolean
  aspectRatio: number
  id: string
  imageUrl: string
  name: string
  zeroWidth: boolean
}

export interface SevenTVEmote {
  id: string
  alias: string
  name: string
  animated: boolean
  zeroWidth: boolean
  aspectRatio: number
  imageUrl: string
}

export function createSevenTvEmote(input: SevenTvEmoteInput): SevenTVEmote {
  return {
    alias: input.alias,
    animated: input.animated,
    aspectRatio: input.aspectRatio,
    id: input.id,
    imageUrl: input.imageUrl,
    name: input.name,
    zeroWidth: input.zeroWidth,
  }
}
