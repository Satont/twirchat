import { expect, mock, test } from 'bun:test'

import type {
  ConnectDonationProvider,
  DonationConnections,
  DonationProvider,
  DonationSharing,
  ShareableDonationProvider,
} from '@twirchat/shared/donations'

import { getDonationAlertsDesktopClientId } from '../src/auth/client-config'
import { getDonationOAuthAvailability } from '../src/auth/donations'
import { createDonationsApi } from '../src/gpuix/backend/donations-api'

test('donation requests delegate to the service and defer mutations past the current turn', async () => {
  const connections: DonationConnections = {
    donationalerts: { status: 'disconnected' },
    donatepay: { status: 'disconnected' },
    memealerts: { status: 'disconnected' },
  }
  let sharing: DonationSharing = { donationalerts: true, donatepay: true }
  const connect = mock((_params: ConnectDonationProvider) => {})
  const disconnect = mock((_provider: DonationProvider) => {})
  const setSharing = mock((provider: ShareableDonationProvider, enabled: boolean) => {
    sharing = { ...sharing, [provider]: enabled }
  })
  const api = createDonationsApi({
    getConnections: () => connections,
    getSharing: () => sharing,
    connect,
    disconnect,
    setSharing,
  })
  expect(await api.getDonationConnections()).toBe(connections)
  expect(await api.getDonationSharing()).toBe(sharing)

  const params: ConnectDonationProvider = { provider: 'memealerts' }
  const connecting = api.connectDonationProvider(params)
  const disconnecting = api.disconnectDonationProvider({ provider: 'donationalerts' })
  const updating = api.setDonationSharing({ provider: 'donatepay', enabled: false })
  await Promise.resolve()
  expect(connect).not.toHaveBeenCalled()
  expect(disconnect).not.toHaveBeenCalled()
  expect(setSharing).not.toHaveBeenCalled()

  const [, , updated] = await Promise.all([connecting, disconnecting, updating])
  expect(connect).toHaveBeenCalledTimes(1)
  expect(connect).toHaveBeenCalledWith(params)
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(disconnect).toHaveBeenCalledWith('donationalerts')
  expect(setSharing).toHaveBeenCalledTimes(1)
  expect(setSharing).toHaveBeenCalledWith('donatepay', false)
  expect(updated).toBe(sharing)
  expect(updated).toEqual({ donationalerts: true, donatepay: false })
})

test('donation OAuth availability remains independent of the service', async () => {
  const api = createDonationsApi(undefined)
  expect(api.donationAlertsOAuthAvailable).toBe(getDonationAlertsDesktopClientId() !== null)
  expect(api.getDonationOAuthAvailability).toBe(getDonationOAuthAvailability)
  const unavailable = 'Donation integrations are unavailable.'
  await expect(api.getDonationConnections()).rejects.toThrow(unavailable)
  await expect(api.getDonationSharing()).rejects.toThrow(unavailable)
  await expect(api.connectDonationProvider({ provider: 'memealerts' })).rejects.toThrow(unavailable)
  await expect(api.disconnectDonationProvider({ provider: 'memealerts' })).rejects.toThrow(
    unavailable,
  )
  await expect(api.setDonationSharing({ provider: 'donatepay', enabled: false })).rejects.toThrow(
    unavailable,
  )
})
