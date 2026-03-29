const GQL_ENDPOINT = "https://7tv.io/v4/gql";

export interface SevenTVImage {
  url: string;
  mime: string;
  size: number;
  scale: number;
  width: number;
  height: number;
  frameCount: number;
}

export interface SevenTVEmote {
  id: string;
  defaultName: string;
  flags: {
    animated: boolean;
  };
  aspectRatio: number;
  images: SevenTVImage[];
}

export interface SevenTVEmoteSetEmote {
  id: string;
  alias: string;
  emote: SevenTVEmote;
  flags: {
    zeroWidth: boolean;
  };
}

export interface SevenTVEmoteSet {
  id: string;
  name: string;
  emotes: {
    items: SevenTVEmoteSetEmote[];
  };
}

export interface SevenTVUser {
  id: string;
  style: {
    activeEmoteSetId: string | null;
    activeEmoteSet: SevenTVEmoteSet | null;
  };
}

interface GQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function gqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`7TV GQL error: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as GQLResponse<T>;

  if (result.errors) {
    throw new Error(
      `7TV GQL errors: ${result.errors.map((e) => e.message).join(", ")}`
    );
  }

  if (!result.data) {
    throw new Error("7TV GQL: No data returned");
  }

  return result.data;
}

export async function fetchUserWithEmoteSet(userId: string): Promise<SevenTVUser | null> {
  const query = `
    query GetUser($id: Id!) {
      users {
        user(id: $id) {
          id
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

  const data = await gqlRequest<{ users: { user: SevenTVUser | null } }>(query, { id: userId });
  return data.users.user;
}

export async function fetchEmoteSet(emoteSetId: string): Promise<SevenTVEmoteSet | null> {
  const query = `
    query GetEmoteSet($id: Id!) {
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

  const data = await gqlRequest<{ emoteSets: { emoteSet: SevenTVEmoteSet | null } }>(query, { id: emoteSetId });
  return data.emoteSets.emoteSet;
}
