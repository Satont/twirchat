import { credentials, Metadata, status } from '@grpc/grpc-js'

import type { YouTubeChatCredentials, YouTubeChatStatus } from '../youtube-chat'
import {
  V3DataLiveChatMessageServiceClient,
  type LiveChatMessageListResponse,
  type LiveChatMessageListRequest,
} from './gen/stream_list'

export interface YouTubeGrpcError {
  code?: number
  details?: string
  message?: string
}

export interface YouTubeGrpcStream {
  on(event: 'metadata', listener: () => void): unknown
  on(event: 'data', listener: (batch: LiveChatMessageListResponse) => void): unknown
  on(event: 'error', listener: (error: YouTubeGrpcError) => void): unknown
  on(event: 'end', listener: () => void): unknown
  cancel(): void
}

export interface YouTubeGrpcClient {
  streamList(request: LiveChatMessageListRequest, metadata: Metadata): YouTubeGrpcStream
  close(): void
}
export function createYouTubeGrpcSession(options: {
  liveChatId: string
  initialPageToken?: string
  getCredentials(forceRefresh?: boolean): Promise<YouTubeChatCredentials> | YouTubeChatCredentials
  onBatch(batch: LiveChatMessageListResponse): void
  onStatus(status: YouTubeChatStatus, error?: string, terminal?: boolean): void
  clientFactory?: () => YouTubeGrpcClient
  retryDelayMs?: number
  maxRetries?: number
}) {
  let stopped = true
  let epoch = 0
  let client: YouTubeGrpcClient | undefined
  let call: YouTubeGrpcStream | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let resumeToken = options.initialPageToken
  let failures = 0
  let refreshed = false
  const close = () => {
    const previous = call
    call = undefined
    previous?.cancel()
    client?.close()
    client = undefined
  }
  const stop = () => {
    stopped = true
    epoch++
    if (timer) clearTimeout(timer)
    timer = undefined
    close()
  }
  const reportOpenError = (error: unknown): void => {
    stop()
    options.onStatus('error', error instanceof Error ? error.message : String(error), true)
  }
  const open = async (forceRefresh = false): Promise<void> => {
    const revision = ++epoch
    const current = () => !stopped && revision === epoch
    options.onStatus('connecting')
    let finished = false
    const finish = (code: number, message: string) => {
      if (!current() || finished) return
      finished = true
      epoch++
      close()
      if (code === status.UNAUTHENTICATED && !refreshed) {
        refreshed = true
        open(true).catch(reportOpenError)
        return
      }
      const rateLimited =
        code === status.RESOURCE_EXHAUSTED &&
        /rate.?limit|too many|concurrent|retry.?after/i.test(message) &&
        !/daily|quota.?exceeded|quota.?exhausted/i.test(message)
      const terminal =
        !rateLimited &&
        ![
          status.UNAVAILABLE,
          status.DEADLINE_EXCEEDED,
          status.INTERNAL,
          status.UNKNOWN,
          status.OK,
        ].includes(code)
      if (terminal || failures >= (options.maxRetries ?? 6)) {
        stop()
        options.onStatus('error', `${message} Reconnect manually.`, true)
        return
      }
      const delay = Math.min(
        (options.retryDelayMs ?? (rateLimited ? 10000 : 1000)) * 2 ** failures++,
        30000,
      )
      options.onStatus('connecting', `${message} Reconnecting…`)
      timer = setTimeout(() => {
        timer = undefined
        open().catch(reportOpenError)
      }, delay)
    }
    try {
      const auth = await options.getCredentials(forceRefresh)
      if (!current()) return
      const metadata = new Metadata()
      if ('accessToken' in auth) metadata.set('authorization', `Bearer ${auth.accessToken}`)
      else metadata.set('x-goog-api-key', auth.apiKey)
      client =
        options.clientFactory?.() ??
        new V3DataLiveChatMessageServiceClient(
          'youtube.googleapis.com:443',
          credentials.createSsl(),
        )
      call = client.streamList(
        {
          liveChatId: options.liveChatId,
          pageToken: resumeToken,
          part: ['id', 'snippet', 'authorDetails'],
        },
        metadata,
      )
      call.on('metadata', () => {
        if (current()) options.onStatus('connected')
      })
      call.on('data', (batch: LiveChatMessageListResponse) => {
        if (!current()) return
        failures = 0
        if (batch.nextPageToken) resumeToken = batch.nextPageToken
        options.onStatus('connected')
        options.onBatch(batch)
        if (batch.offlineAt || batch.items.some((item) => item.snippet?.type === 4)) {
          stop()
          options.onStatus(
            'disconnected',
            'YouTube live chat ended. Reconnect manually for a new broadcast.',
            true,
          )
        }
      })
      call.on('error', (error: YouTubeGrpcError) =>
        finish(
          error.code ?? status.UNKNOWN,
          error.details ?? error.message ?? 'YouTube stream failed.',
        ),
      )
      call.on('end', () => finish(status.OK, 'YouTube stream closed.'))
    } catch (error) {
      finish(status.UNAUTHENTICATED, error instanceof Error ? error.message : String(error))
    }
  }
  return {
    async start() {
      if (!stopped) return
      stopped = false
      failures = 0
      refreshed = false
      await open()
    },
    stop,
    getResumeToken: () => resumeToken,
  }
}
