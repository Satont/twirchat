import { expect, test } from 'bun:test'

import type { DonationEvent, DonationProvider } from '@twirchat/shared/donations'

import {
  DonationCredentialRejected,
  normalizeDonation,
  receiveDonations,
} from '../src/donations/providers'

const donationAlerts = {
  id: 37,
  name: 'donation',
  username: 'Daria',
  amount: '125.50',
  currency: 'RUB',
  message: 'Hello!',
  created_at: '2026-11-09 12:00:00',
}
const donationAlertsPublication = { ...donationAlerts, name: 'Donations' }
const donatePay = {
  notification: {
    id: 42,
    type: 'donation',
    vars: JSON.stringify({ name: 'Pay donor', sum: '19.80', comment: 'Hi!' }),
  },
  transaction: { currency: 'EUR' },
}
const memeAlerts = {
  reason: 'new',
  data: {
    id: 'donation-id',
    type: 'coins',
    username: 'Meme donor',
    amount: 5,
    message: '',
    createdAt: 1_794_225_600_000,
  },
}

test('normalizes provider publications without losing money precision or units', () => {
  expect(normalizeDonation('donationalerts', donationAlerts, 456)).toEqual({
    id: '37',
    provider: 'donationalerts',
    username: 'Daria',
    amount: '125.50',
    currency: 'RUB',
    message: 'Hello!',
    timestamp: 456,
  })
  expect(normalizeDonation('donatepay', donatePay, 123)).toEqual({
    id: '42',
    provider: 'donatepay',
    username: 'Pay donor',
    amount: '19.80',
    currency: 'EUR',
    message: 'Hi!',
    timestamp: 123,
  })
  expect(normalizeDonation('memealerts', memeAlerts, 789)).toMatchObject({
    id: 'donation-id',
    amount: '5',
    currency: 'coins',
    timestamp: 789,
  })
  expect(
    normalizeDonation('memealerts', {
      ...memeAlerts,
      data: { ...memeAlerts.data, type: 'currency', currencyName: 'рублей' },
    }),
  ).toMatchObject({ currency: 'рублей' })
  expect(
    normalizeDonation('memealerts', {
      ...memeAlerts,
      data: { ...memeAlerts.data, currencyName: 'монет' },
    }),
  ).toMatchObject({ currency: 'монет' })
  expect(normalizeDonation('memealerts', { ...memeAlerts, reason: 'updated' })).toBeNull()
  expect(
    normalizeDonation('donatepay', { notification: { ...donatePay.notification, vars: '{' } }),
  ).toBeNull()
  expect(normalizeDonation('donationalerts', { ...donationAlerts, amount: 'free' })).toBeNull()
})

interface ProtocolFixture {
  provider: DonationProvider
  channel: string
  payload: unknown
  connect: object
  connected: object
  subscribe: object
  subscribed: object
  publication(channel: string): object
}

const fixtures: ProtocolFixture[] = [
  {
    provider: 'donationalerts',
    channel: '$alerts:donation_9',
    payload: donationAlertsPublication,
    connect: { id: 1, params: { token: 'connection-token' } },
    connected: { id: 1, result: { client: 'client-id', version: '2.2.1' } },
    subscribe: {
      id: 2,
      method: 1,
      params: { channel: '$alerts:donation_9', token: 'subscription-token' },
    },
    subscribed: { id: 2, result: { recoverable: true } },
    publication: (channel) => ({
      result: { channel, type: 0, data: { data: donationAlertsPublication } },
    }),
  },
  {
    provider: 'donatepay',
    channel: 'notifications#9',
    payload: donatePay,
    connect: { id: 1, params: { token: 'connection-token' } },
    connected: { id: 1, result: { client: 'client-id' } },
    subscribe: { id: 2, method: 1, params: { channel: 'notifications#9' } },
    subscribed: { id: 2, result: {} },
    publication: (channel) => ({ result: { channel, type: 0, data: { data: donatePay } } }),
  },
  {
    provider: 'memealerts',
    channel: '$alerts:donation_9',
    payload: memeAlerts,
    connect: { id: 1, connect: { token: 'connection-token' } },
    connected: { id: 1, connect: { client: 'client-id', ping: 25, pong: true } },
    subscribe: {
      id: 2,
      subscribe: { channel: '$alerts:donation_9', token: 'subscription-token' },
    },
    subscribed: { id: 2, subscribe: {} },
    publication: (channel) => ({ push: { channel, pub: { data: memeAlerts } } }),
  },
]

for (const fixture of fixtures) {
  test(`${fixture.provider} authorizes its socket and delivers only its channel's publications`, async () => {
    const controller = new AbortController()
    const donations: DonationEvent[] = []
    const frames: unknown[] = []
    const calls: string[] = []
    let connected = false
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request, self) {
        return self.upgrade(request) ? undefined : new Response(null, { status: 400 })
      },
      websocket: {
        message(socket, data) {
          frames.push(JSON.parse(data.toString()))
          if (frames.length === 1) socket.send(JSON.stringify(fixture.connected))
          if (frames.length === 2)
            socket.send(
              [
                fixture.subscribed,
                fixture.publication('wrong-channel'),
                fixture.publication(fixture.channel),
                {},
              ]
                .map((frame) => JSON.stringify(frame))
                .join('\n'),
            )
          if (frames.length === 3) controller.abort()
        },
      },
    })

    try {
      await receiveDonations(
        {
          provider: fixture.provider,
          credential: 'private-key',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]),
          onConnected: () => {
            connected = true
          },
          onDonation: (event) => {
            donations.push(event)
            if (fixture.provider !== 'memealerts') controller.abort()
          },
        },
        {
          async fetch(url, request) {
            calls.push(url.pathname)
            expect(request.redirect).toBe('error')
            if (url.pathname === '/api/v1/user') {
              expect(url.searchParams.get('access_token')).toBe('private-key')
              return Response.json({ status: 'success', data: { id: 9 } })
            }
            if (url.pathname === '/api/v2/socket/token') {
              expect(request.method).toBe('POST')
              expect(request.body).toBe(JSON.stringify({ access_token: 'private-key' }))
              return Response.json({ token: 'connection-token' })
            }
            expect(new Headers(request.headers).get('Authorization')).toBe('Bearer private-key')
            if (url.pathname === '/api/v1/user/oauth')
              return Response.json({
                data: { id: '9', socket_connection_token: 'connection-token' },
              })
            expect(url.pathname).toBe('/api/v1/centrifuge/subscribe')
            expect(request.body).toBe(
              JSON.stringify({ channels: [fixture.channel], client: 'client-id' }),
            )
            return Response.json({
              channels: [{ channel: fixture.channel, token: 'subscription-token' }],
            })
          },
          socket: () => new WebSocket(`ws://${server.hostname}:${server.port}`),
        },
      )
      expect(connected).toBe(true)
      expect(controller.signal.aborted).toBe(true)
      expect(donations).toHaveLength(1)
      expect(donations[0] ?? null).toEqual(
        normalizeDonation(fixture.provider, fixture.payload, donations[0]?.timestamp),
      )
      expect(frames).toEqual(
        fixture.provider === 'memealerts'
          ? [fixture.connect, fixture.subscribe, {}]
          : [fixture.connect, fixture.subscribe],
      )
      expect(calls).toHaveLength(2)
    } finally {
      controller.abort()
      await server.stop(true)
    }
  })
}

test.each([
  {
    provider: 'donationalerts',
    label: 'DonationAlerts',
    reply: () => new Response('do-not-leak-this-secret', { status: 401 }),
  },
  {
    provider: 'donatepay',
    label: 'DonatePay',
    reply: () => Response.json({ status: 'error', message: 'Incorrect token' }),
  },
] satisfies { provider: DonationProvider; label: string; reply: () => Response }[])(
  '$label exposes authentication failures without copying provider responses or credentials',
  async ({ provider, label, reply }) => {
    const receive = receiveDonations(
      {
        provider,
        credential: 'do-not-leak-this-secret',
        signal: new AbortController().signal,
        onConnected: () => {},
        onDonation: () => {},
      },
      {
        async fetch() {
          return reply()
        },
        socket: () => {
          throw new Error('Unexpected connection')
        },
      },
    )
    await expect(receive).rejects.toBeInstanceOf(DonationCredentialRejected)
    await expect(receive).rejects.toThrow(
      `${label} rejected the credentials. Reconnect the integration.`,
    )
  },
)
