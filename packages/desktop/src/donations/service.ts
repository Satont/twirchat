import type { Database } from 'bun:sqlite'
import { setTimeout as delay } from 'node:timers/promises'

import {
  DONATION_PROVIDERS,
  type ConnectDonationProvider,
  type DonationConnection,
  type DonationConnections,
  type DonationEvent,
  type DonationOAuthTokens,
  type DonationProvider,
} from '@twirchat/shared/donations'
import { z } from 'zod'

import {
  authorizeDonationAlerts,
  type DonationAlertsAccessToken,
  DonationAlertsAuthError,
  donationAlertsAccessTokenSchema,
} from '../auth/donationalerts'
import {
  authorizeDonation,
  DonationOAuthError,
  DonationOAuthNotEnabled,
  DonationOAuthReconnectRequired,
  donationOAuthTokensSchema,
  refreshDonation,
} from '../auth/donations'
import { decryptAsync, encryptAsync } from '../store/crypto'
import { DonationCredentialRejected, receiveDonations } from './providers'

const apiKeySchema = z.string().trim().min(1).max(4096).regex(/^\S+$/u)
const REFRESH_MARGIN = 60_000
const MIN_RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 60_000

type Credential =
  | { provider: 'donatepay'; apiKey: string }
  | { provider: 'donationalerts'; tokens: DonationAlertsAccessToken }
  | { provider: 'memealerts'; tokens: DonationOAuthTokens }

interface DonationServiceOptions {
  db: Database
  openBrowser: (url: string) => Promise<void>
  onConnections: (connections: DonationConnections) => void
  onDonation: (event: DonationEvent) => void
}

const defaultDependencies = {
  authorize: authorizeDonation,
  authorizeAlerts: authorizeDonationAlerts,
  refresh: refreshDonation,
  receive: receiveDonations,
}

function credentialKey(provider: DonationProvider): string {
  return `secret:donations:${provider}`
}

async function restoreCredential(
  provider: DonationProvider,
  encrypted: string,
): Promise<Credential> {
  try {
    const raw = await decryptAsync(encrypted)
    if (provider === 'donatepay') return { provider, apiKey: apiKeySchema.parse(raw) }
    const value: unknown = JSON.parse(raw)
    if (provider === 'donationalerts')
      return { provider, tokens: donationAlertsAccessTokenSchema.parse(value) }
    return { provider, tokens: donationOAuthTokensSchema.parse(value) }
  } catch {
    throw new DonationOAuthError('Saved credentials could not be opened. Connect again.')
  }
}

export function createDonationService(
  { db, openBrowser, onConnections, onDonation }: DonationServiceOptions,
  dependencies: Partial<typeof defaultDependencies> = {},
) {
  const { authorize, authorizeAlerts, refresh, receive } = {
    ...defaultDependencies,
    ...dependencies,
  }
  let connections: DonationConnections = {
    donationalerts: { status: 'disconnected' },
    donatepay: { status: 'disconnected' },
    memealerts: { status: 'disconnected' },
  }
  const active = new Map<DonationProvider, AbortController>()
  const read = db.query<{ value: string }, [string]>(
    'SELECT value FROM client_identity WHERE key = ?',
  )
  const write = db.query(
    'INSERT INTO client_identity (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  const remove = db.query('DELETE FROM client_identity WHERE key = ?')

  function publish(provider: DonationProvider, connection: DonationConnection) {
    connections = { ...connections, [provider]: connection }
    onConnections(connections)
  }

  async function save(credential: Credential, signal: AbortSignal) {
    signal.throwIfAborted()
    const value =
      credential.provider === 'donatepay' ? credential.apiKey : JSON.stringify(credential.tokens)
    const encrypted = await encryptAsync(value)
    signal.throwIfAborted()
    write.run(credentialKey(credential.provider), encrypted)
  }

  /* oxlint-disable no-await-in-loop -- One connection and token rotation at a time per provider. */
  async function supervise(initial: Credential, signal: AbortSignal) {
    const provider = initial.provider
    let credential = initial
    let reconnectDelay = MIN_RECONNECT_DELAY
    let refreshAfterRejection = false
    let retriedRejectedCredential = false
    while (!signal.aborted) {
      publish(provider, { status: 'connecting' })
      try {
        if (credential.provider === 'donationalerts' && credential.tokens.expiresAt <= Date.now())
          throw new DonationOAuthReconnectRequired(credential.provider)
        if (
          credential.provider === 'memealerts' &&
          (refreshAfterRejection || credential.tokens.expiresAt - Date.now() < REFRESH_MARGIN)
        ) {
          const tokens = await refresh({
            provider: credential.provider,
            refreshToken: credential.tokens.refreshToken,
            signal,
          })
          credential = { provider: credential.provider, tokens }
          await save(credential, signal)
          refreshAfterRejection = false
        }
        signal.throwIfAborted()
        await receive({
          provider,
          credential:
            credential.provider === 'donatepay' ? credential.apiKey : credential.tokens.accessToken,
          signal,
          onDonation: (event) => {
            if (!signal.aborted) onDonation(event)
          },
          onConnected: () => {
            if (signal.aborted) return
            reconnectDelay = MIN_RECONNECT_DELAY
            retriedRejectedCredential = false
            publish(provider, { status: 'connected' })
          },
        })
      } catch (error) {
        if (signal.aborted) return
        if (
          error instanceof DonationOAuthReconnectRequired ||
          error instanceof DonationOAuthNotEnabled
        ) {
          publish(provider, { status: 'error', message: error.message })
          return
        }
        if (error instanceof DonationCredentialRejected) {
          if (provider === 'memealerts' && !retriedRejectedCredential) {
            retriedRejectedCredential = true
            refreshAfterRejection = true
            continue
          }
          publish(provider, {
            status: 'error',
            message:
              provider === 'donatepay'
                ? 'DonatePay rejected the API key. Copy a valid key and connect again.'
                : 'The service rejected authorization. Connect again.',
          })
          return
        }
      }
      if (signal.aborted) return
      publish(provider, {
        status: 'error',
        message: 'Connection lost. Reconnecting automatically.',
      })
      await delay(reconnectDelay + (Math.random() * reconnectDelay) / 4, undefined, { signal })
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
    }
  }
  /* oxlint-enable no-await-in-loop */

  function launch(
    provider: DonationProvider,
    status: 'authorizing' | 'connecting',
    getCredential: (signal: AbortSignal) => Promise<Credential>,
  ) {
    active.get(provider)?.abort()
    const controller = new AbortController()
    const { signal } = controller
    active.set(provider, controller)
    publish(provider, { status })
    getCredential(signal)
      .then((credential) => supervise(credential, signal))
      .catch((error: unknown) => {
        if (!signal.aborted) {
          const message =
            error instanceof DonationOAuthError || error instanceof DonationAlertsAuthError
              ? error.message
              : 'Could not connect. Try again.'
          publish(provider, { status: 'error', message })
        }
      })
      .finally(() => {
        if (active.get(provider) === controller) active.delete(provider)
      })
  }

  return {
    getConnections: () => connections,
    start() {
      for (const provider of DONATION_PROVIDERS) {
        const saved = read.get(credentialKey(provider))
        if (saved) launch(provider, 'connecting', () => restoreCredential(provider, saved.value))
      }
    },
    connect(params: ConnectDonationProvider) {
      const { provider } = params
      if (provider === 'donatepay') {
        const parsed = apiKeySchema.safeParse(params.apiKey)
        if (!parsed.success) throw new Error('Copy a valid DonatePay API key first.')
        const credential: Credential = { provider, apiKey: parsed.data }
        launch(provider, 'connecting', async (signal) => {
          await save(credential, signal)
          return credential
        })
        return
      }
      launch(provider, 'authorizing', async (signal) => {
        const credential: Credential =
          provider === 'donationalerts'
            ? { provider, tokens: await authorizeAlerts({ signal, openBrowser }) }
            : { provider, tokens: await authorize({ provider, signal, openBrowser }) }
        await save(credential, signal)
        return credential
      })
    },
    disconnect(provider: DonationProvider) {
      remove.run(credentialKey(provider))
      active.get(provider)?.abort()
      active.delete(provider)
      publish(provider, { status: 'disconnected' })
    },
    dispose() {
      for (const controller of active.values()) controller.abort()
      active.clear()
    },
  }
}

export type DonationService = ReturnType<typeof createDonationService>
