import type { DesktopToBackendMessage } from '@twirchat/shared'
import type { BackendToDesktopMessage } from '@twirchat/shared'
import { logger } from '@twirchat/shared/logger'
import type { ServerWebSocket } from 'bun'

import { startKickOAuth } from '../auth/kick.ts'
import { config } from '../config.ts'
import { ClientStore } from '../db/index.ts'
import { AccountStore } from '../db/index.ts'
import { verifyDonationShareIdentity } from '../donations/share-identity.ts'
import { createDonationShareRelay } from '../donations/share-relay.ts'
import { sevenTVManager } from '../seventv/index.ts'
import { YouTubeChatRelay } from '../youtube/relay.ts'
import { connectionManager } from './connection-manager.ts'
import type { WsData } from './connection-manager.ts'
import { desktopMessageSchema } from './message-schema'

const log = logger('ws')

export const youtubeChatRelay = new YouTubeChatRelay({
  apiKey: config.YOUTUBE_API_KEY,
  send: (client, event) => {
    connectionManager.send(client, { type: 'youtube_chat_event', event })
  },
})

export const donationShareRelay = createDonationShareRelay({
  verify: verifyDonationShareIdentity,
  send: (client, message) => {
    connectionManager.send(client, message)
  },
})

// Setup 7TV manager to send messages to clients
sevenTVManager.sendToClient = (clientSecret: string, message: BackendToDesktopMessage) => {
  connectionManager.send(clientSecret, message)
}

export async function handleWsOpen(ws: ServerWebSocket<WsData>): Promise<void> {
  log.info('WebSocket opened', { client: ws.data.clientSecret.slice(0, 8) })
  youtubeChatRelay.cleanupClient(ws.data.clientSecret)
  donationShareRelay.removeClient(ws.data.clientSecret)
  connectionManager.register(ws)
  await ClientStore.touch(ws.data.clientSecret)
}

export function handleWsClose(ws: ServerWebSocket<WsData>, code: number, reason: string): void {
  log.info('WebSocket closed', {
    client: ws.data.clientSecret.slice(0, 8),
    code,
    reason,
  })
  if (!connectionManager.remove(ws)) return
  youtubeChatRelay.cleanupClient(ws.data.clientSecret)
  donationShareRelay.removeClient(ws.data.clientSecret)
  // Cleanup 7TV subscriptions for this client
  sevenTVManager.cleanupClient(ws.data.clientSecret)
}

export async function handleWsMessage(
  ws: ServerWebSocket<WsData>,
  raw: string | Buffer,
): Promise<void> {
  if (!connectionManager.isCurrent(ws)) return
  let msg: DesktopToBackendMessage

  try {
    msg = desktopMessageSchema.parse(JSON.parse(typeof raw === 'string' ? raw : raw.toString()))
  } catch {
    ws.send(JSON.stringify({ message: 'Invalid JSON', type: 'error' }))
    return
  }

  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    ws.send(JSON.stringify({ message: 'Invalid message', type: 'error' }))
    return
  }

  switch (msg.type) {
    case 'youtube_chat_subscribe': {
      await youtubeChatRelay.subscribe(ws.data.clientSecret, msg)
      break
    }
    case 'youtube_chat_unsubscribe': {
      if (typeof msg.subscriptionId === 'string') {
        youtubeChatRelay.unsubscribe(ws.data.clientSecret, msg.subscriptionId)
      }
      break
    }
    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong' }))
      break
    }
    case 'donation_share_identities': {
      donationShareRelay.setIdentities(ws.data.clientSecret, msg.identities)
      break
    }
    case 'donation_share': {
      await donationShareRelay.share(ws.data.clientSecret, msg.donation)
      break
    }
    case 'donation_watch': {
      donationShareRelay.watch(ws.data.clientSecret, msg.channels)
      break
    }

    case 'auth_start': {
      if (msg.platform === 'kick') {
        try {
          const url = await startKickOAuth(ws.data.clientSecret)
          ws.send(JSON.stringify({ platform: 'kick', type: 'auth_url', url }))
        } catch (error) {
          ws.send(
            JSON.stringify({
              type: 'auth_error',
              platform: 'kick',
              error: String(error),
            }),
          )
        }
      } else {
        ws.send(
          JSON.stringify({
            message: `auth_start: unsupported platform ${msg.platform}`,
            type: 'error',
          }),
        )
      }
      break
    }

    case 'auth_logout': {
      try {
        await AccountStore.delete(ws.data.clientSecret, msg.platform)
        log.info('Logout', {
          client: ws.data.clientSecret.slice(0, 8),
          platform: msg.platform,
        })
      } catch (error) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: `auth_logout failed: ${String(error)}`,
          }),
        )
      }
      break
    }

    case 'send_message': {
      // Send_message via backend will be handled per-platform when platform adapters are added server-side
      ws.send(
        JSON.stringify({
          message: 'send_message not yet supported',
          type: 'error',
        }),
      )
      break
    }

    case 'channel_join':
    case 'channel_leave': {
      // Channel tracking — no-op for now, will be used for backend-managed subscriptions
      break
    }

    case 'seventv_subscribe': {
      try {
        await sevenTVManager.subscribeClient(
          ws.data.clientSecret,
          msg.platform,
          msg.channelId,
          msg.platformUserId,
        )
      } catch (error) {
        log.error('7TV subscribe error', { error: String(error) })
        ws.send(
          JSON.stringify({
            type: 'error',
            message: `7TV subscribe failed: ${String(error)}`,
          }),
        )
      }
      break
    }

    case 'seventv_unsubscribe': {
      try {
        sevenTVManager.unsubscribeClient(ws.data.clientSecret, msg.platform, msg.channelId)
      } catch (error) {
        log.error('7TV unsubscribe error', { error: String(error) })
      }
      break
    }

    case 'seventv_resubscribe': {
      // Handle reconnect - client sends list of channels to resubscribe
      try {
        for (const sub of msg.subscriptions) {
          await sevenTVManager.subscribeClient(
            ws.data.clientSecret,
            sub.platform,
            sub.channelId,
            sub.platformUserId,
          )
        }
      } catch (error) {
        log.error('7TV resubscribe error', { error: String(error) })
      }
      break
    }

    default: {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Unknown message type',
        }),
      )
    }
  }
}
