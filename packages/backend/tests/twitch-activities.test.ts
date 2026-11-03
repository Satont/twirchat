import { describe, expect, test } from 'bun:test'

import type { TwitchActivityAction } from '@twirchat/shared/twitch-activities'

import {
  createTwitchActivitiesService,
  type TwitchActivitiesCredentials,
} from '../src/api/twitch-activities'
import { twitchActivitiesRoutes } from '../src/routes/twitch-activities'
import { textBody } from './literal'
import { literal, required } from './literal'

const scopes = [
  'channel:manage:polls',
  'channel:manage:predictions',
  'channel:manage:redemptions',
  'moderator:manage:chat_messages',
  'user:read:follows',
  'user:manage:whispers',
  'moderator:read:followers',
]
const account: TwitchActivitiesCredentials = {
  accessToken: 'oauth-token',
  platformUserId: '100',
  scopes,
  webSession: { token: 'web-secret', userId: '100', username: 'creator', clientId: 'web-client' },
}
function fixture(
  respond: (url: URL, init: RequestInit) => Response = () => Response.json({ data: [] }),
) {
  const calls: { url: URL; init: RequestInit }[] = []
  const service = createTwitchActivitiesService({
    async fetch(url, init = {}) {
      const parsed = new URL(url)
      calls.push({ url: parsed, init })
      return respond(parsed, init)
    },
    async resolveUser(identifier) {
      return identifier === 'creator' ? '100' : '200'
    },
  })
  return { service, calls }
}

const cases: {
  action: TwitchActivityAction
  path: string
  method: string
  query?: Record<string, string | string[]>
  body?: unknown
}[] = [
  {
    action: {
      channelSlug: 'creator',
      action: 'create_poll',
      title: 'Question',
      choices: ['A', 'B'],
      duration: 60,
      pointsPerVote: 10,
    },
    path: 'polls',
    method: 'POST',
    body: {
      broadcaster_id: '100',
      title: 'Question',
      choices: [{ title: 'A' }, { title: 'B' }],
      duration: 60,
      channel_points_voting_enabled: true,
      channel_points_per_vote: 10,
    },
  },
  ...literal(['end_poll', 'archive_poll']).map((action) => ({
    action: { channelSlug: 'creator', action, pollId: 'poll' },
    path: 'polls',
    method: 'PATCH',
    body: {
      broadcaster_id: '100',
      id: 'poll',
      status: action === 'end_poll' ? 'TERMINATED' : 'ARCHIVED',
    },
  })),
  {
    action: {
      channelSlug: 'creator',
      action: 'create_prediction',
      title: 'Outcome?',
      outcomes: ['Yes', 'No'],
      duration: 120,
    },
    path: 'predictions',
    method: 'POST',
    body: {
      broadcaster_id: '100',
      title: 'Outcome?',
      outcomes: [{ title: 'Yes' }, { title: 'No' }],
      prediction_window: 120,
    },
  },
  ...literal(['lock_prediction', 'cancel_prediction']).map((action) => ({
    action: { channelSlug: 'creator', action, predictionId: 'prediction' },
    path: 'predictions',
    method: 'PATCH',
    body: {
      broadcaster_id: '100',
      id: 'prediction',
      status: action === 'lock_prediction' ? 'LOCKED' : 'CANCELED',
    },
  })),
  {
    action: {
      channelSlug: 'creator',
      action: 'resolve_prediction',
      predictionId: 'prediction',
      outcomeId: 'winner',
    },
    path: 'predictions',
    method: 'PATCH',
    body: {
      broadcaster_id: '100',
      id: 'prediction',
      status: 'RESOLVED',
      winning_outcome_id: 'winner',
    },
  },
  {
    action: { channelSlug: 'creator', action: 'pin_message', messageId: 'message', duration: 300 },
    path: 'chat/pins',
    method: 'PUT',
    query: {
      broadcaster_id: '100',
      moderator_id: '100',
      message_id: 'message',
      duration_seconds: '300',
    },
  },
  {
    action: { channelSlug: 'creator', action: 'update_pin', messageId: 'message', duration: 600 },
    path: 'chat/pins',
    method: 'PATCH',
    query: {
      broadcaster_id: '100',
      moderator_id: '100',
      message_id: 'message',
      duration_seconds: '600',
    },
  },
  {
    action: { channelSlug: 'creator', action: 'unpin_message', messageId: 'message' },
    path: 'chat/pins',
    method: 'DELETE',
    query: { broadcaster_id: '100', moderator_id: '100', message_id: 'message' },
  },
  {
    action: {
      channelSlug: 'creator',
      action: 'update_reward',
      rewardId: 'reward',
      patch: { isPaused: true, isEnabled: false, title: 'New name', cost: 100 },
    },
    path: 'channel_points/custom_rewards',
    method: 'PATCH',
    query: { broadcaster_id: '100', id: 'reward' },
    body: { title: 'New name', cost: 100, is_enabled: false, is_paused: true },
  },
  {
    action: {
      channelSlug: 'creator',
      action: 'update_redemptions',
      rewardId: 'reward',
      ids: ['one', 'two'],
      status: 'FULFILLED',
    },
    path: 'channel_points/custom_rewards/redemptions',
    method: 'PATCH',
    query: { broadcaster_id: '100', reward_id: 'reward', id: ['one', 'two'] },
    body: { status: 'FULFILLED' },
  },
  {
    action: { channelSlug: 'creator', action: 'send_whisper', username: 'friend', text: 'Hello' },
    path: 'whispers',
    method: 'POST',
    query: { from_user_id: '100', to_user_id: '200' },
    body: { message: 'Hello' },
  },
]

describe('Twitch activities public API', () => {
  for (const item of cases)
    test(item.action.action, async () => {
      const { service, calls } = fixture()
      await service.execute({ ...account, webSession: null }, item.action)
      expect(calls).toHaveLength(1)
      const call = required(calls[0])
      expect(call.url.origin + call.url.pathname).toBe(`https://api.twitch.tv/helix/${item.path}`)
      expect(call.init.method).toBe(item.method)
      for (const [key, value] of Object.entries(item.query ?? {}))
        expect(call.url.searchParams.getAll(key)).toEqual(Array.isArray(value) ? value : [value])
      expect(call.init.body ? JSON.parse(textBody(call.init.body)) : undefined).toEqual(item.body)
      expect(new Headers(call.init.headers).get('authorization')).toBe('Bearer oauth-token')
    })

  test('returns section errors for missing scope rather than inventing an empty activity snapshot', async () => {
    const { service, calls } = fixture()
    const result = await service.snapshot({ ...account, scopes: [], webSession: null }, 'creator')
    expect(Object.keys(result.errors).sort()).toEqual([
      'pinnedMessage',
      'polls',
      'predictions',
      'rewards',
    ])
    expect(calls).toHaveLength(1)
    expect(required(calls[0]).url.toString()).toBe('https://gql.twitch.tv/gql')
    await expect(
      service.execute({ ...account, scopes: [] }, required(cases[0]).action),
    ).rejects.toThrow('channel:manage:polls')
  })

  test('validates invalid actions before any external writes', async () => {
    const { service, calls } = fixture()
    const invalid: TwitchActivityAction[] = [
      {
        channelSlug: 'creator',
        action: 'create_poll',
        title: 'bad',
        choices: ['one'],
        duration: 60,
      },
      { channelSlug: 'creator', action: 'pin_message', messageId: 'm', duration: 1 },
      {
        channelSlug: 'creator',
        action: 'update_redemptions',
        rewardId: 'r',
        ids: [],
        status: 'CANCELED',
      },
      {
        channelSlug: 'creator',
        action: 'place_bet',
        predictionId: 'p',
        outcomeId: 'o',
        points: -5,
      },
      { channelSlug: 'creator', action: 'vote_poll', pollId: 'p', choiceId: 'c', votes: 2 },
    ]
    for (const action of invalid) await expect(service.execute(account, action)).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  test('maps redemption pagination and status fields', async () => {
    const { service, calls } = fixture(() =>
      Response.json({
        data: [
          {
            id: 'one',
            reward: { id: 'reward' },
            user_id: '200',
            user_name: 'Viewer',
            user_input: 'hello',
            status: 'UNFULFILLED',
            redeemed_at: 'now',
          },
        ],
        pagination: { cursor: 'next' },
      }),
    )
    expect(
      await service.redemptions(
        { ...account, webSession: null },
        {
          channelSlug: 'creator',
          rewardId: 'reward',
          cursor: 'previous',
        },
      ),
    ).toEqual({
      redemptions: [
        {
          id: 'one',
          rewardId: 'reward',
          userId: '200',
          userName: 'Viewer',
          input: 'hello',
          status: 'UNFULFILLED',
          redeemedAt: 'now',
        },
      ],
      cursor: 'next',
    })
    expect(required(calls[0]).url.searchParams.get('after')).toBe('previous')
  })

  test('loads followed channels and annotates current live status', async () => {
    const { service, calls } = fixture((url) =>
      url.pathname.endsWith('/channels/followed')
        ? Response.json({
            data: [
              { broadcaster_id: '200', broadcaster_login: 'friend', broadcaster_name: 'Friend' },
            ],
            pagination: { cursor: 'next' },
            total: 20,
          })
        : Response.json({
            data: [{ user_id: '200', title: 'Live now', viewer_count: 123, game_name: 'Game' }],
          }),
    )
    expect(await service.following(account, {})).toEqual({
      channels: [
        {
          id: '200',
          login: 'friend',
          displayName: 'Friend',
          isLive: true,
          title: 'Live now',
          viewerCount: 123,
          categoryName: 'Game',
        },
      ],
      cursor: 'next',
      total: 20,
    })
    expect(required(calls[0]).url.searchParams.get('user_id')).toBe('100')
    expect(required(calls[1]).url.searchParams.get('user_id')).toBe('200')
  })
})

describe('Twitch web session operations from pinned Leafyrino contracts', () => {
  for (const action of literal(['vote_poll', 'place_bet', 'redeem_reward', 'follow', 'unfollow']))
    test(action, async () => {
      const payload = {
        channelSlug: 'creator',
        action,
        pollId: 'poll',
        choiceId: 'choice',
        predictionId: 'prediction',
        outcomeId: 'outcome',
        points: 100,
        rewardId: 'reward',
        rewardTitle: 'Reward',
        cost: 100,
        input: 'Text',
        votes: 3,
        pointsPerVote: 10,
      }
      const field = {
        vote_poll: 'voteInPoll',
        place_bet: 'makePrediction',
        redeem_reward: 'redeemCommunityPointsCustomReward',
        follow: 'followUser',
        unfollow: 'unfollowUser',
      }[action]
      const { service, calls } = fixture(() =>
        Response.json([{ data: { [field]: { error: null } } }]),
      )
      await service.execute(account, payload)
      const call = required(calls[0])
      expect(call.url.toString()).toBe('https://gql.twitch.tv/gql')
      const headers = new Headers(call.init.headers)
      expect(headers.get('authorization')).toBe('OAuth web-secret')
      expect(headers.get('client-id')).toBe(
        action === 'follow' || action === 'unfollow' || action === 'redeem_reward'
          ? 'ue6666qo983tsx6so1t0vnawi233wa'
          : 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      )
      const request = JSON.parse(textBody(call.init.body))[0]
      if (action === 'vote_poll') {
        expect(request.query).toContain('mutation VoteInPoll')
        expect(request.variables.input).toMatchObject({
          pollID: 'poll',
          choiceID: 'choice',
          userID: '100',
          tokens: { channelPoints: 20 },
        })
      } else if (action === 'place_bet') {
        expect(request.operationName).toBe('MakePrediction')
        expect(request.variables.input).toMatchObject({
          eventID: 'prediction',
          outcomeID: 'outcome',
          points: 100,
        })
        expect(request.extensions.persistedQuery.sha256Hash).toBe(
          'b44682ecc88358817009f20e69d75081b1e58825bb40aa53d5dbadcc17c881d8',
        )
      } else if (action === 'redeem_reward')
        expect(request.variables.input).toMatchObject({
          channelID: '100',
          cost: 100,
          pricingType: 'POINTS',
          rewardID: 'reward',
          title: 'Reward',
          textInput: 'Text',
          prompt: null,
        })
      else
        expect(request.variables.input).toEqual(
          action === 'follow'
            ? { targetID: '100', disableNotifications: false }
            : { targetID: '100' },
        )
    })

  test('rejects missing/wrong web session identities and GraphQL operation errors', async () => {
    const action: TwitchActivityAction = { channelSlug: 'creator', action: 'follow' }
    const { service, calls } = fixture(() =>
      Response.json([{ data: { followUser: { error: { code: 'FORBIDDEN' } } } }]),
    )
    await expect(service.execute({ ...account, webSession: null }, action)).rejects.toThrow(
      'web session',
    )
    await expect(
      service.execute(
        { ...account, webSession: { ...required(account.webSession), userId: 'other' } },
        action,
      ),
    ).rejects.toThrow('connected Twitch account')
    expect(calls).toHaveLength(0)
    await expect(service.execute(account, action)).rejects.toThrow('FORBIDDEN')
  })

  test('validates a user web session without exposing it in error messages', async () => {
    const { service, calls } = fixture(() =>
      Response.json({ user_id: '100', login: 'creator', client_id: 'web-client' }),
    )
    expect(await service.validateWebSession('oauth:secret')).toEqual({
      token: 'secret',
      userId: '100',
      username: 'creator',
      clientId: 'web-client',
    })
    expect(required(calls[0]).url.toString()).toBe('https://id.twitch.tv/oauth2/validate')
    expect(new Headers(required(calls[0]).init.headers).get('authorization')).toBe('OAuth secret')
  })

  test('loads actual viewer poll/prediction/reward snapshots and points balance', async () => {
    const { service } = fixture((url, init) => {
      if (url.hostname === 'gql.twitch.tv') {
        const request = JSON.parse(textBody(init.body))[0]
        if (request.query?.includes('ChannelPollContext'))
          return Response.json([
            {
              data: {
                user: {
                  viewablePoll: {
                    id: 'p',
                    title: 'Question',
                    status: 'ACTIVE',
                    choices: [{ id: 'c', title: 'Yes', votes: { total: 4, communityPoints: 2 } }],
                  },
                },
              },
            },
          ])
        if (request.query?.includes('ChannelPointsPredictionContext'))
          return Response.json([
            {
              data: {
                channel: {
                  activePredictionEvents: [
                    {
                      id: 'prediction',
                      title: 'Will it work?',
                      status: 'ACTIVE',
                      outcomes: [{ id: 'outcome', title: 'Yes', totalUsers: 5, totalPoints: 100 }],
                    },
                  ],
                  lockedPredictionEvents: [],
                },
              },
            },
          ])
        return Response.json([
          {
            data: {
              community: {
                channel: {
                  self: { communityPoints: { balance: 1234 } },
                  communityPointsSettings: {
                    customRewards: [
                      { id: 'reward', title: 'Hi', cost: 50, isEnabled: true, isPaused: false },
                    ],
                  },
                },
              },
            },
          },
        ])
      }
      return Response.json({ data: [] })
    })
    const result = await service.snapshot(account, 'creator')
    expect(result.errors).toEqual({})
    expect(required(required(result.polls[0]).choices[0]).votes).toBe(4)
    expect(required(required(result.predictions[0]).outcomes[0]).points).toBe(100)
    expect(required(result.rewards[0]).cost).toBe(50)
    expect(result.pointsBalance).toBe(1234)
  })
})

test('creates authorized EventSub registrations with exact version, conditions and websocket transport', async () => {
  let id = 0
  const { service, calls } = fixture(() => Response.json({ data: [{ id: String(++id) }] }))
  const own = await service.subscribe(account, 'socket-session', 'creator')
  expect(own.errors).toEqual([])
  expect(own.subscriptions.map((sub) => sub.type)).toContain('channel.poll.begin')
  expect(own.subscriptions.map((sub) => sub.type)).toContain('channel.prediction.lock')
  expect(own.subscriptions.map((sub) => sub.type)).toContain('stream.online')
  expect(own.subscriptions.map((sub) => sub.type)).not.toContain('channel.chat.message_pin')
  const follow = required(
    calls.find((call) => JSON.parse(textBody(call.init.body)).type === 'channel.follow'),
  )
  expect(JSON.parse(textBody(follow.init.body))).toEqual({
    type: 'channel.follow',
    version: '2',
    condition: { broadcaster_user_id: '100', moderator_user_id: '100' },
    transport: { method: 'websocket', session_id: 'socket-session' },
  })
  const before = calls.length
  await service.subscribe(account, 'socket-session')
  expect(JSON.parse(textBody(required(calls[before]).init.body))).toEqual({
    type: 'user.whisper.message',
    version: '1',
    condition: { user_id: '100' },
    transport: { method: 'websocket', session_id: 'socket-session' },
  })
  const viewer = await service.subscribe(account, 'socket-session', 'friend')
  expect(viewer.subscriptions.map((sub) => sub.type)).toEqual(['stream.online', 'stream.offline'])
})

test('activity route requires a desktop client', async () => {
  expect(
    (
      await twitchActivitiesRoutes['/api/twitch/activities'].POST(
        new Request('http://localhost/api/twitch/activities', { method: 'POST', body: '{}' }),
      )
    ).status,
  ).toBe(401)
})

test('reports EventSub registration failures without claiming a live subscription', async () => {
  const denied = fixture(() =>
    Response.json({ message: 'Missing authorization scope' }, { status: 403 }),
  )
  const rejected = await denied.service.subscribe(account, 'socket')
  expect(rejected.subscriptions).toEqual([])
  expect(rejected.errors).toEqual(['Missing authorization scope'])
  const invalid = fixture()
  const missing = await invalid.service.subscribe(account, 'socket')
  expect(missing.subscriptions).toEqual([])
  expect(missing.errors[0]).toContain('did not confirm')
})

describe('web-created reward moderation through upstream GQL', () => {
  const mutations: {
    action: TwitchActivityAction
    operationName: string
    hash: string
    field: string
    input: Record<string, unknown>
  }[] = [
    {
      action: {
        channelSlug: 'creator',
        action: 'update_reward',
        rewardId: 'reward',
        patch: { isPaused: true },
      },
      operationName: 'PauseCustomRewardRedemptions',
      hash: '1217cae91b1ebc6eba035ebce8ba308d255b0e7c4524130f739e176213b95b7a',
      field: 'updateCommunityPointsCustomReward',
      input: { channelID: '100', rewardID: 'reward', isPaused: true },
    },
    ...literal(['FULFILLED', 'CANCELED']).map((status) => ({
      action: {
        channelSlug: 'creator',
        action: literal('update_redemptions'),
        rewardId: 'reward',
        ids: ['redemption'],
        status,
      },
      operationName: 'UpdateCoPoCustomRewardStatus',
      hash: 'd940a7ebb2e588c3fc0c69a2fb61c5aeb566833f514cf55b9de728082c90361d',
      field: 'updateCommunityPointsCustomRewardRedemptionStatus',
      input: { channelID: '100', redemptionID: 'redemption', newStatus: status },
    })),
    {
      action: {
        channelSlug: 'creator',
        action: 'update_redemptions',
        rewardId: 'reward',
        ids: ['one', 'two'],
        status: 'CANCELED',
      },
      operationName: 'BulkUpdateRedemptions',
      hash: 'cba9ec6d62b16450c3b6fad790b6c4bc26ff3efb68731bbbb7ecc24c3b9188ce',
      field: 'updateCommunityPointsCustomRewardRedemptionStatusesByRedemptions',
      input: {
        channelID: '100',
        newStatus: 'CANCELED',
        oldStatus: 'UNFULFILLED',
        redemptionIDs: ['one', 'two'],
      },
    },
  ]
  for (const item of mutations)
    test(`${item.operationName} ${item.action.action}`, async () => {
      const { service, calls } = fixture(() =>
        Response.json([{ data: { [item.field]: { error: null } } }]),
      )
      await service.execute({ ...account, scopes: [] }, item.action)
      const request = required(calls[0])
      expect(request.url.toString()).toBe('https://gql.twitch.tv/gql')
      const headers = new Headers(request.init.headers)
      expect(headers.get('authorization')).toBe('OAuth web-secret')
      expect(headers.get('client-id')).toBe('ue6666qo983tsx6so1t0vnawi233wa')
      expect(headers.get('origin')).toBe('https://android.tv.twitch.tv')
      const operation = JSON.parse(textBody(request.init.body))[0]
      expect(operation.operationName).toBe(item.operationName)
      expect(operation.extensions.persistedQuery.sha256Hash).toBe(item.hash)
      expect(operation.variables).toEqual({ input: item.input })
    })

  test('loads the real pending queue across pages, optionally filtered by reward', async () => {
    let page = 0
    const { service, calls } = fixture((url) => {
      if (url.hostname !== 'gql.twitch.tv')
        return Response.json({ data: [{ id: '200', display_name: 'Viewer' }] })
      page++
      return Response.json([
        {
          data: {
            user: {
              channel: {
                communityPointsRedemptionQueue: {
                  pageInfo: { hasNextPage: page === 1 },
                  edges: [
                    {
                      cursor: `cursor-${page}`,
                      node: {
                        id: `redemption-${page}`,
                        reward: { id: 'reward', title: 'Reward' },
                        user: { id: '200' },
                        input: 'Hello',
                        timestamp: '2026-11-02T00:00:00Z',
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ])
    })
    const first = await service.redemptions({ ...account, scopes: [] }, { channelSlug: 'creator' })
    expect(first.cursor).toBe('cursor-1')
    expect(first.redemptions[0]).toEqual({
      id: 'redemption-1',
      rewardId: 'reward',
      userId: '200',
      userName: 'Viewer',
      input: 'Hello',
      status: 'UNFULFILLED',
      redeemedAt: '2026-11-02T00:00:00Z',
    })
    const second = await service.redemptions(
      { ...account, scopes: [] },
      { channelSlug: 'creator', rewardId: 'reward', cursor: first.cursor },
    )
    expect(second.cursor).toBeUndefined()
    const requests = calls
      .filter((call) => call.url.hostname === 'gql.twitch.tv')
      .map((call) => JSON.parse(textBody(call.init.body))[0])
    expect(requests[0].operationName).toBe('RedemptionsByRewardID_Paginated')
    expect(requests[0].extensions.persistedQuery.sha256Hash).toBe(
      '74740dc72455f428e464fad11770a543c3ac1092b89cb39ed7411ff3a69e6d37',
    )
    expect(requests[0].variables).toEqual({ channelLogin: 'creator', order: 'NEWEST', count: 50 })
    expect(requests[1].variables).toEqual({
      channelLogin: 'creator',
      order: 'NEWEST',
      count: 50,
      id: 'reward',
      cursor: 'cursor-1',
    })
  })

  test('loads queue counts per reward', async () => {
    const { service, calls } = fixture(() =>
      Response.json([
        {
          data: {
            user: {
              channel: {
                communityPointsSettings: {
                  summarizedRewards: [
                    {
                      count: 3,
                      node: {
                        id: 'reward',
                        title: 'Reward',
                        cost: 20,
                        isEnabled: true,
                        isPaused: true,
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ]),
    )
    const summary = await service.rewardQueueSummary(account, 'creator')
    expect(summary.rewards[0]).toMatchObject({ id: 'reward', pendingCount: 3, isPaused: true })
    const operation = JSON.parse(textBody(required(calls[0]).init.body))[0]
    expect(operation.operationName).toBe('CoPoRewardQueue')
    expect(operation.extensions.persistedQuery.sha256Hash).toBe(
      '3800572d63eefadf648592b20bd46765b6de50fc7e4afdb32a908e1961497a33',
    )
  })
})

test('viewer pin snapshot uses the documented upstream anonymous query and no credentials', async () => {
  const { service, calls } = fixture(() =>
    Response.json([
      {
        data: {
          channel: {
            pinnedChatMessages: {
              edges: [
                {
                  node: {
                    id: 'pin-id',
                    endsAt: 'later',
                    updatedAt: 'now',
                    pinnedMessage: {
                      id: 'message-id',
                      content: { text: 'Pinned' },
                      sender: { displayName: 'Viewer' },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    ]),
  )
  const snapshot = await service.snapshot({ ...account, scopes: [], webSession: null }, 'friend', [
    'pinnedMessage',
  ])
  expect(snapshot.errors).toEqual({})
  expect(snapshot.pinnedMessage).toEqual({
    id: 'pin-id',
    messageId: 'message-id',
    text: 'Pinned',
    authorName: 'Viewer',
    pinnedAt: 'now',
    expiresAt: 'later',
  })
  expect(calls).toHaveLength(1)
  expect(new Headers(required(calls[0]).init.headers).has('authorization')).toBe(false)
  const operation = JSON.parse(textBody(required(calls[0]).init.body))[0]
  expect(operation.operationName).toBe('GetPinnedChat')
  expect(operation.variables).toEqual({ channelID: '200', count: 1 })
})

test('partial snapshots omit unrelated requests and retain rate-limit status for backoff', async () => {
  const { service, calls } = fixture(() =>
    Response.json({ message: 'Too many requests' }, { status: 429 }),
  )
  const result = await service.snapshot({ ...account, webSession: null }, 'creator', ['polls'])
  expect(calls).toHaveLength(1)
  expect(required(calls[0]).url.pathname).toBe('/helix/polls')
  expect(result.errors.polls).toContain('HTTP 429')
  expect(result.errors.predictions).toBeUndefined()
})

describe('web session channel roles from pinned upstream operations', () => {
  test.each(
    literal([
      [
        'add_editor',
        'AddEditorUser',
        'addEditor',
        '3b52bf904ff9ce1b000ac2358080f538fbd1972c1869804f0d0f345d1a56676c',
        { channelID: '100', targetUserLogin: 'viewer' },
      ],
      [
        'remove_editor',
        'RemoveEditorUser',
        'removeEditor',
        '4699d38183050854dba547d07e340e72bf1f04578f1037a38a1189fa1827790f',
        { channelID: '100', targetUserLogin: 'viewer' },
      ],
      [
        'assign_lead_moderator',
        'AssignChannelRole',
        'assignChannelRole',
        '2d373c90d0d0e6d4fe771bc6136febe6a148eb3d5700d2a0575883a043fbd581',
        { channelID: '100', targetUserID: '200', roleID: 'lead_mod' },
      ],
      [
        'unassign_lead_moderator',
        'UnassignChannelRole',
        'unassignChannelRole',
        '5edbf17877acdb91e65243b5148cfd15b98adc6d8f980492dcde9a7f2e8255e2',
        { channelID: '100', targetUserID: '200', roleID: 'lead_mod' },
      ],
    ]),
  )(
    '%s uses the actual TV operation and variables',
    async (action, operationName, field, hash, variables) => {
      const { service, calls } = fixture(() =>
        Response.json([{ data: { [field]: { isAssigned: true, isUnassigned: true } } }]),
      )
      await service.execute(
        account,
        action === 'add_editor' || action === 'remove_editor'
          ? { action, channelSlug: 'creator', username: 'viewer' }
          : { action, channelSlug: 'creator', userId: '200' },
      )
      expect(calls).toHaveLength(1)
      expect(required(calls[0]).url.toString()).toBe('https://gql.twitch.tv/gql')
      expect(required(calls[0]).init.headers).toMatchObject({
        'Client-Id': 'ue6666qo983tsx6so1t0vnawi233wa',
        Authorization: 'OAuth web-secret',
        Origin: 'https://android.tv.twitch.tv',
      })
      expect(JSON.parse(textBody(required(calls[0]).init.body))).toEqual([
        {
          operationName,
          extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
          variables: { input: variables },
        },
      ])
    },
  )
  test('missing session and rejected role flags never report success', async () => {
    const { service, calls } = fixture(() =>
      Response.json([{ data: { assignChannelRole: { isAssigned: false } } }]),
    )
    const action = {
      action: literal('assign_lead_moderator'),
      channelSlug: 'creator',
      userId: '200',
    }
    await expect(service.execute({ ...account, webSession: null }, action)).rejects.toThrow(
      'web session',
    )
    expect(calls).toHaveLength(0)
    await expect(service.execute(account, action)).rejects.toThrow('did not confirm')
  })
  test('editor provider errors propagate, invalid usernames never reach Twitch', async () => {
    const { service, calls } = fixture(() =>
      Response.json([{ data: { addEditor: { error: { code: 'FORBIDDEN' } } } }]),
    )
    await expect(
      service.execute(account, {
        action: 'add_editor',
        channelSlug: 'creator',
        username: 'viewer',
      }),
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      service.execute(account, {
        action: 'add_editor',
        channelSlug: 'creator',
        username: '../invalid',
      }),
    ).rejects.toThrow('Invalid Twitch username')
    expect(calls).toHaveLength(1)
  })
})
