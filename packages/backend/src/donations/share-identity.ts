import type { DonationShareChannel, DonationShareIdentity } from '@twirchat/shared/donations'
import { z } from 'zod'

const VERIFY_TIMEOUT_MS = 10_000
const twitchValidationSchema = z.object({ login: z.string().trim().min(1) })
const kickChannelsSchema = z.object({
  data: z.array(z.object({ slug: z.string().trim().min(1) })).min(1),
})

type Fetcher = (input: string, init: RequestInit) => Promise<Response>

/** Resolves the chat an access token belongs to, or null when the platform rejects it. */
export async function verifyDonationShareIdentity(
  identity: DonationShareIdentity,
  fetcher: Fetcher = fetch,
): Promise<DonationShareChannel | null> {
  try {
    if (identity.platform === 'twitch') {
      const response = await fetcher('https://id.twitch.tv/oauth2/validate', {
        redirect: 'error',
        headers: { Authorization: `OAuth ${identity.accessToken}` },
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      })
      if (!response.ok) return null
      const { login } = twitchValidationSchema.parse(await response.json())
      return { platform: 'twitch', channel: login.toLowerCase() }
    }
    // Without slug or broadcaster filters Kick returns the token owner's channel.
    const response = await fetcher('https://api.kick.com/public/v1/channels', {
      redirect: 'error',
      headers: { Authorization: `Bearer ${identity.accessToken}` },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const [channel] = kickChannelsSchema.parse(await response.json()).data
    return channel ? { platform: 'kick', channel: channel.slug.toLowerCase() } : null
  } catch {
    return null
  }
}
