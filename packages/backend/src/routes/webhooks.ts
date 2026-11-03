import { handleKickWebhook } from '../auth/kick-webhook.ts'

export const webhookRoutes = {
  '/webhook/kick': {
    POST: (req: Request) => handleKickWebhook(req),
  },
}
