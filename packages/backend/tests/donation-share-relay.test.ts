import { expect, mock, test } from 'bun:test'

import type { BackendToDesktopMessage } from '@twirchat/shared'
import type { DonationEvent, DonationShareIdentity } from '@twirchat/shared/donations'

import { verifyDonationShareIdentity } from '../src/donations/share-identity'
import { createDonationShareRelay } from '../src/donations/share-relay'
import { desktopMessageSchema } from '../src/ws/message-schema'

function donation(
  id: string,
  provider: DonationEvent['provider'] = 'donationalerts',
): DonationEvent {
  return {
    id,
    provider,
    username: 'Donor',
    amount: '100',
    currency: 'RUB',
    message: 'hi',
    timestamp: 1,
  }
}

function setup(now = () => 0) {
  const sent: { client: string; message: BackendToDesktopMessage }[] = []
  const verify = mock(async ({ platform, accessToken }: DonationShareIdentity) =>
    accessToken === 'bad' ? null : { platform, channel: accessToken },
  )
  const relay = createDonationShareRelay({
    verify,
    send: (client, message) => sent.push({ client, message }),
    now,
  })
  return { relay, sent, verify }
}

test('relays a shared donation to other clients watching a chat the streamer owns', async () => {
  const { relay, sent } = setup()
  relay.watch('viewer', [{ platform: 'twitch', channel: 'Streamer' }])
  relay.watch('other', [{ platform: 'twitch', channel: 'someone-else' }])
  relay.watch('streamer', [{ platform: 'twitch', channel: 'streamer' }])
  relay.setIdentities('streamer', [{ platform: 'twitch', accessToken: 'streamer' }])

  expect(await relay.share('streamer', donation('1'))).toBe(1)
  expect(sent).toEqual([
    {
      client: 'viewer',
      message: {
        type: 'shared_donation',
        channel: { platform: 'twitch', channel: 'streamer' },
        donation: donation('1'),
      },
    },
  ])
})

test('drops donations from clients without a verified chat or from unshareable providers', async () => {
  const { relay, sent } = setup()
  relay.watch('viewer', [{ platform: 'kick', channel: 'victim' }])
  expect(await relay.share('stranger', donation('1'))).toBe(0)
  relay.setIdentities('liar', [{ platform: 'kick', accessToken: 'bad' }])
  expect(await relay.share('liar', donation('2'))).toBe(0)
  relay.setIdentities('streamer', [{ platform: 'kick', accessToken: 'victim' }])
  expect(await relay.share('streamer', donation('3', 'memealerts'))).toBe(0)
  relay.setIdentities('streamer', [])
  expect(await relay.share('streamer', donation('4'))).toBe(0)
  expect(sent).toHaveLength(0)
})

test('waits for ownership checks that are still running when a donation arrives', async () => {
  const sent: string[] = []
  const verified = Promise.withResolvers<{ platform: 'twitch'; channel: string }>()
  const relay = createDonationShareRelay({
    verify: () => verified.promise,
    send: (client) => sent.push(client),
  })
  relay.watch('viewer', [{ platform: 'twitch', channel: 'streamer' }])
  relay.setIdentities('streamer', [{ platform: 'twitch', accessToken: 'token' }])
  const sharing = relay.share('streamer', donation('1'))
  verified.resolve({ platform: 'twitch', channel: 'streamer' })
  expect(await sharing).toBe(1)
  expect(sent).toEqual(['viewer'])
})

test('limits each streamer to 30 shares per minute', async () => {
  let time = 0
  const { relay } = setup(() => time)
  relay.watch('viewer', [{ platform: 'twitch', channel: 'streamer' }])
  relay.setIdentities('streamer', [{ platform: 'twitch', accessToken: 'streamer' }])
  const results = await Promise.all(
    Array.from({ length: 31 }, (_, index) => relay.share('streamer', donation(String(index)))),
  )
  expect(results.filter(Boolean)).toHaveLength(30)
  time = 60_000
  expect(await relay.share('streamer', donation('next'))).toBe(1)
})

test('replacing or removing a client forgets its watched chats and ownership', async () => {
  const { relay, sent } = setup()
  relay.setIdentities('streamer', [{ platform: 'twitch', accessToken: 'streamer' }])
  relay.watch('viewer', [{ platform: 'twitch', channel: 'streamer' }])
  relay.watch('viewer', [])
  expect(await relay.share('streamer', donation('1'))).toBe(0)
  relay.watch('viewer', [{ platform: 'twitch', channel: 'streamer' }])
  relay.removeClient('viewer')
  expect(await relay.share('streamer', donation('2'))).toBe(0)
  relay.watch('viewer', [{ platform: 'twitch', channel: 'streamer' }])
  relay.removeClient('streamer')
  expect(await relay.share('streamer', donation('3'))).toBe(0)
  expect(sent).toHaveLength(0)
})

test('resolves the owned chat from the platform token', async () => {
  const fetcher = mock(async (url: string, init: RequestInit) => {
    const authorization = new Headers(init.headers).get('Authorization')
    if (url === 'https://id.twitch.tv/oauth2/validate')
      return authorization === 'OAuth twitch-token'
        ? Response.json({ login: 'Streamer', user_id: '1' })
        : new Response('', { status: 401 })
    return authorization === 'Bearer kick-token'
      ? Response.json({ data: [{ slug: 'Kick_Streamer', broadcaster_user_id: 2 }] })
      : new Response('', { status: 401 })
  })
  expect(
    await verifyDonationShareIdentity({ platform: 'twitch', accessToken: 'twitch-token' }, fetcher),
  ).toEqual({ platform: 'twitch', channel: 'streamer' })
  expect(
    await verifyDonationShareIdentity({ platform: 'kick', accessToken: 'kick-token' }, fetcher),
  ).toEqual({ platform: 'kick', channel: 'kick_streamer' })
  expect(
    await verifyDonationShareIdentity({ platform: 'twitch', accessToken: 'stolen' }, fetcher),
  ).toBeNull()
  expect(
    await verifyDonationShareIdentity({ platform: 'kick', accessToken: 'stolen' }, fetcher),
  ).toBeNull()
})

test('rejects oversized shared donations and watch lists', () => {
  expect(
    desktopMessageSchema.safeParse({ type: 'donation_share', donation: donation('1') }).success,
  ).toBe(true)
  expect(
    desktopMessageSchema.safeParse({
      type: 'donation_share',
      donation: { ...donation('1'), message: 'x'.repeat(1001) },
    }).success,
  ).toBe(false)
  expect(
    desktopMessageSchema.safeParse({
      type: 'donation_watch',
      channels: Array.from({ length: 201 }, (_, index) => ({
        platform: 'twitch',
        channel: `c${index}`,
      })),
    }).success,
  ).toBe(false)
})
