import type {
  TwitchActivitiesSnapshot,
  TwitchActivitySnapshotPart,
  TwitchRewardQueueSummary,
  TwitchActivityAction,
  TwitchPoll,
  TwitchPrediction,
  TwitchReward,
  TwitchRedemptionsPage,
  TwitchFollowingPage,
  TwitchWebSession,
  TwitchEventSubscription,
} from '@twirchat/shared/twitch-activities'
import { z } from 'zod'

import { ChatToolsError } from './chat-tools'
import { isModerator } from './moderation/twitch'
import { hasChannelModerationScopes } from './moderation/twitch-eventsub'
import { resolveTwitchUserId, type TwitchUserCredentials } from './twitch-users'

export interface TwitchActivitiesCredentials extends TwitchUserCredentials {
  platformUserId: string
  scopes: readonly string[]
  webSession?: TwitchWebSession | null
}

const rowSchema = z.record(z.string(), z.unknown())
type Row = z.infer<typeof rowSchema>
const row = (value: unknown): Row => rowSchema.safeParse(value).data ?? {}
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(row) : [])
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0
const POLL_QUERY =
  'query ChannelPollContext($login:String!){user(login:$login){viewablePoll{id title status remainingDurationMilliseconds startedAt endedAt settings{communityPointsVotes{isEnabled cost}} choices{id title totalVoters votes{total base communityPoints}}}} currentUser{id}}'
const PREDICTION_QUERY =
  'query ChannelPointsPredictionContext($channelLogin:String!){channel(name:$channelLogin){id activePredictionEvents{id title status predictionWindowSeconds createdAt lockedAt outcomes{id title totalUsers totalPoints color}} lockedPredictionEvents{id title status predictionWindowSeconds createdAt lockedAt outcomes{id title totalUsers totalPoints color}}}}'
const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
const TV_CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa'
const sessionId = crypto.randomUUID().replaceAll('-', '')
const deviceId = crypto.randomUUID().replaceAll('-', '')

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new ChatToolsError(`${label} must be an integer between ${min} and ${max}.`)
  return value
}
function string(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > max)
    throw new ChatToolsError(`${label} must contain 1–${max} characters.`)
  return value
}
function scope(credentials: TwitchActivitiesCredentials, ...required: string[]): void {
  if (!required.some((item) => credentials.scopes.includes(item)))
    throw new ChatToolsError(`Reconnect Twitch to grant ${required.join(' or ')}.`, 403)
}
function webSession(credentials: TwitchActivitiesCredentials): TwitchWebSession {
  const session = credentials.webSession
  if (!session?.token)
    throw new ChatToolsError(
      'Add your Twitch web session in Settings to use this viewer action.',
      403,
    )
  if (session.userId !== credentials.platformUserId)
    throw new ChatToolsError(
      'The Twitch web session must belong to the connected Twitch account.',
      403,
    )
  return session
}
function poll(value: Row): TwitchPoll {
  return {
    id: text(value.id),
    title: text(value.title),
    status: text(value.status),
    choices: rows(value.choices).map((choice) => ({
      id: text(choice.id),
      title: text(choice.title),
      votes: number(typeof choice.votes === 'number' ? choice.votes : row(choice.votes).total),
      pointsVotes: number(choice.channel_points_votes ?? row(choice.votes).communityPoints),
    })),
    startedAt: text(value.started_at ?? value.startedAt) || undefined,
    endsAt: text(value.ends_at ?? value.endedAt) || text(value.ended_at) || undefined,
    duration: number(value.duration),
  }
}
function prediction(value: Row): TwitchPrediction {
  return {
    id: text(value.id),
    title: text(value.title),
    status: text(value.status),
    outcomes: rows(value.outcomes).map((outcome) => ({
      id: text(outcome.id),
      title: text(outcome.title),
      color: text(outcome.color),
      users: number(outcome.users ?? outcome.totalUsers),
      points: number(outcome.channel_points ?? outcome.totalPoints),
    })),
    startedAt: text(value.created_at ?? value.createdAt) || undefined,
    locksAt: text(value.locks_at ?? value.lockedAt) || text(value.locked_at) || undefined,
    winningOutcomeId: text(value.winning_outcome_id) || undefined,
  }
}
function reward(value: Row): TwitchReward {
  return {
    id: text(value.id),
    title: text(value.title),
    cost: number(value.cost ?? value.defaultCost),
    prompt: text(value.prompt),
    isEnabled: value.is_enabled === true || value.isEnabled === true,
    isPaused: value.is_paused === true || value.isPaused === true,
    isInputRequired: value.is_user_input_required === true || value.isUserInputRequired === true,
    imageUrl:
      text(row(value.image).url_2x) ||
      text(row(value.image).url2x) ||
      text(row(value.default_image).url_2x) ||
      text(row(value.defaultImage).url2x) ||
      undefined,
  }
}

export interface TwitchActivitiesDependencies {
  fetch(input: string, init?: RequestInit): Promise<Response>
  resolveUser(identifier: string, credentials: TwitchUserCredentials): Promise<string | null>
  isModerator?: typeof isModerator
}
const defaults: TwitchActivitiesDependencies = {
  fetch: (...args) => fetch(...args),
  resolveUser: resolveTwitchUserId,
}

/** Public Helix for account actions; pinned upstream GQL contracts for viewer-only operations. */
export function createTwitchActivitiesService(
  dependencies: TwitchActivitiesDependencies = defaults,
) {
  const channelCache = new Map<string, { id: string; expiresAt: number }>()
  async function channelId(
    channelSlug: string,
    credentials: TwitchActivitiesCredentials,
  ): Promise<string> {
    const normalized = string(channelSlug, 'Channel', 100).trim().replace(/^#/, '').toLowerCase()
    const cached = channelCache.get(normalized)
    if (cached && cached.expiresAt > Date.now()) return cached.id
    const id = await dependencies.resolveUser(normalized, credentials)
    if (!id) throw new ChatToolsError('Twitch channel was not found.')
    channelCache.delete(normalized)
    channelCache.set(normalized, { id, expiresAt: Date.now() + 3600000 })
    if (channelCache.size > 2048) {
      const oldest = channelCache.keys().next()
      if (!oldest.done) channelCache.delete(oldest.value)
    }
    return id
  }
  async function helix(
    credentials: TwitchActivitiesCredentials,
    path: string,
    method = 'GET',
    query: Record<string, string | string[]> = {},
    body?: unknown,
  ): Promise<Row> {
    const url = new URL(`https://api.twitch.tv/helix/${path}`)
    for (const [key, values] of Object.entries(query))
      for (const value of typeof values === 'string' ? [values] : values)
        url.searchParams.append(key, value)
    const response = await dependencies.fetch(url.toString(), {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Client-Id': credentials.clientId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      let message = `Twitch HTTP ${response.status}`
      try {
        message = text(row(await response.json()).message) || message
      } catch {
        /* Empty provider error. */
      }
      throw new ChatToolsError(message.slice(0, 500), response.status)
    }
    return response.status === 204 ? {} : row(await response.json())
  }
  async function gql(
    credentials: TwitchActivitiesCredentials,
    operation: { operationName?: string; query?: string; hash?: string; variables: Row },
    tv = false,
    anonymous = false,
  ): Promise<Row> {
    const session = anonymous ? null : webSession(credentials)
    const response = await dependencies.fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      redirect: 'error',
      headers: {
        ...(session ? { Authorization: `OAuth ${session.token}` } : {}),
        'Client-Id': tv ? TV_CLIENT_ID : WEB_CLIENT_ID,
        'Content-Type': 'application/json',
        'Client-Session-Id': sessionId,
        'X-Device-Id': deviceId,
        'Client-Version': 'ef928475-9403-42f2-8a34-55784bd08e16',
        ...(tv
          ? { Origin: 'https://android.tv.twitch.tv', Referer: 'https://android.tv.twitch.tv/' }
          : {}),
      },
      body: JSON.stringify([
        {
          ...(operation.query
            ? { query: operation.query }
            : {
                operationName: operation.operationName,
                extensions: { persistedQuery: { version: 1, sha256Hash: operation.hash } },
              }),
          variables: operation.variables,
        },
      ]),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok)
      throw new ChatToolsError(
        `Twitch web session request failed (HTTP ${response.status}). Reconnect the web session.`,
        response.status,
      )
    const payload = z.unknown().parse(await response.json())
    const result = row(Array.isArray(payload) ? payload[0] : payload)
    const error = rows(result.errors)[0]
    if (error)
      throw new ChatToolsError(
        text(error.message) || 'Twitch rejected the web session request.',
        400,
      )
    const data = row(result.data)
    if (!Object.keys(data).length)
      throw new ChatToolsError('Twitch returned no data for the web session request.')
    const expected = operation.query?.includes('mutation VoteInPoll')
      ? 'voteInPoll'
      : new Map<string, string>(
          Object.entries({
            AddEditorUser: 'addEditor',
            RemoveEditorUser: 'removeEditor',
            AssignChannelRole: 'assignChannelRole',
            UnassignChannelRole: 'unassignChannelRole',
            MakePrediction: 'makePrediction',
            RedeemCustomReward: 'redeemCommunityPointsCustomReward',
            FollowButton_FollowUser: 'followUser',
            FollowButton_UnfollowUser: 'unfollowUser',
            UpdateCoPoCustomRewardStatus: 'updateCommunityPointsCustomRewardRedemptionStatus',
            PauseCustomRewardRedemptions: 'updateCommunityPointsCustomReward',
            BulkUpdateRedemptions:
              'updateCommunityPointsCustomRewardRedemptionStatusesByRedemptions',
          }),
        ).get(operation.operationName ?? '')
    if (expected && !Object.keys(row(data[expected])).length)
      throw new ChatToolsError('Twitch did not confirm the requested action.')
    for (const value of Object.values(data)) {
      const operationError = row(row(value).error)
      if (Object.keys(operationError).length)
        throw new ChatToolsError(
          text(operationError.message) ||
            text(operationError.code) ||
            'Twitch rejected the operation.',
        )
    }
    return data
  }

  return {
    async validateWebSession(token: string): Promise<TwitchWebSession> {
      const normalized = string(
        token.trim().replace(/^(?:oauth:|OAuth\s+)/i, ''),
        'Web session token',
        1000,
      )
      const response = await dependencies.fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `OAuth ${normalized}` },
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok)
        throw new ChatToolsError('The Twitch web session token is invalid or expired.', 401)
      const data = row(await response.json())
      if (!data.user_id || !data.login || !data.client_id)
        throw new ChatToolsError('The Twitch token must belong to a user.', 400)
      return {
        token: normalized,
        userId: text(data.user_id),
        username: text(data.login),
        clientId: text(data.client_id),
      }
    },

    async snapshot(
      credentials: TwitchActivitiesCredentials,
      channelSlug: string,
      sections?: TwitchActivitySnapshotPart[],
    ): Promise<TwitchActivitiesSnapshot> {
      if (
        sections &&
        (!Array.isArray(sections) ||
          sections.some(
            (part) =>
              !['polls', 'predictions', 'rewards', 'pinnedMessage', 'pointsBalance'].includes(part),
          ))
      )
        throw new ChatToolsError('Invalid activity snapshot sections.')
      const id = await channelId(channelSlug, credentials)
      const snapshot: TwitchActivitiesSnapshot = {
        channelId: id,
        channelSlug,
        polls: [],
        predictions: [],
        rewards: [],
        pinnedMessage: null,
        errors: {},
      }
      const capture = async (
        key: keyof TwitchActivitiesSnapshot['errors'],
        action: () => Promise<void>,
      ) => {
        if (
          sections &&
          !sections.includes(key) &&
          !(key === 'rewards' && sections.includes('pointsBalance'))
        )
          return
        try {
          await action()
        } catch (error) {
          const errorKey =
            key === 'rewards' &&
            sections &&
            !sections.includes('rewards') &&
            sections.includes('pointsBalance')
              ? 'pointsBalance'
              : key
          snapshot.errors[errorKey] =
            error instanceof ChatToolsError && (error.status === 429 || error.status >= 500)
              ? `${error.message} (HTTP ${error.status})`
              : error instanceof Error
                ? error.message
                : 'Could not load Twitch activity.'
        }
      }
      await Promise.all([
        capture('polls', async () => {
          if (credentials.webSession) {
            const data = await gql(credentials, {
              query: POLL_QUERY,
              variables: { login: channelSlug },
            })
            if (!data.user) throw new ChatToolsError('Twitch did not return the channel poll.')
            const active = row(row(data.user).viewablePoll)
            snapshot.polls = active.id ? [poll(active)] : []
            return
          }
          scope(credentials, 'channel:read:polls', 'channel:manage:polls')
          snapshot.polls = rows(
            (await helix(credentials, 'polls', 'GET', { broadcaster_id: id, first: '20' })).data,
          ).map(poll)
        }),
        capture('predictions', async () => {
          if (credentials.webSession) {
            const data = await gql(credentials, {
              query: PREDICTION_QUERY,
              variables: { channelLogin: channelSlug },
            })
            if (!data.channel)
              throw new ChatToolsError('Twitch did not return channel predictions.')
            const source = row(data.channel)
            snapshot.predictions = [
              ...rows(source.activePredictionEvents),
              ...rows(source.lockedPredictionEvents),
            ]
              .filter((value) => ['ACTIVE', 'LOCKED'].includes(text(value.status)))
              .map(prediction)
            return
          }
          scope(credentials, 'channel:read:predictions', 'channel:manage:predictions')
          snapshot.predictions = rows(
            (await helix(credentials, 'predictions', 'GET', { broadcaster_id: id, first: '20' }))
              .data,
          ).map(prediction)
        }),
        capture('rewards', async () => {
          if (credentials.webSession) {
            const data = await gql(
              credentials,
              {
                operationName: 'ChannelPointsContext',
                hash: '7fe050e3761eb2cf258d70ee1a21cbd76fa8cf3d7e7b12fc437e7029d446b5e3',
                variables: { channelLogin: channelSlug, includeGoalTypes: ['CREATOR', 'BOOST'] },
              },
              true,
            )
            if (!data.community) throw new ChatToolsError('Twitch did not return channel rewards.')
            const channel = row(row(data.community).channel)
            snapshot.rewards = rows(row(channel.communityPointsSettings).customRewards).map(reward)
            const balance = row(row(channel.self).communityPoints).balance
            if (typeof balance === 'number') snapshot.pointsBalance = balance
          } else {
            scope(credentials, 'channel:read:redemptions', 'channel:manage:redemptions')
            snapshot.rewards = rows(
              (
                await helix(credentials, 'channel_points/custom_rewards', 'GET', {
                  broadcaster_id: id,
                })
              ).data,
            ).map(reward)
          }
        }),
        capture('pinnedMessage', async () => {
          if (
            id !== credentials.platformUserId ||
            !credentials.scopes.some((name) =>
              ['moderator:read:chat_messages', 'moderator:manage:chat_messages'].includes(name),
            )
          ) {
            const data = await gql(
              credentials,
              {
                operationName: 'GetPinnedChat',
                hash: '2d099d4c9b6af80a07d8440140c4f3dbb04d516b35c401aab7ce8f60765308d5',
                variables: { channelID: id, count: 1 },
              },
              false,
              true,
            )
            if (!data.channel) throw new ChatToolsError('Twitch did not return the channel pin.')
            const node = row(rows(row(row(data.channel).pinnedChatMessages).edges)[0]?.node)
            if (node.id) {
              const message = row(node.pinnedMessage)
              const author = row(message.sender)
              snapshot.pinnedMessage = {
                id: text(node.id),
                messageId: text(message.id),
                text: text(row(message.content).text),
                authorName: text(author.displayName) || text(author.login),
                pinnedAt: text(node.updatedAt) || undefined,
                expiresAt: text(node.endsAt) || undefined,
              }
            }
            return
          }
          scope(credentials, 'moderator:read:chat_messages', 'moderator:manage:chat_messages')
          const pin = rows(
            (
              await helix(credentials, 'chat/pins', 'GET', {
                broadcaster_id: id,
                moderator_id: credentials.platformUserId,
              })
            ).data,
          )[0]
          if (pin)
            snapshot.pinnedMessage = {
              id: text(pin.message_id),
              messageId: text(pin.message_id),
              text: text(row(pin.message).text),
              authorName: text(pin.sender_user_name),
              pinnedAt: text(pin.starts_at),
              expiresAt: text(pin.ends_at) || undefined,
            }
        }),
      ])
      return snapshot
    },

    async execute(
      credentials: TwitchActivitiesCredentials,
      action: TwitchActivityAction,
    ): Promise<{ message?: string }> {
      const id = await channelId(action.channelSlug, credentials)
      const broadcaster = { broadcaster_id: id }
      const moderation = { ...broadcaster, moderator_id: credentials.platformUserId }
      switch (action.action) {
        case 'create_poll': {
          scope(credentials, 'channel:manage:polls')
          if (
            !Array.isArray(action.choices) ||
            action.choices.length < 2 ||
            action.choices.length > 5
          )
            throw new ChatToolsError('Polls need 2–5 choices.')
          const body = {
            broadcaster_id: id,
            title: string(action.title, 'Poll title', 60),
            choices: action.choices.map((title) => ({ title: string(title, 'Choice', 25) })),
            duration: integer(action.duration, 'Duration', 15, 1800),
            channel_points_voting_enabled: !!action.pointsPerVote,
            ...(action.pointsPerVote
              ? {
                  channel_points_per_vote: integer(
                    action.pointsPerVote,
                    'Points per vote',
                    1,
                    1000000,
                  ),
                }
              : {}),
          }
          await helix(credentials, 'polls', 'POST', {}, body)
          break
        }
        case 'end_poll':
        case 'archive_poll':
          scope(credentials, 'channel:manage:polls')
          await helix(
            credentials,
            'polls',
            'PATCH',
            {},
            {
              ...broadcaster,
              id: string(action.pollId, 'Poll ID', 100),
              status: action.action === 'end_poll' ? 'TERMINATED' : 'ARCHIVED',
            },
          )
          break
        case 'vote_poll': {
          const session = webSession(credentials)
          const votes = integer(action.votes ?? 1, 'Votes', 1, 1000000)
          const extraVotes = votes - 1
          const cost = extraVotes
            ? integer(action.pointsPerVote, 'Points per extra vote', 1, 1000000)
            : 0
          await gql(credentials, {
            query:
              'mutation VoteInPoll($input: VoteInPollInput!) { voteInPoll(input:$input){error{code}} }',
            variables: {
              input: {
                pollID: string(action.pollId, 'Poll ID', 100),
                choiceID: string(action.choiceId, 'Choice ID', 100),
                userID: session.userId,
                voteID: crypto.randomUUID(),
                ...(extraVotes
                  ? {
                      tokens: {
                        channelPoints: integer(
                          extraVotes * cost,
                          'Vote cost',
                          1,
                          Number.MAX_SAFE_INTEGER,
                        ),
                      },
                    }
                  : {}),
              },
            },
          })
          break
        }
        case 'create_prediction':
          scope(credentials, 'channel:manage:predictions')
          if (
            !Array.isArray(action.outcomes) ||
            action.outcomes.length < 2 ||
            action.outcomes.length > 10
          )
            throw new ChatToolsError('Predictions need 2–10 outcomes.')
          await helix(
            credentials,
            'predictions',
            'POST',
            {},
            {
              ...broadcaster,
              title: string(action.title, 'Prediction title', 45),
              outcomes: action.outcomes.map((title) => ({ title: string(title, 'Outcome', 25) })),
              prediction_window: integer(action.duration, 'Prediction duration', 30, 1800),
            },
          )
          break
        case 'lock_prediction':
        case 'cancel_prediction':
        case 'resolve_prediction':
          scope(credentials, 'channel:manage:predictions')
          await helix(
            credentials,
            'predictions',
            'PATCH',
            {},
            {
              ...broadcaster,
              id: string(action.predictionId, 'Prediction ID', 100),
              status:
                action.action === 'lock_prediction'
                  ? 'LOCKED'
                  : action.action === 'cancel_prediction'
                    ? 'CANCELED'
                    : 'RESOLVED',
              ...(action.action === 'resolve_prediction'
                ? { winning_outcome_id: string(action.outcomeId, 'Winning outcome', 100) }
                : {}),
            },
          )
          break
        case 'place_bet':
          await gql(credentials, {
            operationName: 'MakePrediction',
            hash: 'b44682ecc88358817009f20e69d75081b1e58825bb40aa53d5dbadcc17c881d8',
            variables: {
              input: {
                eventID: string(action.predictionId, 'Prediction ID', 100),
                outcomeID: string(action.outcomeId, 'Outcome ID', 100),
                points: integer(action.points, 'Points', 1, 250000),
                transactionID: crypto.randomUUID().replaceAll('-', ''),
              },
            },
          })
          break
        case 'pin_message':
        case 'update_pin':
        case 'unpin_message':
          scope(credentials, 'moderator:manage:chat_messages')
          await helix(
            credentials,
            'chat/pins',
            action.action === 'pin_message'
              ? 'PUT'
              : action.action === 'update_pin'
                ? 'PATCH'
                : 'DELETE',
            {
              ...moderation,
              message_id: string(action.messageId, 'Message ID', 200),
              ...(action.action !== 'unpin_message' && action.duration !== undefined
                ? { duration_seconds: String(integer(action.duration, 'Pin duration', 30, 1800)) }
                : {}),
            },
          )
          break
        case 'update_reward': {
          if (!action.patch || typeof action.patch !== 'object')
            throw new ChatToolsError('A reward update is required.')
          if (
            credentials.webSession &&
            Object.keys(action.patch).length === 1 &&
            typeof action.patch.isPaused === 'boolean'
          ) {
            await gql(
              credentials,
              {
                operationName: 'PauseCustomRewardRedemptions',
                hash: '1217cae91b1ebc6eba035ebce8ba308d255b0e7c4524130f739e176213b95b7a',
                variables: {
                  input: {
                    channelID: id,
                    rewardID: string(action.rewardId, 'Reward ID', 100),
                    isPaused: action.patch.isPaused,
                  },
                },
              },
              true,
            )
            break
          }
          scope(credentials, 'channel:manage:redemptions')
          const patch: Row = {}
          if (action.patch.title !== undefined)
            patch.title = string(action.patch.title, 'Reward title', 45)
          if (action.patch.cost !== undefined)
            patch.cost = integer(action.patch.cost, 'Reward cost', 1, Number.MAX_SAFE_INTEGER)
          if (action.patch.prompt !== undefined) {
            if (typeof action.patch.prompt !== 'string' || action.patch.prompt.length > 200)
              throw new ChatToolsError('Reward prompt must contain at most 200 characters.')
            patch.prompt = action.patch.prompt
          }
          if (action.patch.isEnabled !== undefined) {
            if (typeof action.patch.isEnabled !== 'boolean')
              throw new ChatToolsError('isEnabled must be boolean.')
            patch.is_enabled = action.patch.isEnabled
          }
          if (action.patch.isPaused !== undefined) {
            if (typeof action.patch.isPaused !== 'boolean')
              throw new ChatToolsError('isPaused must be boolean.')
            patch.is_paused = action.patch.isPaused
          }
          if (!Object.keys(patch).length)
            throw new ChatToolsError('Choose a reward field to update.')
          await helix(
            credentials,
            'channel_points/custom_rewards',
            'PATCH',
            { ...broadcaster, id: string(action.rewardId, 'Reward ID', 100) },
            patch,
          )
          break
        }
        case 'update_redemptions':
          if (
            !Array.isArray(action.ids) ||
            action.ids.length < 1 ||
            action.ids.length > 50 ||
            !['FULFILLED', 'CANCELED'].includes(action.status)
          )
            throw new ChatToolsError('Choose 1–50 redemptions and a valid status.')
          if (credentials.webSession) {
            const ids = action.ids.map((value) => string(value, 'Redemption ID', 100))
            await gql(
              credentials,
              ids.length === 1
                ? {
                    operationName: 'UpdateCoPoCustomRewardStatus',
                    hash: 'd940a7ebb2e588c3fc0c69a2fb61c5aeb566833f514cf55b9de728082c90361d',
                    variables: {
                      input: { channelID: id, redemptionID: ids[0], newStatus: action.status },
                    },
                  }
                : {
                    operationName: 'BulkUpdateRedemptions',
                    hash: 'cba9ec6d62b16450c3b6fad790b6c4bc26ff3efb68731bbbb7ecc24c3b9188ce',
                    variables: {
                      input: {
                        channelID: id,
                        newStatus: action.status,
                        oldStatus: 'UNFULFILLED',
                        redemptionIDs: ids,
                      },
                    },
                  },
              true,
            )
            break
          }
          scope(credentials, 'channel:manage:redemptions')
          await helix(
            credentials,
            'channel_points/custom_rewards/redemptions',
            'PATCH',
            {
              ...broadcaster,
              reward_id: string(action.rewardId, 'Reward ID', 100),
              id: action.ids.map((value) => string(value, 'Redemption ID', 100)),
            },
            { status: action.status },
          )
          break
        case 'redeem_reward':
          await gql(
            credentials,
            {
              operationName: 'RedeemCustomReward',
              hash: 'd56249a7adb4978898ea3412e196688d4ac3cea1c0c2dfd65561d229ea5dcc42',
              variables: {
                input: {
                  channelID: id,
                  cost: integer(action.cost, 'Reward cost', 1, Number.MAX_SAFE_INTEGER),
                  pricingType: 'POINTS',
                  rewardID: string(action.rewardId, 'Reward ID', 100),
                  title: string(action.rewardTitle, 'Reward title', 100),
                  transactionID: crypto.randomUUID().replaceAll('-', ''),
                  prompt: null,
                  ...(action.input ? { textInput: string(action.input, 'Reward input', 500) } : {}),
                },
              },
            },
            true,
          )
          break
        // Leafyrino de8cd64 TwitchGql.cpp:4051 (TV persisted role mutations).
        case 'add_editor':
        case 'remove_editor': {
          const adding = action.action === 'add_editor'
          const username = string(action.username, 'Twitch username', 25).replace(/^@/, '')
          if (!/^[a-zA-Z0-9_]+$/.test(username))
            throw new ChatToolsError('Invalid Twitch username.')
          await gql(
            credentials,
            {
              operationName: adding ? 'AddEditorUser' : 'RemoveEditorUser',
              hash: adding
                ? '3b52bf904ff9ce1b000ac2358080f538fbd1972c1869804f0d0f345d1a56676c'
                : '4699d38183050854dba547d07e340e72bf1f04578f1037a38a1189fa1827790f',
              variables: { input: { channelID: id, targetUserLogin: username } },
            },
            true,
          )
          break
        }
        case 'assign_lead_moderator':
        case 'unassign_lead_moderator': {
          const adding = action.action === 'assign_lead_moderator'
          if (typeof action.userId !== 'string' || !/^\d+$/.test(action.userId))
            throw new ChatToolsError('A Twitch user ID is required.')
          const data = await gql(
            credentials,
            {
              operationName: adding ? 'AssignChannelRole' : 'UnassignChannelRole',
              hash: adding
                ? '2d373c90d0d0e6d4fe771bc6136febe6a148eb3d5700d2a0575883a043fbd581'
                : '5edbf17877acdb91e65243b5148cfd15b98adc6d8f980492dcde9a7f2e8255e2',
              variables: {
                input: { channelID: id, targetUserID: action.userId, roleID: 'lead_mod' },
              },
            },
            true,
          )
          if (
            row(data[adding ? 'assignChannelRole' : 'unassignChannelRole'])[
              adding ? 'isAssigned' : 'isUnassigned'
            ] !== true
          )
            throw new ChatToolsError('Twitch did not confirm the role change.')
          break
        }
        case 'follow':
        case 'unfollow':
          await gql(
            credentials,
            {
              operationName:
                action.action === 'follow'
                  ? 'FollowButton_FollowUser'
                  : 'FollowButton_UnfollowUser',
              hash:
                action.action === 'follow'
                  ? '800e7346bdf7e5278a3c1d3f21b2b56e2639928f86815677a7126b093b2fdd08'
                  : 'f7dae976ebf41c755ae2d758546bfd176b4eeb856656098bb40e0a672ca0d880',
              variables: {
                input: {
                  targetID: id,
                  ...(action.action === 'follow' ? { disableNotifications: false } : {}),
                },
              },
            },
            true,
          )
          break
        case 'send_whisper': {
          scope(credentials, 'user:manage:whispers')
          const to = await channelId(action.username, credentials)
          await helix(
            credentials,
            'whispers',
            'POST',
            { from_user_id: credentials.platformUserId, to_user_id: to },
            { message: string(action.text, 'Whisper', 500) },
          )
          break
        }
        default:
          throw new ChatToolsError('Unknown Twitch activity action.')
      }
      return { message: 'Twitch accepted the action.' }
    },

    async rewardQueueSummary(
      credentials: TwitchActivitiesCredentials,
      channelSlug: string,
    ): Promise<TwitchRewardQueueSummary> {
      const data = await gql(credentials, {
        operationName: 'CoPoRewardQueue',
        hash: '3800572d63eefadf648592b20bd46765b6de50fc7e4afdb32a908e1961497a33',
        variables: { channelLogin: channelSlug },
      })
      const settings = row(row(row(data.user).channel).communityPointsSettings)
      if (!settings.summarizedRewards)
        throw new ChatToolsError(
          'Twitch did not return a reward queue. The web account must moderate this channel.',
          403,
        )
      return {
        rewards: rows(settings.summarizedRewards).map((entry) => ({
          ...reward(row(entry.node)),
          pendingCount: number(entry.count),
        })),
      }
    },

    async redemptions(
      credentials: TwitchActivitiesCredentials,
      params: {
        channelSlug: string
        rewardId?: string
        status?: string
        cursor?: string
        order?: 'NEWEST' | 'OLDEST'
      },
    ): Promise<TwitchRedemptionsPage> {
      if (params.order !== undefined && !['NEWEST', 'OLDEST'].includes(params.order))
        throw new ChatToolsError('Queue order must be NEWEST or OLDEST.')
      if (params.status && !['UNFULFILLED', 'FULFILLED', 'CANCELED'].includes(params.status))
        throw new ChatToolsError('Invalid redemption status.')
      if (credentials.webSession && (!params.status || params.status === 'UNFULFILLED')) {
        const data = await gql(credentials, {
          operationName: 'RedemptionsByRewardID_Paginated',
          hash: '74740dc72455f428e464fad11770a543c3ac1092b89cb39ed7411ff3a69e6d37',
          variables: {
            channelLogin: params.channelSlug,
            order: params.order ?? 'NEWEST',
            count: 50,
            ...(params.rewardId ? { id: string(params.rewardId, 'Reward ID', 100) } : {}),
            ...(params.cursor ? { cursor: params.cursor } : {}),
          },
        })
        const channel = row(row(data.user).channel)
        if (!channel.communityPointsRedemptionQueue)
          throw new ChatToolsError(
            'Twitch did not return a reward queue. The web account must moderate this channel.',
            403,
          )
        const queue = row(channel.communityPointsRedemptionQueue)
        const edges = rows(queue.edges)
        const nodes = edges.map((edge) => row(edge.node))
        const userIds = [...new Set(nodes.map((node) => text(row(node.user).id)).filter(Boolean))]
        const users = userIds.length
          ? rows((await helix(credentials, 'users', 'GET', { id: userIds })).data)
          : []
        return {
          redemptions: nodes.map((node) => {
            const userId = text(row(node.user).id)
            const user = users.find((entry) => entry.id === userId)
            return {
              id: text(node.id),
              rewardId: text(row(node.reward).id),
              userId,
              userName: text(user?.display_name) || text(user?.login) || userId,
              input: text(node.input),
              status: 'UNFULFILLED',
              redeemedAt: text(node.timestamp),
            }
          }),
          cursor:
            row(queue.pageInfo).hasNextPage === true
              ? text(edges.at(-1)?.cursor) || undefined
              : undefined,
        }
      }
      scope(credentials, 'channel:read:redemptions', 'channel:manage:redemptions')
      const result = await helix(credentials, 'channel_points/custom_rewards/redemptions', 'GET', {
        broadcaster_id: await channelId(params.channelSlug, credentials),
        reward_id: string(params.rewardId, 'Reward ID', 100),
        status: params.status ?? 'UNFULFILLED',
        sort: params.order ?? 'NEWEST',
        first: '50',
        ...(params.cursor ? { after: params.cursor } : {}),
      })
      return {
        redemptions: rows(result.data).map((value) => ({
          id: text(value.id),
          rewardId: text(row(value.reward).id),
          userId: text(value.user_id),
          userName: text(value.user_name),
          input: text(value.user_input),
          status: text(value.status),
          redeemedAt: text(value.redeemed_at),
        })),
        cursor: text(row(result.pagination).cursor) || undefined,
      }
    },

    async following(
      credentials: TwitchActivitiesCredentials,
      params: { liveOnly?: boolean; cursor?: string },
    ): Promise<TwitchFollowingPage> {
      scope(credentials, 'user:read:follows')
      const result = await helix(
        credentials,
        params.liveOnly ? 'streams/followed' : 'channels/followed',
        'GET',
        {
          user_id: credentials.platformUserId,
          first: '100',
          ...(params.cursor ? { after: params.cursor } : {}),
        },
      )
      const channels = rows(result.data).map((value) => ({
        id: text(params.liveOnly ? value.user_id : value.broadcaster_id),
        login: text(params.liveOnly ? value.user_login : value.broadcaster_login),
        displayName: text(params.liveOnly ? value.user_name : value.broadcaster_name),
        isLive: params.liveOnly === true,
        ...(params.liveOnly
          ? {
              title: text(value.title),
              viewerCount: number(value.viewer_count),
              categoryName: text(value.game_name),
            }
          : {}),
      }))
      if (!params.liveOnly && channels.length) {
        const live = rows(
          (
            await helix(credentials, 'streams', 'GET', {
              user_id: channels.map((channel) => channel.id),
            })
          ).data,
        )
        for (const channel of channels) {
          const stream = live.find((entry) => entry.user_id === channel.id)
          if (stream)
            Object.assign(channel, {
              isLive: true,
              title: text(stream.title),
              viewerCount: number(stream.viewer_count),
              categoryName: text(stream.game_name),
            })
        }
      }
      return {
        channels,
        cursor: text(row(result.pagination).cursor) || undefined,
        total: typeof result.total === 'number' ? result.total : undefined,
      }
    },

    async subscribe(
      credentials: TwitchActivitiesCredentials,
      sessionId: string,
      channelSlug?: string,
    ): Promise<{ subscriptions: TwitchEventSubscription[]; errors: string[] }> {
      string(sessionId, 'EventSub session', 200)
      const definitions: { type: string; version: string; condition: Record<string, string> }[] = []
      const errors: string[] = []
      const allowed = (...scopes: string[]) =>
        scopes.some((name) => credentials.scopes.includes(name))
      if (!channelSlug) {
        if (allowed('user:read:whispers', 'user:manage:whispers'))
          definitions.push({
            type: 'user.whisper.message',
            version: '1',
            condition: { user_id: credentials.platformUserId },
          })
      } else {
        const id = await channelId(channelSlug, credentials)
        const ownChannel = id === credentials.platformUserId
        const canUseAutoMod = allowed('moderator:manage:automod')
        const canUseModerationEvents = hasChannelModerationScopes(credentials.scopes)
        let moderatesChannel = ownChannel
        if (
          !ownChannel &&
          (canUseAutoMod || canUseModerationEvents) &&
          allowed('user:read:moderated_channels')
        ) {
          try {
            const role = await (dependencies.isModerator ?? isModerator)(
              credentials,
              id,
              credentials.platformUserId,
            )
            moderatesChannel = role.isModerator
            if (role.error) errors.push(role.error.message)
          } catch {
            errors.push('Could not check Twitch moderator permissions.')
          }
        }
        for (const type of ['stream.online', 'stream.offline'])
          definitions.push({ type, version: '1', condition: { broadcaster_user_id: id } })
        if (canUseAutoMod && moderatesChannel)
          for (const type of ['automod.message.hold', 'automod.message.update'])
            definitions.push({
              type,
              version: '2',
              condition: { broadcaster_user_id: id, moderator_user_id: credentials.platformUserId },
            })
        if (allowed('user:read:chat'))
          for (const type of ['channel.chat.user_message_hold', 'channel.chat.user_message_update'])
            definitions.push({
              type,
              version: '1',
              condition: { broadcaster_user_id: id, user_id: credentials.platformUserId },
            })
        if (canUseModerationEvents && moderatesChannel)
          definitions.push({
            type: 'channel.moderate',
            version: '2',
            condition: { broadcaster_user_id: id, moderator_user_id: credentials.platformUserId },
          })
        if (ownChannel) {
          if (allowed('moderator:read:followers'))
            definitions.push({
              type: 'channel.follow',
              version: '2',
              condition: { broadcaster_user_id: id, moderator_user_id: credentials.platformUserId },
            })
          if (allowed('channel:read:polls', 'channel:manage:polls'))
            for (const type of ['channel.poll.begin', 'channel.poll.progress', 'channel.poll.end'])
              definitions.push({ type, version: '1', condition: { broadcaster_user_id: id } })
          if (allowed('channel:read:predictions', 'channel:manage:predictions'))
            for (const type of [
              'channel.prediction.begin',
              'channel.prediction.progress',
              'channel.prediction.lock',
              'channel.prediction.end',
            ])
              definitions.push({ type, version: '1', condition: { broadcaster_user_id: id } })
          if (allowed('channel:read:redemptions', 'channel:manage:redemptions'))
            for (const type of [
              'channel.channel_points_custom_reward.add',
              'channel.channel_points_custom_reward.update',
              'channel.channel_points_custom_reward.remove',
              'channel.channel_points_custom_reward_redemption.add',
              'channel.channel_points_custom_reward_redemption.update',
            ])
              definitions.push({ type, version: '1', condition: { broadcaster_user_id: id } })
        }
      }
      const subscriptions: TwitchEventSubscription[] = []
      for (const definition of definitions) {
        try {
          // EventSub registration is bounded and sequential to respect the welcome window.
          // eslint-disable-next-line no-await-in-loop
          const result = await helix(
            credentials,
            'eventsub/subscriptions',
            'POST',
            {},
            { ...definition, transport: { method: 'websocket', session_id: sessionId } },
          )
          const created = rows(result.data)[0]
          if (!created?.id)
            throw new ChatToolsError('Twitch did not confirm the event subscription.', 502)
          if (created?.id)
            subscriptions.push({
              id: text(created.id),
              type: definition.type,
              condition: definition.condition,
            })
        } catch (error) {
          errors.push(error instanceof Error ? error.message : 'EventSub subscription failed.')
        }
      }
      return { subscriptions, errors }
    },
    async unsubscribe(credentials: TwitchActivitiesCredentials, ids: string[]): Promise<void> {
      if (!Array.isArray(ids) || ids.length > 100)
        throw new ChatToolsError('Invalid EventSub subscription IDs.')
      await Promise.all(
        ids.map((id) =>
          helix(credentials, 'eventsub/subscriptions', 'DELETE', {
            id: string(id, 'Subscription ID', 200),
          }),
        ),
      )
    },
  }
}
