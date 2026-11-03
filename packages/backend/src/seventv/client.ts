import { z } from 'zod'
const SEVENTV_GQL_ENDPOINT = 'https://7tv.io/v4/gql'

// GraphQL query strings
const GET_USER_BY_CONNECTION_QUERY = `
query GetUserByConnection($platform: Platform!, $platformId: String!) {
  users {
    userByConnection(platform: $platform, platformId: $platformId) {
      id
      mainConnection {
        platform
        platformId
        platformUsername
        platformDisplayName
      }
      style {
        activeEmoteSetId
        activeEmoteSet {
          id
          name
          emotes(perPage: 1000) {
            items {
              id
              alias
              flags {
                zeroWidth
              }
              emote {
                id
                defaultName
                flags {
                  animated
                }
                aspectRatio
                images {
                  url
                  mime
                  size
                  scale
                  width
                  height
                  frameCount
                }
              }
            }
          }
        }
      }
    }
  }
}
`

export async function executeGraphQL<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
  resultSchema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(SEVENTV_GQL_ENDPOINT, {
    body: JSON.stringify({
      query,
      variables,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const result = z
    .object({
      data: resultSchema.nullish(),
      errors: z.array(z.object({ message: z.string() })).nullish(),
    })
    .parse(await response.json())

  if (result.errors) {
    const errorMessage = result.errors.map((e) => e.message).join('; ')
    throw new Error(`GraphQL error: ${errorMessage}`)
  }

  if (!result.data) {
    throw new Error('No data returned from GraphQL')
  }

  return result.data
}

export async function getUserByConnection(
  platform: 'TWITCH' | 'KICK',
  platformId: string,
): Promise<z.infer<typeof getUserByConnectionSchema>> {
  return executeGraphQL(
    GET_USER_BY_CONNECTION_QUERY,
    {
      platform,
      platformId,
    },
    getUserByConnectionSchema,
  )
}

const GET_EMOTE_SET_BY_ID_QUERY = `
query GetEmoteSetById($id: Id!) {
  emoteSets {
    emoteSet(id: $id) {
      id
      name
      emotes(perPage: 1000) {
        items {
          id
          alias
          flags {
            zeroWidth
          }
          emote {
            id
            defaultName
            flags {
              animated
            }
            aspectRatio
            images {
              url
              mime
              size
              scale
              width
              height
              frameCount
            }
          }
        }
      }
    }
  }
}
`

export async function getEmoteSetById(id: string): Promise<z.infer<typeof getEmoteSetByIdSchema>> {
  return executeGraphQL(GET_EMOTE_SET_BY_ID_QUERY, { id }, getEmoteSetByIdSchema)
}

const getUserByConnectionSchema = z.object({
  users: z.object({
    userByConnection: z
      .object({
        id: z.string(),
        mainConnection: z
          .object({
            platform: z.string(),
            platformId: z.string(),
            platformUsername: z.string(),
            platformDisplayName: z.string(),
          })
          .nullish(),
        style: z.object({
          activeEmoteSetId: z.string().nullish(),
          activeEmoteSet: z
            .object({
              id: z.string(),
              name: z.string(),
              emotes: z.object({
                items: z.array(
                  z.object({
                    id: z.string(),
                    alias: z.string(),
                    flags: z.object({ zeroWidth: z.boolean() }),
                    emote: z.object({
                      id: z.string(),
                      defaultName: z.string(),
                      aspectRatio: z.number(),
                      flags: z.object({ animated: z.boolean() }),
                      images: z.array(
                        z.object({
                          url: z.string(),
                          mime: z.string(),
                          size: z.number(),
                          scale: z.number(),
                          width: z.number(),
                          height: z.number(),
                          frameCount: z.number(),
                        }),
                      ),
                    }),
                  }),
                ),
              }),
            })
            .nullish(),
        }),
      })
      .nullish(),
  }),
})

const getEmoteSetByIdSchema = z.object({
  emoteSets: z.object({
    emoteSet: z
      .object({
        id: z.string(),
        name: z.string(),
        emotes: z.object({
          items: z.array(
            z.object({
              id: z.string(),
              alias: z.string(),
              flags: z.object({ zeroWidth: z.boolean() }),
              emote: z.object({
                id: z.string(),
                defaultName: z.string(),
                aspectRatio: z.number(),
                flags: z.object({ animated: z.boolean() }),
                images: z.array(
                  z.object({
                    url: z.string(),
                    mime: z.string(),
                    size: z.number(),
                    scale: z.number(),
                    width: z.number(),
                    height: z.number(),
                    frameCount: z.number(),
                  }),
                ),
              }),
            }),
          ),
        }),
      })
      .nullish(),
  }),
})
