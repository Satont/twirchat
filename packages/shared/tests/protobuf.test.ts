import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire'
import { loadSync } from '@grpc/proto-loader'

import { LiveChatMessageListRequest, LiveChatMessageListResponse } from '../youtube/gen/stream_list'
import { RecursiveNode, RecursiveNode_Kind } from './fixtures/gen/codec'
import { decodeDepth } from './fixtures/gen/ts-proto-depth'

const definitions = loadSync(resolve(import.meta.dir, '../youtube/stream_list.proto'), {
  keepCase: false,
  longs: Number,
  enums: Number,
  defaults: false,
})

function referenceSerialize(name: string, message: object): Buffer {
  const definition = definitions[`youtube.api.v3.${name}`]
  if (!definition || !('serialize' in definition) || typeof definition.serialize !== 'function')
    throw new Error(`Missing reference protobuf serializer: ${name}`)
  return definition.serialize(message)
}

describe('generated protobuf wire compatibility', () => {
  test('request bytes match the independent protobuf.js/proto-loader implementation', () => {
    const request = LiveChatMessageListRequest.create({
      liveChatId: 'chat',
      hl: 'ru',
      profileImageSize: 64,
      maxResults: 100,
      pageToken: 'cursor',
      part: ['id', 'snippet', 'authorDetails'],
    })
    expect(Buffer.from(LiveChatMessageListRequest.encode(request).finish()).toString('hex')).toBe(
      referenceSerialize('LiveChatMessageListRequest', request).toString('hex'),
    )
    expect(
      LiveChatMessageListRequest.decode(referenceSerialize('LiveChatMessageListRequest', request)),
    ).toEqual(request)
  })

  test('nested paid, poll, author and resume-token fields interoperate with independent protobuf bytes', () => {
    const response = LiveChatMessageListResponse.fromPartial({
      nextPageToken: 'resume',
      offlineAt: '2026-11-02T00:00:00Z',
      pageInfo: { totalResults: 1, resultsPerPage: 1 },
      items: [
        {
          id: 'one',
          snippet: {
            type: 15,
            liveChatId: 'chat',
            superChatDetails: {
              amountMicros: Number.MAX_SAFE_INTEGER,
              currency: 'USD',
              userComment: 'hello',
            },
          },
          authorDetails: { channelId: 'viewer', isChatModerator: true },
        },
      ],
      activePollItem: {
        id: 'poll',
        snippet: {
          type: 20,
          pollDetails: {
            metadata: { questionText: 'Question?', options: [{ optionText: 'A', tally: 12 }] },
          },
        },
      },
    })
    const bytes = LiveChatMessageListResponse.encode(response).finish()
    expect(
      LiveChatMessageListResponse.decode(
        referenceSerialize('LiveChatMessageListResponse', response),
      ),
    ).toEqual(response)
    expect(LiveChatMessageListResponse.decode(bytes)).toEqual(response)
  })

  test('unknown enum values and unknown fields survive decoding without unsafe narrowing', () => {
    const bytes = new BinaryWriter().uint32(8).int32(999).uint32(802).string('future').finish()
    const node = RecursiveNode.decode(bytes)
    expect(Number(node.kind)).toBe(999)
    expect(RecursiveNode.decode(RecursiveNode.encode(node).finish()).kind).toBe(node.kind)
    expect(RecursiveNode.create({ kind: RecursiveNode_Kind.KIND_ALPHA }).kind).toBe(
      RecursiveNode_Kind.KIND_ALPHA,
    )
  })

  test('recursive decode depth is bounded and state is restored after both success and failure', () => {
    let node = RecursiveNode.create({ value: 1, duration: { seconds: 90, nanos: 5 } })
    for (let depth = 0; depth < 98; depth++) node = RecursiveNode.create({ child: node })
    const valid = new BinaryReader(RecursiveNode.encode(node).finish())
    expect(RecursiveNode.decode(valid)).toEqual(node)
    expect(decodeDepth.has(valid)).toBe(false)
    for (let depth = 0; depth < 3; depth++) node = RecursiveNode.create({ child: node })
    const invalid = new BinaryReader(RecursiveNode.encode(node).finish())
    expect(() => RecursiveNode.decode(invalid)).toThrow('recursion limit')
    expect(decodeDepth.has(invalid)).toBe(false)
    const truncated = new BinaryReader(Uint8Array.from([26, 100]))
    expect(() => RecursiveNode.decode(truncated)).toThrow()
    expect(decodeDepth.has(truncated)).toBe(false)
  })

  test('proto2 boolean default checks preserve false values when their declared default is true', () => {
    const node = RecursiveNode.create({ flag: false, simpleFlag: true })
    expect(Buffer.from(RecursiveNode.encode(node).finish()).toString('hex')).toBe('30003801')
    expect(RecursiveNode.decode(RecursiveNode.encode(node).finish())).toEqual(node)
    expect(
      RecursiveNode.encode(RecursiveNode.create({ flag: true, simpleFlag: false })).finish(),
    ).toHaveLength(0)
  })

  test('64-bit integer conversion rejects values outside the JavaScript safe range', () => {
    const overflow = new BinaryWriter().uint32(16).uint64(9007199254740992n).finish()
    expect(() => RecursiveNode.decode(overflow)).toThrow('Number.MAX_SAFE_INTEGER')
  })
})
