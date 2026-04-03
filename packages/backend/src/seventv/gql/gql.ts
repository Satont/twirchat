/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "query GetEmoteSet($id: Id!) {\n  emoteSets {\n    emoteSet(id: $id) {\n      id\n      name\n      emotes(perPage: 1000) {\n        items {\n          id\n          alias\n          flags {\n            zeroWidth\n          }\n          emote {\n            id\n            defaultName\n            flags {\n              animated\n            }\n            aspectRatio\n            images {\n              url\n              mime\n              size\n              scale\n              width\n              height\n              frameCount\n            }\n          }\n        }\n      }\n    }\n  }\n}": typeof types.GetEmoteSetDocument,
    "query GetUserByConnection($platform: Platform!, $platformId: String!) {\n  users {\n    userByConnection(platform: $platform, platformId: $platformId) {\n      id\n      mainConnection {\n        platform\n        platformId\n        platformUsername\n        platformDisplayName\n      }\n      style {\n        activeEmoteSetId\n        activeEmoteSet {\n          id\n          name\n          emotes(perPage: 1000) {\n            items {\n              id\n              alias\n              flags {\n                zeroWidth\n              }\n              emote {\n                id\n                defaultName\n                flags {\n                  animated\n                }\n                aspectRatio\n                images {\n                  url\n                  mime\n                  size\n                  scale\n                  width\n                  height\n                  frameCount\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}": typeof types.GetUserByConnectionDocument,
};
const documents: Documents = {
    "query GetEmoteSet($id: Id!) {\n  emoteSets {\n    emoteSet(id: $id) {\n      id\n      name\n      emotes(perPage: 1000) {\n        items {\n          id\n          alias\n          flags {\n            zeroWidth\n          }\n          emote {\n            id\n            defaultName\n            flags {\n              animated\n            }\n            aspectRatio\n            images {\n              url\n              mime\n              size\n              scale\n              width\n              height\n              frameCount\n            }\n          }\n        }\n      }\n    }\n  }\n}": types.GetEmoteSetDocument,
    "query GetUserByConnection($platform: Platform!, $platformId: String!) {\n  users {\n    userByConnection(platform: $platform, platformId: $platformId) {\n      id\n      mainConnection {\n        platform\n        platformId\n        platformUsername\n        platformDisplayName\n      }\n      style {\n        activeEmoteSetId\n        activeEmoteSet {\n          id\n          name\n          emotes(perPage: 1000) {\n            items {\n              id\n              alias\n              flags {\n                zeroWidth\n              }\n              emote {\n                id\n                defaultName\n                flags {\n                  animated\n                }\n                aspectRatio\n                images {\n                  url\n                  mime\n                  size\n                  scale\n                  width\n                  height\n                  frameCount\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}": types.GetUserByConnectionDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetEmoteSet($id: Id!) {\n  emoteSets {\n    emoteSet(id: $id) {\n      id\n      name\n      emotes(perPage: 1000) {\n        items {\n          id\n          alias\n          flags {\n            zeroWidth\n          }\n          emote {\n            id\n            defaultName\n            flags {\n              animated\n            }\n            aspectRatio\n            images {\n              url\n              mime\n              size\n              scale\n              width\n              height\n              frameCount\n            }\n          }\n        }\n      }\n    }\n  }\n}"): (typeof documents)["query GetEmoteSet($id: Id!) {\n  emoteSets {\n    emoteSet(id: $id) {\n      id\n      name\n      emotes(perPage: 1000) {\n        items {\n          id\n          alias\n          flags {\n            zeroWidth\n          }\n          emote {\n            id\n            defaultName\n            flags {\n              animated\n            }\n            aspectRatio\n            images {\n              url\n              mime\n              size\n              scale\n              width\n              height\n              frameCount\n            }\n          }\n        }\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetUserByConnection($platform: Platform!, $platformId: String!) {\n  users {\n    userByConnection(platform: $platform, platformId: $platformId) {\n      id\n      mainConnection {\n        platform\n        platformId\n        platformUsername\n        platformDisplayName\n      }\n      style {\n        activeEmoteSetId\n        activeEmoteSet {\n          id\n          name\n          emotes(perPage: 1000) {\n            items {\n              id\n              alias\n              flags {\n                zeroWidth\n              }\n              emote {\n                id\n                defaultName\n                flags {\n                  animated\n                }\n                aspectRatio\n                images {\n                  url\n                  mime\n                  size\n                  scale\n                  width\n                  height\n                  frameCount\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}"): (typeof documents)["query GetUserByConnection($platform: Platform!, $platformId: String!) {\n  users {\n    userByConnection(platform: $platform, platformId: $platformId) {\n      id\n      mainConnection {\n        platform\n        platformId\n        platformUsername\n        platformDisplayName\n      }\n      style {\n        activeEmoteSetId\n        activeEmoteSet {\n          id\n          name\n          emotes(perPage: 1000) {\n            items {\n              id\n              alias\n              flags {\n                zeroWidth\n              }\n              emote {\n                id\n                defaultName\n                flags {\n                  animated\n                }\n                aspectRatio\n                images {\n                  url\n                  mime\n                  size\n                  scale\n                  width\n                  height\n                  frameCount\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;