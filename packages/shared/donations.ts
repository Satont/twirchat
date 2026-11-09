export const DONATION_PROVIDERS = ['donationalerts', 'donatepay', 'memealerts'] satisfies [
  'donationalerts',
  'donatepay',
  'memealerts',
]

export type DonationProvider = (typeof DONATION_PROVIDERS)[number]
export type OAuthDonationProvider = Exclude<DonationProvider, 'donatepay'>

export const DONATION_PROVIDER_LABELS: Record<DonationProvider, string> = {
  donationalerts: 'DonationAlerts',
  donatepay: 'DonatePay',
  memealerts: 'MemeAlerts',
}

export interface DonationEvent {
  id: string
  provider: DonationProvider
  username: string
  amount: string
  currency: string
  message: string
  timestamp: number
}

export type DonationConnection =
  | { status: 'disconnected' | 'authorizing' | 'connecting' | 'connected' }
  | { status: 'error'; message: string }

export type DonationConnections = Record<DonationProvider, DonationConnection>

export type ConnectDonationProvider =
  | { provider: OAuthDonationProvider }
  | { provider: 'donatepay'; apiKey: string }

export interface DonationOAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}
