import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import type { DonationEvent, DonationOAuthTokens } from '@twirchat/shared/donations'

import { DonationOAuthNotEnabled } from '../src/auth/donations'
import { DonationCredentialRejected } from '../src/donations/providers'
import { createDonationService, type DonationService } from '../src/donations/service'
import { encryptAsync } from '../src/store/crypto'

const originalTokens: DonationOAuthTokens = {
  accessToken: 'original-access',
  refreshToken: 'original-refresh',
  expiresAt: Date.now() + 3_600_000,
}
const rotatedTokens: DonationOAuthTokens = {
  ...originalTokens,
  accessToken: 'rotated-access',
  refreshToken: 'rotated-refresh',
}

let db: Database
let service: DonationService | undefined

beforeEach(() => {
  db = new Database(':memory:')
  db.run('CREATE TABLE client_identity (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
})

afterEach(() => {
  service?.dispose()
  service = undefined
  db.close()
})

test('refreshes rejected OAuth access, delivers the event, and restores rotated credentials', async () => {
  const donated = Promise.withResolvers<DonationEvent>()
  const restored = Promise.withResolvers<string>()
  const refresh = mock(async () => rotatedTokens)
  const event: DonationEvent = {
    id: '5',
    provider: 'memealerts',
    username: 'Donor',
    amount: '25.00',
    currency: 'RUB',
    message: 'Hello',
    timestamp: 1794250000000,
  }
  const options = {
    db,
    openBrowser: async () => {},
    onConnections: () => {},
    onDonation: donated.resolve,
  }
  const authorize = mock(async () => originalTokens)
  service = createDonationService(options, {
    authorize,
    refresh,
    receive: async ({ credential, onConnected, onDonation, signal }) => {
      if (credential === originalTokens.accessToken)
        throw new DonationCredentialRejected('memealerts')
      expect(credential).toBe(rotatedTokens.accessToken)
      onConnected()
      onDonation(event)
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
    },
  })
  service.connect({ provider: 'memealerts' })
  expect(await donated.promise).toEqual(event)
  expect(service.getConnections().memealerts.status).toBe('connected')
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(refresh).toHaveBeenCalledWith({
    provider: 'memealerts',
    refreshToken: originalTokens.refreshToken,
    signal: expect.any(AbortSignal),
  })
  const saved = db.query<{ value: string }, []>('SELECT value FROM client_identity').get()
  expect(saved?.value).toBeTruthy()
  expect(saved?.value).not.toContain(rotatedTokens.refreshToken)
  service.dispose()
  service = createDonationService(options, {
    authorize,
    refresh,
    receive: async ({ credential }) => restored.resolve(credential),
  })
  service.start()
  expect(await restored.promise).toBe(rotatedTokens.accessToken)
  expect(authorize).toHaveBeenCalledTimes(1)
})

test('disconnect cancels a pending local DonationAlerts flow before storing its token', async () => {
  const access = { accessToken: 'local-access', expiresAt: originalTokens.expiresAt }
  const tokens = Promise.withResolvers<typeof access>()
  const finished = Promise.withResolvers<void>()
  const receive = mock(async () => {})
  const authorize = mock(async () => originalTokens)
  service = createDonationService(
    { db, openBrowser: async () => {}, onConnections: () => {}, onDonation: () => {} },
    {
      authorize,
      authorizeAlerts: ({ signal }) => {
        signal.addEventListener('abort', () => finished.resolve(), { once: true })
        return tokens.promise
      },
      receive,
    },
  )
  service.connect({ provider: 'donationalerts' })
  expect(service.getConnections().donationalerts.status).toBe('authorizing')
  service.disconnect('donationalerts')
  await finished.promise
  tokens.resolve(access)
  await Bun.sleep(0)
  expect(service.getConnections().donationalerts.status).toBe('disconnected')
  expect(db.query('SELECT value FROM client_identity').get()).toBeNull()
  expect(authorize).not.toHaveBeenCalled()
  expect(receive).not.toHaveBeenCalled()
})

test.each([
  {
    state: 'rejected',
    remaining: 30_000,
    connections: 1,
    message: 'The service rejected authorization. Connect again.',
  },
  {
    state: 'expired',
    remaining: -1000,
    connections: 0,
    message: 'DonationAlerts authorization expired. Connect again.',
  },
])(
  'requires local sign-in for $state legacy DonationAlerts tokens without refresh',
  async ({ remaining, connections, message }) => {
    const stopped = Promise.withResolvers<string>()
    const refresh = mock(async () => rotatedTokens)
    const receive = mock(async () => {
      throw new DonationCredentialRejected('donationalerts')
    })
    const legacy = await encryptAsync(
      JSON.stringify({ ...originalTokens, expiresAt: Date.now() + remaining }),
    )
    db.run('INSERT INTO client_identity (key, value) VALUES (?, ?)', [
      'secret:donations:donationalerts',
      legacy,
    ])
    service = createDonationService(
      {
        db,
        openBrowser: async () => {},
        onConnections: ({ donationalerts }) => {
          if (donationalerts.status === 'error') stopped.resolve(donationalerts.message)
        },
        onDonation: () => {},
      },
      { refresh, receive },
    )
    service.start()
    expect(await stopped.promise).toBe(message)
    expect(receive).toHaveBeenCalledTimes(connections)
    if (connections) {
      expect(receive).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'donationalerts',
          credential: originalTokens.accessToken,
        }),
      )
    }
    expect(refresh).not.toHaveBeenCalled()
    expect(db.query('SELECT value FROM client_identity').get()).toEqual({ value: legacy })
    service.disconnect('donationalerts')
    expect(service.getConnections().donationalerts.status).toBe('disconnected')
    expect(db.query('SELECT value FROM client_identity').get()).toBeNull()
  },
)

test('a disabled OAuth refresh stops reconnecting and allows disconnect', async () => {
  const stopped = Promise.withResolvers<string>()
  const receive = mock(async () => {})
  service = createDonationService(
    {
      db,
      openBrowser: async () => {},
      onConnections: ({ memealerts }) => {
        if (memealerts.status === 'error') stopped.resolve(memealerts.message)
      },
      onDonation: () => {},
    },
    {
      authorize: async () => ({ ...originalTokens, expiresAt: Date.now() - 1000 }),
      refresh: async () => {
        throw new DonationOAuthNotEnabled('memealerts')
      },
      receive,
    },
  )
  service.connect({ provider: 'memealerts' })
  expect(await stopped.promise).toBe('MemeAlerts is not enabled yet.')
  expect(receive).not.toHaveBeenCalled()
  service.disconnect('memealerts')
  expect(service.getConnections().memealerts.status).toBe('disconnected')
  expect(db.query('SELECT value FROM client_identity').get()).toBeNull()
})

function donatePayEvent(id: string): DonationEvent {
  return {
    id,
    provider: 'donatepay',
    username: 'Donor',
    amount: '10',
    currency: 'RUB',
    message: '',
    timestamp: 1,
  }
}

test('shares new connections by default and remembers an opt-out across restarts', async () => {
  const shared: DonationEvent[] = []
  const received: DonationEvent[] = []
  const sharingUpdates: unknown[] = []
  const delivered = Promise.withResolvers<void>()
  const receiving = Promise.withResolvers<(donation: DonationEvent) => void>()
  const options = {
    db,
    openBrowser: async () => {},
    onConnections: () => {},
    onDonation: (donation: DonationEvent) => {
      received.push(donation)
      if (received.length === 2) delivered.resolve()
    },
    onSharing: (sharing: unknown) => sharingUpdates.push(sharing),
    onShare: (donation: DonationEvent) => shared.push(donation),
  }
  const dependencies = {
    receive: async ({
      onConnected,
      onDonation,
      signal,
    }: {
      onConnected: () => void
      onDonation: (donation: DonationEvent) => void
      signal: AbortSignal
    }) => {
      receiving.resolve(onDonation)
      onConnected()
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
    },
  }
  service = createDonationService(options, dependencies)
  expect(service.getSharing()).toEqual({ donationalerts: true, donatepay: true })
  service.connect({ provider: 'donatepay', apiKey: 'key' })
  const deliver = await receiving.promise
  deliver(donatePayEvent('shared'))
  service.setSharing('donatepay', false)
  deliver(donatePayEvent('private'))
  await delivered.promise
  expect(received.map((item) => item.id)).toEqual(['shared', 'private'])
  expect(shared.map((item) => item.id)).toEqual(['shared'])
  expect(sharingUpdates).toEqual([{ donationalerts: true, donatepay: false }])

  service.dispose()
  service = createDonationService(options, dependencies)
  expect(service.getSharing().donatepay).toBe(false)
  service.connect({ provider: 'donatepay', apiKey: 'key' })
  expect(service.getSharing().donatepay).toBe(true)
  service.setSharing('donatepay', false)
  service.disconnect('donatepay')
  expect(service.getSharing().donatepay).toBe(true)
})
