import { z } from 'zod'

import { parseTwitchHistoryProviders } from './api/twitch-history'
import { donationRedirectUri, type DonationOAuthCredentials } from './auth/donations'

const optionalValue = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional()

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  TWITCH_HISTORY_PROVIDERS: z
    .string()
    .optional()
    .transform((value, context) => {
      try {
        return parseTwitchHistoryProviders(value)
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : String(error),
        })
        return z.NEVER
      }
    }),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  KICK_CLIENT_ID: z.string().min(1, 'KICK_CLIENT_ID is required'),
  KICK_CLIENT_SECRET: z.string().min(1, 'KICK_CLIENT_SECRET is required'),
  KICK_REDIRECT_URI: z.string().url().default('http://localhost:3000/auth/kick/callback'),
  KICK_WEBHOOK_URL: z.string().url('KICK_WEBHOOK_URL must be a valid URL'),
  KICK_WEBHOOK_SECRET: z.string().min(1, 'KICK_WEBHOOK_SECRET is required'),
  TWITCH_CLIENT_ID: z.string().min(1, 'TWITCH_CLIENT_ID is required'),
  TWITCH_CLIENT_SECRET: z.string().min(1, 'TWITCH_CLIENT_SECRET is required'),
  // Optional — enables channel resolution and the shared anonymous gRPC chat relay.
  // Get one at https://console.cloud.google.com/ → Credentials → API key.
  YOUTUBE_API_KEY: z.string().optional(),
  DONATIONALERTS_CLIENT_ID: optionalValue,
  DONATIONALERTS_CLIENT_SECRET: optionalValue,
  DONATIONALERTS_REDIRECT_URI: optionalValue.pipe(donationRedirectUri('donationalerts').optional()),
  MEMEALERTS_CLIENT_ID: optionalValue,
  MEMEALERTS_CLIENT_SECRET: optionalValue,
  MEMEALERTS_REDIRECT_URI: optionalValue.pipe(donationRedirectUri('memealerts').optional()),
})

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error('[config] Invalid environment variables:')
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const config = result.data

function donationCredentials(
  clientId: string | undefined,
  clientSecret: string | undefined,
  redirectUri: string | undefined,
): DonationOAuthCredentials | undefined {
  return clientId && clientSecret && redirectUri
    ? { clientId, clientSecret, redirectUri }
    : undefined
}

export const donationOAuthCredentials = {
  donationalerts: donationCredentials(
    config.DONATIONALERTS_CLIENT_ID,
    config.DONATIONALERTS_CLIENT_SECRET,
    config.DONATIONALERTS_REDIRECT_URI,
  ),
  memealerts: donationCredentials(
    config.MEMEALERTS_CLIENT_ID,
    config.MEMEALERTS_CLIENT_SECRET,
    config.MEMEALERTS_REDIRECT_URI,
  ),
}
