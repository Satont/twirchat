import { z } from 'zod'

const SEVENTV_GQL_ENDPOINT = 'https://7tv.io/v4/gql'
const SEVENTV_REQUEST_TIMEOUT_MS = 10_000

const EMOTE_SET_FIELDS = `
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
`

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
${EMOTE_SET_FIELDS}
        }
      }
    }
  }
}
`

async function executeGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  resultSchema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(SEVENTV_REQUEST_TIMEOUT_MS)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  requestSignal.throwIfAborted()
  const response = await fetch(SEVENTV_GQL_ENDPOINT, {
    body: JSON.stringify({
      query,
      variables,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal: requestSignal,
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
  signal?: AbortSignal,
): Promise<z.infer<typeof getUserByConnectionSchema>> {
  return executeGraphQL(
    GET_USER_BY_CONNECTION_QUERY,
    {
      platform,
      platformId,
    },
    getUserByConnectionSchema,
    signal,
  )
}

const GET_EMOTE_SET_BY_ID_QUERY = `
query GetEmoteSetById($id: Id!) {
  emoteSets {
    emoteSet(id: $id) {
${EMOTE_SET_FIELDS}
    }
  }
}
`

export async function getEmoteSetById(id: string): Promise<z.infer<typeof getEmoteSetByIdSchema>> {
  return executeGraphQL(GET_EMOTE_SET_BY_ID_QUERY, { id }, getEmoteSetByIdSchema)
}

const emoteSetSchema = z.object({
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
          activeEmoteSet: emoteSetSchema.nullish(),
        }),
      })
      .nullish(),
  }),
})

const getEmoteSetByIdSchema = z.object({
  emoteSets: z.object({
    emoteSet: emoteSetSchema.nullish(),
  }),
})
