import {
  DONATION_PROVIDER_LABELS,
  type DonationEvent,
  type DonationProvider,
  type OAuthDonationProvider,
} from '@twirchat/shared/donations'
import { z } from 'zod'

import { runCentrifugo, type CentrifugoProtocol } from './centrifugo'

const OAUTH_ENDPOINTS = {
  donationalerts: {
    api: 'https://www.donationalerts.com/api/v1',
    socket: 'wss://centrifugo.donationalerts.com/connection/websocket',
    protocol: 'legacy',
  },
  memealerts: {
    api: 'https://memealerts.com/api/v1',
    socket: 'wss://memealerts.com/connection/websocket',
    protocol: 'modern',
  },
} satisfies Record<
  OAuthDonationProvider,
  { api: string; socket: string; protocol: CentrifugoProtocol }
>

const DONATEPAY_API = 'https://donatepay.ru/api'
const DONATEPAY_SOCKET = 'wss://centrifugo.donatepay.ru/connection/websocket'
const REQUEST_TIMEOUT_MS = 10_000

const providerId = z.union([
  z.string().trim().min(1).max(128),
  z.number().int().nonnegative().transform(String),
])
const token = z.string().min(1).max(8192)
const oauthProfile = z.object({
  data: z.object({ id: providerId, socket_connection_token: token }),
})
const subscribeReply = z.object({ channels: z.array(z.object({ channel: z.string(), token })) })
const donatePayProfile = z.object({
  status: z.literal('success'),
  data: z.object({ id: providerId }),
})
const donatePaySocketToken = z.object({ token })
const donatePayInvalidKey = z.object({
  status: z.literal('error'),
  message: z.literal('Incorrect token'),
})

const donor = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((value) => value || 'Anonymous')
const text = z
  .string()
  .trim()
  .max(8000)
  .nullish()
  .transform((value) => value ?? '')
const amountSchema = z.union([
  z
    .string()
    .trim()
    .regex(/^\d{1,18}(?:\.\d{1,12})?$/u),
  z.number().nonnegative().transform(String),
])
const currencySchema = z
  .string()
  .trim()
  .regex(/^[a-z]{3}$/iu)
  .transform((value) => value.toUpperCase())
const donationAlertsEvent = z.object({
  id: providerId,
  username: donor,
  amount: amountSchema,
  currency: currencySchema,
  message_type: z.enum(['text', 'audio']).optional(),
  message: text,
})
const donatePayEvent = z.object({
  notification: z.object({
    id: providerId,
    type: z.literal('donation'),
    vars: z.preprocess(parseJsonValue, z.object({ name: donor, sum: amountSchema, comment: text })),
  }),
  transaction: z.object({ currency: currencySchema.nullish() }).nullish(),
})
const memeAlertsEvent = z.object({
  reason: z.literal('new'),
  data: z.object({
    id: providerId,
    type: z.enum(['currency', 'coins']),
    username: donor,
    amount: amountSchema,
    message: text,
    currencyName: z.string().trim().min(1).max(80).nullish(),
  }),
})

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/**
 * Live rows are placed by arrival time: provider `created_at` values carry no reliable timezone
 * (DonationAlerts sends zoneless local time), so a future-dated row would stay pinned below chat.
 */
export function normalizeDonation(
  provider: DonationProvider,
  publication: unknown,
  receivedAt = Date.now(),
): DonationEvent | null {
  const payload = parseJsonValue(publication)
  switch (provider) {
    case 'donationalerts': {
      const result = donationAlertsEvent.safeParse(payload)
      if (!result.success) return null
      const { id, username, amount, currency, message, message_type } = result.data
      return {
        provider,
        id,
        username,
        amount,
        currency,
        message: message_type === 'audio' ? '' : message,
        timestamp: receivedAt,
      }
    }
    case 'donatepay': {
      const result = donatePayEvent.safeParse(payload)
      if (!result.success) return null
      const { notification, transaction } = result.data
      return {
        provider,
        id: notification.id,
        username: notification.vars.name,
        amount: notification.vars.sum,
        currency: transaction?.currency ?? 'RUB',
        message: notification.vars.comment,
        timestamp: receivedAt,
      }
    }
    case 'memealerts': {
      const result = memeAlertsEvent.safeParse(payload)
      if (!result.success) return null
      const { id, username, amount, message, currencyName, type } = result.data.data
      return {
        provider,
        id,
        username,
        amount,
        currency: currencyName ?? (type === 'currency' ? 'RUB' : 'coins'),
        message,
        timestamp: receivedAt,
      }
    }
    default:
      throw new Error('Unsupported donation provider.', { cause: provider satisfies never })
  }
}

export class DonationCredentialRejected extends Error {
  constructor(provider: DonationProvider) {
    super(
      `${DONATION_PROVIDER_LABELS[provider]} rejected the credentials. Reconnect the integration.`,
    )
  }
}

interface DonationReceiver {
  provider: DonationProvider
  credential: string
  signal: AbortSignal
  onDonation: (event: DonationEvent) => void
  onConnected: () => void
}

interface DonationTransport {
  fetch(url: URL, request: RequestInit): Promise<Response>
  socket(url: string): WebSocket
}

const defaultTransport: DonationTransport = {
  fetch: (url, request) => fetch(url, request),
  socket: (url) => new WebSocket(url),
}

export async function receiveDonations(
  { provider, credential, signal, onDonation, onConnected }: DonationReceiver,
  transport: DonationTransport = defaultTransport,
): Promise<void> {
  const label = DONATION_PROVIDER_LABELS[provider]

  async function request<T>(
    url: URL,
    schema: z.ZodType<T>,
    options: RequestInit,
    cancellation = signal,
  ): Promise<T> {
    const response = await transport
      .fetch(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.any([cancellation, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      })
      .catch(() => {
        throw new Error(`Could not reach ${label}.`)
      })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      if (response.status === 401 || response.status === 403)
        throw new DonationCredentialRejected(provider)
      throw new Error(`${label} returned HTTP ${response.status}.`)
    }
    const payload: unknown = await response.json().catch(() => undefined)
    if (provider === 'donatepay' && donatePayInvalidKey.safeParse(payload).success)
      throw new DonationCredentialRejected(provider)
    const result = schema.safeParse(payload)
    if (!result.success) throw new Error(`${label} returned an invalid API response.`)
    return result.data
  }

  function onPublication(payload: unknown): void {
    const event = normalizeDonation(provider, payload)
    if (event) onDonation(event)
  }

  function socket(url: string): WebSocket {
    try {
      return transport.socket(url)
    } catch {
      throw new Error(`Could not open the ${label} WebSocket.`)
    }
  }

  try {
    signal.throwIfAborted()
    if (provider === 'donatepay') {
      const profileUrl = new URL(`${DONATEPAY_API}/v1/user`)
      profileUrl.searchParams.set('access_token', credential)
      const profile = await request(profileUrl, donatePayProfile, {})
      const auth = await request(
        new URL(`${DONATEPAY_API}/v2/socket/token`),
        donatePaySocketToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: credential }),
        },
      )
      signal.throwIfAborted()
      await runCentrifugo({
        protocol: 'legacy',
        socket: socket(DONATEPAY_SOCKET),
        signal,
        token: auth.token,
        subscribe: async () => ({ channel: `notifications#${profile.data.id}` }),
        onConnected,
        onPublication,
      })
      return
    }

    const endpoint = OAUTH_ENDPOINTS[provider]
    const headers = { Authorization: `Bearer ${credential}` }
    const profile = await request(new URL(`${endpoint.api}/user/oauth`), oauthProfile, { headers })
    const channel = `$alerts:donation_${profile.data.id}`
    signal.throwIfAborted()
    await runCentrifugo({
      protocol: endpoint.protocol,
      socket: socket(endpoint.socket),
      signal,
      token: profile.data.socket_connection_token,
      onConnected,
      onPublication,
      async subscribe(client, cancellation) {
        const result = await request(
          new URL(`${endpoint.api}/centrifuge/subscribe`),
          subscribeReply,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ channels: [channel], client }),
          },
          cancellation,
        )
        const subscription = result.channels.find((item) => item.channel === channel)
        if (!subscription) throw new Error(`${label} did not authorize the donation channel.`)
        return subscription
      },
    })
  } catch (error) {
    if (!signal.aborted) throw error
  }
}
