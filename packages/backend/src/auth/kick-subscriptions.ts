import { z } from 'zod'
/**
 * Kick Event Subscriptions
 *
 * After a successful OAuth, subscribes the user's channel to all relevant
 * Kick webhook event types via the Kick public API.
 *
 * Docs: https://docs.kick.com/events/subscriptions
 */

import { config } from '../config.ts'

const KICK_API_BASE = 'https://api.kick.com/public/v1'

// The public URL where Kick will POST webhook events.
const WEBHOOK_URL = config.KICK_WEBHOOK_URL

const EVENT_TYPES = [
  'chat.message.sent',
  'channel.followed',
  'channel.subscription.new',
  'channel.subscription.renewal',
  'channel.subscription.gifts',
]

const subscriptionResponseSchema = z.object({
  data: z
    .array(z.object({ id: z.string(), event_type: z.string(), broadcaster_user_id: z.number() }))
    .optional(),
  error: z.string().optional(),
})

/**
 * Subscribe the authenticated user's channel to all relevant Kick webhook events.
 * Called once right after OAuth tokens are stored.
 *
 * @param accessToken  Fresh Kick OAuth access token with `events:subscribe` scope
 * @param clientId     Kick app client_id (needed for Client-ID header)
 */
export async function subscribeKickEvents(accessToken: string, clientId: string): Promise<void> {
  const subscriptions = EVENT_TYPES.map((eventType) => ({
    condition: {},
    transport: {
      callback: WEBHOOK_URL,
      method: 'webhook',
    },
    type: eventType,
    version: 1,
  }))

  const res = await fetch(`${KICK_API_BASE}/events/subscriptions`, {
    body: JSON.stringify(subscriptions),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-ID': clientId,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Kick event subscription failed: ${res.status} ${body}`)
  }

  const data = subscriptionResponseSchema.parse(await res.json())
  const count = data.data?.length ?? 0
  console.log(`[Kick] Subscribed to ${count} event type(s) at ${WEBHOOK_URL}`)
}
