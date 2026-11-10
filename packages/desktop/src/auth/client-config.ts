import { t } from '../gpuix/i18n'
declare const embeddedDonationAlertsDesktopClientId: string | undefined
declare const embeddedTwitchDesktopClientId: string | undefined
declare const embeddedYouTubeDesktopClientId: string | undefined
declare const embeddedYouTubeDesktopClientSecret: string | undefined

export function getDonationAlertsDesktopClientId(): string | null {
  const clientId =
    process.env.TWIRCHAT_DONATIONALERTS_CLIENT_ID?.trim() ||
    (typeof embeddedDonationAlertsDesktopClientId === 'string'
      ? embeddedDonationAlertsDesktopClientId.trim()
      : '')
  return /^[1-9][0-9]*$/u.test(clientId) ? clientId : null
}

export function getTwitchDesktopClientId(): string {
  const clientId =
    process.env.TWIRCHAT_TWITCH_CLIENT_ID?.trim() ||
    (typeof embeddedTwitchDesktopClientId === 'string' ? embeddedTwitchDesktopClientId : '')
  if (!clientId) throw new Error(t('runtime.auth.twitchClientRequired'))
  return clientId
}

export function getYouTubeDesktopCredentials() {
  const clientId =
    process.env.TWIRCHAT_YOUTUBE_CLIENT_ID?.trim() ||
    (typeof embeddedYouTubeDesktopClientId === 'string' ? embeddedYouTubeDesktopClientId : '')
  const clientSecret =
    process.env.TWIRCHAT_YOUTUBE_CLIENT_SECRET?.trim() ||
    (typeof embeddedYouTubeDesktopClientSecret === 'string'
      ? embeddedYouTubeDesktopClientSecret
      : '')
  if (!clientId || !clientSecret) throw new Error(t('runtime.auth.youtubeClientRequired'))
  return { client_id: clientId, client_secret: clientSecret }
}
