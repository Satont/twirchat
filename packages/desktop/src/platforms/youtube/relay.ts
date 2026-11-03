import type { YouTubeChatBatch } from '@twirchat/shared/youtube-chat'

import type { BackendConnection } from '../../backend-connection'
import { deleteOldestEntry } from '../../services/bounded-cache'
import type { YouTubeChatRelay } from './adapter'

export function createYouTubeChatRelay(
  connection: Pick<BackendConnection, 'isConnected' | 'send' | 'onMessage' | 'onConnectionStatus'>,
): YouTubeChatRelay {
  return {
    subscribe(options, handler) {
      const subscriptionId = crypto.randomUUID()
      let pageToken = options.pageToken
      let stopped = false
      const seen = new Set<string>()
      const combos = new Map<string, number>()
      const first = (key: string) => {
        if (seen.has(key)) return false
        seen.add(key)
        if (seen.size > 10000) deleteOldestEntry(seen)
        return true
      }
      const deduplicate = (batch: YouTubeChatBatch): YouTubeChatBatch => ({
        ...batch,
        messages: batch.messages.filter((message) =>
          first(`message:${message.id}:${message.type === 'system' ? message.text : ''}`),
        ),
        events: batch.events.flatMap((event) => {
          if (typeof event.data.comboCount === 'number') {
            const key = event.id.replace(/:combo:\d+$/, '')
            const previous = combos.get(key) ?? 0
            const total = event.data.comboCount
            if (total <= previous) return []
            combos.set(key, total)
            if (combos.size > 10000) deleteOldestEntry(combos)
            return [{ ...event, data: { ...event.data, count: total - previous } }]
          }
          return first(`event:${event.id}`) ? [event] : []
        }),
      })
      const subscribe = () => {
        if (!stopped)
          connection.send({
            type: 'youtube_chat_subscribe',
            subscriptionId,
            channelId: options.channelId,
            ...(pageToken ? { pageToken } : {}),
          })
      }
      const offMessage = connection.onMessage((message) => {
        if (
          stopped ||
          message.type !== 'youtube_chat_event' ||
          message.event.subscriptionId !== subscriptionId
        )
          return
        const event = message.event
        if (event.type === 'batch' && event.nextPageToken) pageToken = event.nextPageToken
        if (event.type === 'status' && event.terminal) {
          stopped = true
          offStatus()
          offMessage()
        }
        handler(event.type === 'batch' ? { ...event, batch: deduplicate(event.batch) } : event)
      })
      const offStatus = connection.onConnectionStatus((connected) => {
        if (stopped) return
        if (connected) subscribe()
        else
          handler({
            type: 'status',
            subscriptionId,
            status: 'connecting',
            error: 'Backend disconnected. Waiting to resume YouTube chat…',
          })
      })
      if (connection.isConnected) subscribe()
      else
        handler({
          type: 'status',
          subscriptionId,
          status: 'connecting',
          error: 'Waiting for backend connection for anonymous YouTube chat…',
        })
      return () => {
        if (!stopped) connection.send({ type: 'youtube_chat_unsubscribe', subscriptionId })
        stopped = true
        offStatus()
        offMessage()
      }
    },
  }
}
