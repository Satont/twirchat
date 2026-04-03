import { logger } from "@twirchat/shared/logger";

const log = logger("seventv:gql");

const SEVENTV_GQL_ENDPOINT = "https://7tv.io/v4/gql";

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
`;

export async function executeGraphQL<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(SEVENTV_GQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json() as { data?: T; errors?: Array<{ message: string }> };

  if (result.errors) {
    const errorMessage = result.errors.map((e) => e.message).join("; ");
    throw new Error(`GraphQL error: ${errorMessage}`);
  }

  if (!result.data) {
    throw new Error("No data returned from GraphQL");
  }

  return result.data;
}

export async function getUserByConnection(
  platform: "TWITCH" | "KICK",
  platformId: string,
): Promise<{
  users: {
    userByConnection?: {
      id: string;
      mainConnection?: {
        platform: string;
        platformId: string;
        platformUsername: string;
        platformDisplayName: string;
      };
      style: {
        activeEmoteSetId?: string;
        activeEmoteSet?: {
          id: string;
          name: string;
          emotes: {
            items: Array<{
              id: string;
              alias: string;
              flags: {
                zeroWidth: boolean;
              };
              emote: {
                id: string;
                defaultName: string;
                aspectRatio: number;
                flags: {
                  animated: boolean;
                };
                images: Array<{
                  url: string;
                  mime: string;
                  size: number;
                  scale: number;
                  width: number;
                  height: number;
                  frameCount: number;
                }>;
              };
            }>;
          };
        };
      };
    };
  };
}> {
  return executeGraphQL(GET_USER_BY_CONNECTION_QUERY, {
    platform,
    platformId,
  });
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
`;

export async function getEmoteSetById(id: string): Promise<{
  emoteSets: {
    emoteSet?: {
      id: string;
      name: string;
      emotes: {
        items: Array<{
          id: string;
          alias: string;
          flags: {
            zeroWidth: boolean;
          };
          emote: {
            id: string;
            defaultName: string;
            aspectRatio: number;
            flags: {
              animated: boolean;
            };
            images: Array<{
              url: string;
              mime: string;
              size: number;
              scale: number;
              width: number;
              height: number;
              frameCount: number;
            }>;
          };
        }>;
      };
    };
  };
}> {
  return executeGraphQL(GET_EMOTE_SET_BY_ID_QUERY, { id });
}
