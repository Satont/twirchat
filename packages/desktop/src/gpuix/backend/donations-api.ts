import type {
  ConnectDonationProvider,
  DonationConnections,
  DonationOAuthAvailability,
  DonationProvider,
  DonationSharing,
  ShareableDonationProvider,
} from '@twirchat/shared/donations'

import { getDonationAlertsDesktopClientId } from '../../auth/client-config'
import { getDonationOAuthAvailability } from '../../auth/donations'
import type { DonationService } from '../../donations/service'

export interface DonationsApi {
  donationAlertsOAuthAvailable: boolean
  getDonationConnections(): Promise<DonationConnections>
  getDonationOAuthAvailability(this: void): Promise<DonationOAuthAvailability | null>
  connectDonationProvider(params: ConnectDonationProvider): Promise<void>
  disconnectDonationProvider(params: { provider: DonationProvider }): Promise<void>
  getDonationSharing(): Promise<DonationSharing>
  setDonationSharing(params: {
    provider: ShareableDonationProvider
    enabled: boolean
  }): Promise<DonationSharing>
}

export function createDonationsApi(
  service:
    | Pick<
        DonationService,
        'getConnections' | 'getSharing' | 'connect' | 'disconnect' | 'setSharing'
      >
    | undefined,
): DonationsApi {
  function donations() {
    if (!service) throw new Error('Donation integrations are unavailable.')
    return service
  }

  return {
    donationAlertsOAuthAvailable: getDonationAlertsDesktopClientId() !== null,
    getDonationConnections: async () => donations().getConnections(),
    getDonationOAuthAvailability,
    connectDonationProvider: async (params) => {
      await Bun.sleep(0)
      donations().connect(params)
    },
    disconnectDonationProvider: async ({ provider }) => {
      await Bun.sleep(0)
      donations().disconnect(provider)
    },
    getDonationSharing: async () => donations().getSharing(),
    setDonationSharing: async ({ provider, enabled }) => {
      await Bun.sleep(0)
      donations().setSharing(provider, enabled)
      return donations().getSharing()
    },
  }
}
