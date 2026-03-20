/**
 * Kick Event Subscriptions
 *
 * After a successful OAuth, subscribes the user's channel to all relevant
 * Kick webhook event types via the Kick public API.
 *
 * Docs: https://docs.kick.com/events/subscriptions
 */

const KICK_API_BASE = "https://api.kick.com/public/v1";

// The public URL where Kick will POST webhook events.
// Must be set in env; e.g. https://your-backend.example.com/webhook/kick
const WEBHOOK_URL =
  process.env["KICK_WEBHOOK_URL"] ?? "https://your-backend.example.com/webhook/kick";

const EVENT_TYPES = [
  "chat.message.sent",
  "channel.followed",
  "channel.subscription.new",
  "channel.subscription.renewal",
  "channel.subscription.gifts",
] as const;

interface SubscriptionResponse {
  data?: Array<{ id: string; event_type: string; broadcaster_user_id: number }>;
  error?: string;
}

/**
 * Subscribe the authenticated user's channel to all relevant Kick webhook events.
 * Called once right after OAuth tokens are stored.
 *
 * @param accessToken  Fresh Kick OAuth access token with `events:subscribe` scope
 * @param clientId     Kick app client_id (needed for Client-ID header)
 */
export async function subscribeKickEvents(
  accessToken: string,
  clientId: string
): Promise<void> {
  const subscriptions = EVENT_TYPES.map((eventType) => ({
    type: eventType,
    version: 1,
    condition: {},
    transport: {
      method: "webhook",
      callback: WEBHOOK_URL,
    },
  }));

  const res = await fetch(`${KICK_API_BASE}/events/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-ID": clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(subscriptions),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kick event subscription failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as SubscriptionResponse;
  const count = data.data?.length ?? 0;
  console.log(`[Kick] Subscribed to ${count} event type(s) at ${WEBHOOK_URL}`);
}
