import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import type { DonationEvent, DonationOAuthTokens } from '@twirchat/shared/donations'

import { DonationCredentialRejected } from '../src/donations/providers'
import { createDonationService, type DonationService } from '../src/donations/service'

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
    provider: 'donationalerts',
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
        throw new DonationCredentialRejected('donationalerts')
      expect(credential).toBe(rotatedTokens.accessToken)
      onConnected()
      onDonation(event)
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
    },
  })
  service.connect({ provider: 'donationalerts' })
  expect(await donated.promise).toEqual(event)
  expect(service.getConnections().donationalerts.status).toBe('connected')
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(refresh).toHaveBeenCalledWith({
    provider: 'donationalerts',
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

test('disconnect cancels a pending OAuth flow and blocks a late token from being stored', async () => {
  const tokens = Promise.withResolvers<DonationOAuthTokens>()
  const finished = Promise.withResolvers<void>()
  const receive = mock(async () => {})
  const refresh = mock(async () => rotatedTokens)
  service = createDonationService(
    { db, openBrowser: async () => {}, onConnections: () => {}, onDonation: () => {} },
    {
      authorize: ({ signal }) => {
        signal.addEventListener('abort', () => finished.resolve(), { once: true })
        return tokens.promise
      },
      refresh,
      receive,
    },
  )
  service.connect({ provider: 'memealerts' })
  expect(service.getConnections().memealerts.status).toBe('authorizing')
  service.disconnect('memealerts')
  await finished.promise
  tokens.resolve(originalTokens)
  await Bun.sleep(0)
  expect(service.getConnections().memealerts.status).toBe('disconnected')
  expect(db.query('SELECT value FROM client_identity').get()).toBeNull()
  expect(receive).not.toHaveBeenCalled()
})
