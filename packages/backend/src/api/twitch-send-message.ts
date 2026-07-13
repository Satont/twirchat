import { config } from '../config.ts'
import { normalizeTwitchLogin, resolveTwitchUserId } from './twitch-users.ts'

const MAX_MESSAGE_LENGTH = 500
const MAX_ACCESS_TOKEN_LENGTH = 4096

export interface TwitchSendMessageResult {
  code?: string
  message?: string
  messageId?: string
  sent: boolean
}

interface TwitchSendMessageRequest {
  accessToken?: unknown
  channelLogin?: unknown
  message?: unknown
  replyToMessageId?: unknown
  senderId?: unknown
}

function requiredString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`)
  }
  const result = value.trim()
  if (result.length > maxLength) {
    throw new Error(`${name} is too long`)
  }
  return result
}

function parseRequest(body: TwitchSendMessageRequest) {
  const accessToken = requiredString(body.accessToken, 'accessToken', MAX_ACCESS_TOKEN_LENGTH)
  const channelLogin = normalizeTwitchLogin(requiredString(body.channelLogin, 'channelLogin', 100))
  const message = requiredString(body.message, 'message', MAX_MESSAGE_LENGTH)
  const senderId = requiredString(body.senderId, 'senderId', 64)
  if (!channelLogin) {
    throw new Error('channelLogin is invalid')
  }
  const replyToMessageId =
    body.replyToMessageId === undefined || body.replyToMessageId === ''
      ? undefined
      : requiredString(body.replyToMessageId, 'replyToMessageId', 128)
  return { accessToken, channelLogin, message, replyToMessageId, senderId }
}

export async function handleTwitchSendMessage(request: Request): Promise<TwitchSendMessageResult> {
  const input = parseRequest((await request.json()) as TwitchSendMessageRequest)
  const broadcasterID = await resolveTwitchUserId(input.channelLogin, input.accessToken)
  if (!broadcasterID) {
    throw new Error(`Twitch channel ${input.channelLogin} was not found`)
  }

  const response = await fetch('https://api.twitch.tv/helix/chat/messages', {
    body: JSON.stringify({
      broadcaster_id: broadcasterID,
      sender_id: input.senderId,
      message: input.message,
      ...(input.replyToMessageId ? { reply_parent_message_id: input.replyToMessageId } : {}),
    }),
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Client-Id': config.TWITCH_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300)
    throw new Error(`Twitch send message failed: HTTP ${response.status}${body ? `: ${body}` : ''}`)
  }

  const payload = (await response.json()) as {
    data?: Array<{
      drop_reason?: { code?: string; message?: string }
      is_sent?: boolean
      message_id?: string
    }>
  }
  const delivery = payload.data?.[0]
  if (!delivery) {
    throw new Error('Twitch send message failed: API returned no delivery result')
  }
  if (!delivery.is_sent) {
    return {
      code: delivery.drop_reason?.code,
      message: delivery.drop_reason?.message ?? 'Twitch did not accept the message',
      sent: false,
    }
  }
  return { messageId: delivery.message_id, sent: true }
}
