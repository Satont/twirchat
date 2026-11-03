import { z } from 'zod'

export const authUrlSchema = z.object({ url: z.string() })
export const exchangedTokenSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().optional(),
  scope: z.array(z.string()).optional(),
})
export const refreshedTokenSchema = exchangedTokenSchema.omit({ scope: true })
