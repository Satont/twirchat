/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] }
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
  | T
  | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never }
export type Platform = 'DISCORD' | 'GOOGLE' | 'KICK' | 'TWITCH'

export type GetEmoteSetQueryVariables = Exact<{
  id: string
}>

export type GetEmoteSetQuery = {
  emoteSets: {
    emoteSet: {
      id: string
      name: string
      emotes: {
        items: Array<{
          id: string
          alias: string
          flags: { zeroWidth: boolean }
          emote: {
            id: string
            defaultName: string
            aspectRatio: number
            flags: { animated: boolean }
            images: Array<{
              url: string
              mime: string
              size: number
              scale: number
              width: number
              height: number
              frameCount: number
            }>
          }
        }>
      }
    } | null
  }
}

export type GetUserByConnectionQueryVariables = Exact<{
  platform: Platform
  platformId: string
}>

export type GetUserByConnectionQuery = {
  users: {
    userByConnection: {
      id: string
      mainConnection: {
        platform: Platform
        platformId: string
        platformUsername: string
        platformDisplayName: string
      } | null
      style: {
        activeEmoteSetId: string | null
        activeEmoteSet: {
          id: string
          name: string
          emotes: {
            items: Array<{
              id: string
              alias: string
              flags: { zeroWidth: boolean }
              emote: {
                id: string
                defaultName: string
                aspectRatio: number
                flags: { animated: boolean }
                images: Array<{
                  url: string
                  mime: string
                  size: number
                  scale: number
                  width: number
                  height: number
                  frameCount: number
                }>
              }
            }>
          }
        } | null
      }
    } | null
  }
}
