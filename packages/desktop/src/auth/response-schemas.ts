import { z } from 'zod'

export const authUrlSchema = z.object({ url: z.string() })
export const exchangedTokenSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().optional(),
  scope: z.array(z.string()).optional(),
})
export const refreshedTokenSchema = exchangedTokenSchema.omit({ scope: true })

export const oauthTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
  scope: z
    .union([
      z.array(z.string()),
      z.string().transform((value) => value.split(/\s+/u).filter(Boolean)),
    ])
    .optional(),
})

const oauthErrorSchema = z.object({ message: z.string() })

export async function hasOAuthErrorMessage(response: Response, message: string): Promise<boolean> {
  const payload: unknown = await response.json().catch(() => null)
  const parsed = oauthErrorSchema.safeParse(payload)
  return parsed.success && parsed.data.message.trim().toLowerCase() === message
}

export function expiresAt(expiresIn?: number): number | undefined {
  return expiresIn === undefined ? undefined : Math.floor(Date.now() / 1000) + expiresIn
}
