export const DONATION_PROVIDERS = ['donationalerts', 'donatepay', 'memealerts'] satisfies [
  'donationalerts',
  'donatepay',
  'memealerts',
]

export type DonationProvider = (typeof DONATION_PROVIDERS)[number]
export type OAuthDonationProvider = Exclude<DonationProvider, 'donatepay'>
export type DonationOAuthAvailability = { memealerts: boolean }

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

/** Providers whose donations a streamer may relay to viewers of their own chat. */
export const SHAREABLE_DONATION_PROVIDERS = ['donationalerts', 'donatepay'] satisfies [
  'donationalerts',
  'donatepay',
]

export type ShareableDonationProvider = (typeof SHAREABLE_DONATION_PROVIDERS)[number]
export type DonationSharing = Record<ShareableDonationProvider, boolean>

export function isShareableDonationProvider(
  provider: DonationProvider,
): provider is ShareableDonationProvider {
  return provider === 'donationalerts' || provider === 'donatepay'
}

/** Platforms on which the backend can prove that a streamer owns the chat. */
export type DonationSharePlatform = 'twitch' | 'kick'

export interface DonationShareChannel {
  platform: DonationSharePlatform
  /** Twitch login or Kick slug. */
  channel: string
}

export interface DonationShareIdentity {
  platform: DonationSharePlatform
  accessToken: string
}

export const DONATION_SHARE_LIMITS = {
  id: 128,
  username: 128,
  amount: 32,
  currency: 16,
  message: 1000,
  channel: 100,
  identities: 4,
  watchedChannels: 200,
}

export function donationChannelKey({ platform, channel }: DonationShareChannel): string {
  return `${platform}:${channel.trim().toLowerCase()}`
}
